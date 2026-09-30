/**
 * Lo que ve una persona en un despliegue SIN planta.
 *
 * Se levanta el servidor con:
 *   ROOTMINT_MODULES=comercial ROOTMINT_BRAND="Grupo Fénix"
 * y se mira lo que de verdad aparece en pantalla. El servidor ya niega lo
 * apagado; esta prueba cuida que la interfaz no lo ofrezca, ni le pregunte,
 * ni lleve el nombre de otra empresa.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4622";
const MARCA = process.env.MARCA ?? "Grupo Fénix";
let fallas = 0;
const ok = (b, t, extra = "") => {
  if (!b) fallas++;
  console.log(`  ${b ? "✓" : "✗"} ${t}${!b && extra ? "  — " + extra : ""}`);
};
const nav = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const pag = await nav.newPage({ viewport: { width: 1280, height: 800 } });
const malos = [];
pag.on("response", (r) => {
  // El 401 de /auth/me antes de entrar es normal; cualquier otro 4xx/5xx no.
  if (r.status() >= 400 && !/favicon|\/auth\/me|fonts\./.test(r.url())) malos.push(`${r.status()} ${r.url().replace(BASE, "")}`);
});
const texto = () => pag.locator("body").innerText();

console.log("\n=== la entrada ===");
await pag.goto(BASE, { waitUntil: "domcontentloaded" });
await pag.waitForTimeout(1200);
let t = await texto();
ok(t.includes(MARCA), `lleva el nombre de este sistema (${MARCA})`);
ok(!/tit[aá]n/i.test(t), "y no el de otra empresa");

if (/ninguna cuenta todav/i.test(t)) {
  await pag.getByLabel(/nombre/i).first().fill("Francisco");
  await pag.getByLabel(/correo/i).first().fill("duena@prueba.sv");
  const claves = pag.locator('input[type="password"]');
  for (let i = 0; i < (await claves.count()); i++) await claves.nth(i).fill("unaClaveLarga1");
  await pag.getByRole("button", { name: /crear/i }).first().click();
} else {
  ok(!(await pag.getByRole("tab", { name: "Planta" }).count()), "no hay puerta de «Planta»: no hay planta");
  await pag.getByLabel(/correo/i).first().fill("duena@prueba.sv");
  await pag.locator('input[type="password"]').first().fill("unaClaveLarga1");
  await pag.getByRole("button", { name: /^entrar/i }).first().click();
}
await pag.waitForTimeout(1500);

console.log("\n=== adentro ===");
t = await texto();
ok((await pag.title()) === MARCA, "la pestaña dice el nombre del sistema", await pag.title());
ok(/Cotizaciones/.test(t) && /Facturas/.test(t), "el área comercial está completa");
ok(!/Inventario/i.test(t), "no hay «Inventario» en el menú");
ok(!/Abrir producci/i.test(t), "ni «Abrir producción»");
ok(!/Producto disponible/i.test(t), "ni el mosaico de «Producto disponible»");
ok(!/patio|lotes|bloques/i.test(t), "y nada habla de patio, lotes ni bloques", (t.match(/patio|lotes|bloques/i) ?? [])[0]);
ok(/Cuentas/.test(t), "la dueña puede llegar a las cuentas");

console.log("\n=== el catálogo ===");
await pag.goto(`${BASE}/#/comercial/productos`);
await pag.waitForTimeout(900);
t = await texto();
ok(!/Se fabrica como/i.test(t), "no hay columna «Se fabrica como»");
await pag.getByRole("button", { name: /agregar al cat/i }).click();
await pag.waitForTimeout(400);
t = await texto();
ok(!/en producci[oó]n|bloque/i.test(t), "y el formulario no pregunta qué bloque es");
await pag.keyboard.press("Escape");

console.log("\n=== lo que no existe aquí ===");
await pag.goto(`${BASE}/#/lotes`);
await pag.waitForTimeout(900);
ok(/#\/comercial/.test(pag.url()), "/lotes no muestra una pantalla de planta: vuelve al inicio", pag.url());
await pag.goto(`${BASE}/#/comercial/inventario`);
await pag.waitForTimeout(700);
ok(/no encontrada/i.test(await texto()), "/comercial/inventario dice que no existe");

console.log("\n=== las cuentas ===");
await pag.goto(`${BASE}/#/cuentas`);
await pag.waitForTimeout(900);
t = await texto();
ok(/Cuentas/.test(t) && t.includes(MARCA.toUpperCase()), "la pantalla de cuentas abre con el nombre del sistema");
ok(!/PIN|tablet|planta/i.test(t), "y no habla de PIN, tablet ni planta", (t.match(/PIN|tablet|planta/i) ?? [])[0]);
await pag.getByRole("button", { name: /crear una cuenta/i }).click();
await pag.waitForTimeout(400);
ok(!/PIN/i.test(await texto()), "el formulario de cuenta no pide PIN");

ok(malos.length === 0, "ninguna petición fallida en todo el recorrido", malos.join(" | "));
await nav.close();
console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo bien.");
process.exit(fallas ? 1 : 0);
