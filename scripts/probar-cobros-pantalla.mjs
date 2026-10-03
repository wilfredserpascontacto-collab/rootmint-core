/**
 * OJO: la interfaz enruta con HashRouter, asi que las direcciones llevan "#".
 *
 * Cobrar en un navegador: anotar un cobro parcial y uno completo, anularlo,
 * ver el estado de cuenta del cliente y la lista de quien debe.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-cpantalla PORT=4450 node dist/index.js &
 *   node scripts/probar-cobros-pantalla.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4450";
const CLAVE = process.env.CLAVE_PRUEBA ?? "unaClaveLarga1";
const FOTOS = process.env.FOTOS ?? "";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};

const nav = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await nav.newContext({ viewport: { width: 1400, height: 1000 } });
const pag = await ctx.newPage();
const errores = [];
pag.on("pageerror", (e) => errores.push(String(e).slice(0, 160)));
const texto = () => pag.locator("body").innerText();
const foto = async (nombre) => {
  if (FOTOS) await pag.screenshot({ path: `${FOTOS}/${nombre}.png`, fullPage: true });
};
const ir = async (ruta) => {
  await pag.goto(`${BASE}/#${ruta}`, { waitUntil: "networkidle" });
  await pag.waitForTimeout(1200);
};

// --- Entrar y sembrar --------------------------------------------------------
await pag.goto(BASE, { waitUntil: "networkidle" });
await pag.waitForTimeout(900);
await pag.getByLabel("Nombre").fill("Amada");
await pag.getByLabel("Correo").fill("amada@bloquestitan.com");
await pag.getByLabel("Contraseña").fill(CLAVE);
await pag.getByRole("button", { name: /Crear la cuenta/i }).click();
await pag.waitForTimeout(2500);

const sembrar = (ruta, cuerpo) =>
  pag.evaluate(
    async ([r, c]) => {
      const res = await fetch(r, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) });
      return res.json();
    },
    [ruta, cuerpo],
  );
const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString();

const ana = await sembrar("/customers", {
  name: "Constructora Ana", type: "company", nrc: "111111-1", creditLimitCents: 15000, creditTermDays: 30,
});
const vieja = await sembrar("/invoices", {
  customerId: ana.id, issueDate: diasAtras(45),
  lines: [{ description: "Bloques", unitPriceCents: 100, quantity: 100 }],
}); // $113.00, vencida hace 15 dias
await sembrar("/invoices", {
  customerId: ana.id, issueDate: diasAtras(3),
  lines: [{ description: "Bloques", unitPriceCents: 100, quantity: 100 }],
}); // $113.00, al corriente

console.log("\n=== la factura muestra cuánto falta cobrar ===");
await ir(`/comercial/facturas/${vieja.id}`);
let t = await texto();
ok(/Cobros/.test(t), "la factura tiene su sección de cobros");
ok(/Falta cobrar/.test(t) && /113[.,]00/.test(t), "dice que faltan $113.00");
ok(!/Pagada/.test(t.split("Cobros")[1] ?? ""), "y no dice pagada");
await foto("1-factura-sin-cobros");

console.log("\n=== cobrar una parte ===");
await pag.getByLabel("Monto cobrado (USD)").fill("50");
await pag.getByLabel("Cómo pagó").selectOption("transferencia");
await pag.getByLabel("N° de cheque o transferencia").fill("TRF-0042");
await pag.getByRole("button", { name: "Anotar cobro" }).click();
await pag.waitForTimeout(1800);
t = await texto();
ok(/63[.,]00/.test(t), "ahora faltan $63.00");
ok(/Transferencia/.test(t) && /TRF-0042/.test(t), "el cobro aparece con su método y su referencia");
ok((await pag.getByLabel("Monto cobrado (USD)").inputValue()) === "", "el formulario queda limpio para el siguiente");
await foto("2-cobro-parcial");

console.log("\n=== un monto mal escrito se explica ===");
await pag.getByLabel("Monto cobrado (USD)").fill("mucho");
await pag.getByRole("button", { name: "Anotar cobro" }).click();
await pag.waitForTimeout(600);
t = await texto();
ok(/No se entiende «mucho» como monto/.test(t), "dice qué no se entendió, no un error de sistema");
ok(/63[.,]00/.test(t), "y no tocó el saldo");

console.log("\n=== cobrar el saldo completo ===");
await pag.getByRole("button", { name: /Cobrar el saldo completo/ }).click();
ok((await pag.getByLabel("Monto cobrado (USD)").inputValue()) === "63.00", "el botón llena el monto con lo que falta", await pag.getByLabel("Monto cobrado (USD)").inputValue());
await pag.getByRole("button", { name: "Anotar cobro" }).click();
await pag.waitForTimeout(1800);
t = await texto();
ok(/pagada por completo/.test(t), "avisa que la factura quedó pagada");
ok(/Pagada/.test(t), "y el saldo dice Pagada");
ok(await pag.getByRole("button", { name: /Cobrar el saldo completo/ }).count() === 0, "ya no ofrece cobrar el saldo");
await foto("3-pagada");

console.log("\n=== no se anula una factura con cobros ===");
await pag.getByRole("button", { name: /^Anular$/ }).first().click();
await pag.getByLabel("Motivo de la anulación", { exact: true }).fill("Error de cliente");
await pag.locator(".c-statusbar .c-confirmar").getByRole("button", { name: "Anular" }).click();
await pag.waitForTimeout(1200);
t = await texto();
ok(/Anulá primero esos cobros/.test(t), "explica que primero hay que anular los cobros", (t.match(/Esta factura tiene[^.]*\./) ?? [])[0]);

console.log("\n=== anular un cobro ===");
await pag.getByRole("button", { name: "Anular cobro" }).last().click();
await pag.getByLabel("Motivo de la anulación del cobro").fill("Se anotó dos veces");
await pag.locator(".c-cobros .c-confirmar").getByRole("button", { name: "Anular" }).click();
await pag.waitForTimeout(1800);
t = await texto();
ok(/Anulado: Se anotó dos veces/.test(t), "el cobro queda en la lista, anulado, con su motivo");
ok(/63[.,]00/.test(t) && /Falta cobrar/.test(t), "y la factura vuelve a deber $63.00");
await foto("4-cobro-anulado");

console.log("\n=== el estado de cuenta del cliente ===");
await ir(`/comercial/clientes/${ana.id}`);
t = await texto();
ok(/Estado de cuenta/.test(t), "la ficha del cliente tiene su estado de cuenta");
ok(/Vencida/.test(t), "la factura vieja figura vencida");
ok(/hace 15 días/.test(t), "y dice hace cuántos días", (t.match(/hace \d+ días?/) ?? [])[0]);
ok(/Debe/.test(t) && /176[.,]00/.test(t), "debe $176.00 en total (113 + 63)");
ok(/tope de crédito/.test(t), "y avisa que pasó su tope");
await foto("5-estado-de-cuenta");

console.log("\n=== la lista de facturas muestra el saldo ===");
await ir("/comercial/facturas");
t = await texto();
ok(/saldo/i.test(t), "hay una columna de saldo");
ok(/63[.,]00/.test(t), "con lo que falta en la vieja");

console.log("\n=== quién debe ===");
await ir("/comercial/cobros");
t = await texto();
ok(/Por cobrar/.test(t), "existe la pantalla «Por cobrar»");
ok(/Constructora Ana/.test(t), "lista a Ana");
ok(/Pasa de su tope/.test(t), "marcando que pasó su tope");
ok(/hace 45 días/.test(t), "con la antigüedad de su factura más vieja", (t.match(/hace \d+ días?/) ?? [])[0]);
await foto("6-por-cobrar");
const menu = await pag.locator("nav").first().innerText();
ok(/Por cobrar/.test(menu), "y está en el menú de la izquierda");

console.log("\n=== en un teléfono ===");
await pag.setViewportSize({ width: 390, height: 844 });
await ir(`/comercial/facturas/${vieja.id}`);
const desborda = await pag.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 4);
ok(!desborda, "la factura con cobros no se sale de la pantalla");
await foto("7-telefono");

ok(errores.length === 0, "ningún error de JavaScript en toda la prueba", errores.join(" | "));
await nav.close();
console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
