/**
 * OJO: la interfaz enruta con HashRouter, asi que las direcciones llevan "#".
 *
 * El almacen en un navegador: pedir una compra, recibirla por partes, ver las
 * existencias, corregir con un ajuste, contar y aprobar.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-apantalla PORT=4470 node dist/index.js &
 *   node scripts/probar-almacen-pantalla.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4470";
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

const llamar = (metodo, ruta, cuerpo) =>
  pag.evaluate(
    async ([m, r, c]) => {
      const res = await fetch(r, { method: m, headers: { "content-type": "application/json" }, body: c ? JSON.stringify(c) : undefined });
      return res.json();
    },
    [metodo, ruta, cuerpo],
  );
const unidades = await llamar("GET", "/bloques/unidades");
const kg = unidades.find((u) => u.abbreviation === "kg");
await llamar("POST", "/bloques/materiales", {
  code: "UI-CEM", name: "Cemento UI", purchaseUnit: "bolsa", purchasePriceCents: 900,
  dosingUnitId: kg.id, contentPerPurchaseMilli: 42500,
});
await llamar("POST", "/bloques/proveedores", { name: "Cementos del Norte" });

console.log("\n=== el menú y la pantalla vacía ===");
await ir("/almacen");
let t = await texto();
const menu = await pag.locator("nav").first().innerText();
ok(/Almacén/i.test(menu), "«Almacén» está en el menú");
ok(/Cemento UI/.test(t), "las existencias listan el material del catálogo");
ok(/sin costo/.test(t), "y dice «sin costo»: no inventa un precio");
await foto("1-existencias-vacias");

console.log("\n=== pedir una compra ===");
await pag.getByRole("link", { name: "Compras" }).click();
await pag.waitForTimeout(600);
ok(/Todavía no hay compras/.test(await texto()), "no hay compras todavía");
await pag.getByRole("link", { name: "Nueva compra" }).click();
await pag.waitForTimeout(900);
await pag.getByLabel("Proveedor").selectOption({ label: "Cementos del Norte" });
await pag.getByLabel("Material 1").selectOption({ label: "Cemento UI" });
await pag.getByLabel("Cantidad 1").fill("100");
t = await texto();
ok(/900[.,]00/.test(t), "el total sale del precio del catálogo: $900.00");
ok(/sin precio|bolsa/.test(t), "la unidad de compra se ve junto a la cantidad");
await foto("2-nueva-compra");
await pag.getByRole("button", { name: "Pedir compra" }).click();
await pag.waitForTimeout(1500);
t = await texto();
ok(/Compra N° 1/.test(t), "se crea la compra N° 1");
ok(/Pendiente/i.test(t), "queda pendiente");

console.log("\n=== recibir una parte ===");
await pag.getByLabel("Llega Cemento UI").fill("40");
await pag.getByLabel("Precio real Cemento UI").fill("9,50");
await pag.getByLabel("N° de remisión").fill("REM-9");
await pag.getByRole("button", { name: "Anotar que llegó" }).click();
await pag.waitForTimeout(1500);
t = await texto();
ok(/Llegó una parte/i.test(t), "la compra queda «Llegó una parte»");
ok(/se pidió a \$9\.00 por bolsa y llegó a \$9\.50/.test(t), "avisa que llegó a otro precio");
ok(/Recepción 1/.test(t) && /REM-9/.test(t), "la recepción aparece con su remisión");
await foto("3-recibida-parcial");

console.log("\n=== recibir lo que falta ===");
await pag.getByRole("button", { name: "Llegó todo lo que faltaba" }).click();
ok((await pag.getByLabel("Llega Cemento UI").inputValue()) === "60", "el botón llena las 60 bolsas que faltan");
await pag.getByRole("button", { name: "Anotar que llegó" }).click();
await pag.waitForTimeout(1500);
t = await texto();
ok(/Completa/i.test(t), "la compra queda completa");
ok(await pag.getByLabel("Llega Cemento UI").count() === 0, "y ya no ofrece recibir más");

console.log("\n=== las existencias suben ===");
await ir("/almacen");
t = await texto();
ok(/4[.,]?250 kg/.test(t), "hay 4,250 kg: 100 bolsas × 42.5 kg", (t.match(/[\d.,]+ kg/) ?? [])[0]);
ok(/Valor en almacén/i.test(t) && /900[.,]00/.test(t), "el valor sale del último costo");
await foto("4-existencias");

console.log("\n=== corregir con un ajuste ===");
await pag.locator("tr", { hasText: "Cemento UI" }).getByRole("button", { name: "Detalle" }).click();
await pag.waitForTimeout(700);
await pag.getByLabel("Tipo de ajuste").selectOption("merma");
await pag.getByLabel("Cantidad en kg").fill("42.5");
await pag.getByLabel("Por qué").fill("Una bolsa se rompió");
await pag.getByRole("button", { name: "Anotar ajuste" }).click();
await pag.waitForTimeout(1200);
t = await texto();
ok(/4[.,]?207[.,]5 kg/.test(t), "baja a 4,207.5 kg", (t.match(/[\d.,]+ kg/) ?? [])[0]);
ok(/Merma/i.test(t) && /Una bolsa se rompió/.test(t), "el movimiento queda con su motivo");
await pag.getByLabel("Mínimo en kg").fill("5000");
await pag.getByRole("button", { name: "Guardar mínimo" }).click();
await pag.waitForTimeout(1200);
ok(/Bajo mínimo/i.test(await texto()), "con un mínimo de 5,000 kg figura «Bajo mínimo»");

console.log("\n=== contar y aprobar ===");
await pag.getByRole("link", { name: "Conteos" }).click();
await pag.waitForTimeout(600);
await pag.getByRole("button", { name: "Abrir un conteo" }).click();
await pag.waitForTimeout(1500);
t = await texto();
ok(/Conteo físico N° 1/i.test(t) && /Abierto/i.test(t), "se abre el conteo N° 1");
await pag.getByLabel("Contado Cemento UI").fill("4180");
t = await texto();
ok(/-27[.,]5 kg/.test(t.replace("−", "-")), "mientras se escribe ya muestra la diferencia: −27.5 kg");
await pag.getByRole("button", { name: "Guardar lo contado" }).click();
await pag.waitForTimeout(1000);
await foto("5-conteo");
await pag.getByRole("button", { name: /Aprobar y corregir/ }).click();
await pag.waitForTimeout(1500);
t = await texto();
ok(/Aprobado/i.test(t), "el conteo queda aprobado");
await ir("/almacen");
t = await texto();
ok(/4[.,]?180 kg/.test(t), "las existencias quedan en lo contado: 4,180 kg", (t.match(/[\d.,]+ kg/) ?? [])[0]);

console.log("\n=== proveedores ===");
await pag.getByRole("link", { name: "Proveedores" }).click();
await pag.waitForTimeout(600);
await pag.getByLabel("Nombre del proveedor").fill("Arenera El Río");
await pag.getByLabel("Teléfono del proveedor").fill("2222-1111");
await pag.getByRole("button", { name: "Agregar proveedor" }).click();
await pag.waitForTimeout(1000);
ok(/Arenera El Río/.test(await texto()), "se agrega un proveedor");
await pag.getByRole("button", { name: "Inactivar" }).last().click();
await pag.waitForTimeout(800);
ok(await pag.getByRole("button", { name: "Reactivar" }).count() === 1, "y se puede inactivar");

console.log("\n=== en un teléfono ===");
await pag.setViewportSize({ width: 390, height: 844 });
for (const r of ["/almacen", "/almacen/compras", "/almacen/conteos"]) {
  await ir(r);
  const desborda = await pag.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 4);
  ok(!desborda, `${r} no se sale de la pantalla`);
}
await foto("6-telefono");

ok(errores.length === 0, "ningún error de JavaScript en toda la prueba", errores.join(" | "));
await nav.close();
console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
