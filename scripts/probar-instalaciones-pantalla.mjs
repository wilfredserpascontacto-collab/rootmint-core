/**
 * Instalaciones, por las pantallas que usaria la oficina.
 *
 * Servidor: ROOTMINT_MODULES=comercial,servicio, base vacia, ya compilado
 * (npm run web:build). Se hace lo que se haria con el telefono sonando:
 * cargar una, encontrarla sin tildes, corregirla, quitarla.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4802";
let fallas = 0;
const ok = (b, t, extra = "") => {
  if (!b) fallas++;
  console.log(`  ${b ? "✓" : "✗"} ${t}${!b && extra ? "  — " + extra : ""}`);
};
const nav = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 } });
const pag = await ctx.newPage();
const malos = [];
pag.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|\/auth\/me|fonts\./.test(r.url())) malos.push(`${r.status()} ${r.url().replace(BASE, "")}`);
});
pag.on("pageerror", (e) => malos.push("JS: " + e.message));
const texto = () => pag.locator("body").innerText();
const FOTOS = process.env.FOTOS ?? "";
const foto = async (n) => { if (FOTOS) await pag.screenshot({ path: `${FOTOS}/inst-${n}.png` }); };

console.log("\n=== entrar ===");
await pag.goto(BASE, { waitUntil: "domcontentloaded" });
await pag.waitForTimeout(1200);
if (/ninguna cuenta todav/i.test(await texto())) {
  await pag.getByLabel(/nombre/i).first().fill("Francisco");
  await pag.getByLabel(/correo/i).first().fill("f@fenix.sv");
  const claves = pag.locator('input[type="password"]');
  for (let i = 0; i < (await claves.count()); i++) await claves.nth(i).fill("unaClaveLarga1");
  await pag.getByRole("button", { name: /crear/i }).first().click();
  await pag.waitForTimeout(1500);
}
// Dos clientes, por la API de la misma sesion.
const cliente = async (name, address) =>
  (await (await pag.request.post(BASE + "/customers", { data: { name, type: "person", stage: "customer", address } })).json());
const perez = await cliente("María Pérez", "Residencial Los Pinos, casa 12");
await cliente("Taller López", "Colonia Escalón");

console.log("\n=== la lista, vacía ===");
await pag.goto(`${BASE}/#/comercial`);
await pag.waitForTimeout(800);
ok(/Instalaciones/.test(await texto()), "el menú tiene «Instalaciones» bajo «Servicio»");
await pag.getByRole("link", { name: /Instalaciones/ }).first().click();
await pag.waitForTimeout(900);
ok(/Todavía no hay instalaciones/i.test(await texto()), "sin ninguna, explica qué es una");
await foto("1-vacia");

console.log("\n=== cargar una ===");
await pag.getByRole("button", { name: /nueva instalaci/i }).click();
await pag.waitForTimeout(500);
const modal = pag.getByRole("dialog");
await modal.locator("select").first().selectOption({ label: "María Pérez" });
ok((await modal.getByPlaceholder(/Dónde está instalado/i).inputValue()) === "Residencial Los Pinos, casa 12",
   "al elegir cliente, la dirección se llena con la suya");
await modal.getByPlaceholder(/playa/i).fill("La casa de la playa");
await modal.getByPlaceholder(/Dónde está instalado/i).fill("Km 40 Carretera al Litoral");
await modal.getByPlaceholder(/Tablero de 12/i).fill("Tablero de 12 circuitos y acometida");
await modal.locator('input[type="date"]').fill("2026-03-15");
await foto("2-formulario");
await modal.getByRole("button", { name: /guardar instalaci/i }).click();
await pag.waitForTimeout(1200);
let t = await texto();
ok(/INS-00001/.test(t) && /La casa de la playa/.test(t), "queda cargada y se abre su ficha, con su número");
ok(/Entregada el 15 mar/i.test(t), "la entrega dice 15 de marzo (no el 14)", (t.match(/Entregada el [^\n.]*/i) ?? [])[0]);
ok(/Km 40 Carretera al Litoral/.test(t) && /María Pérez/.test(t), "con su dirección y su cliente");
await foto("3-ficha");

console.log("\n=== sin fecha de entrega, y fecha futura ===");
await pag.goto(`${BASE}/#/comercial/instalaciones`);
await pag.waitForTimeout(700);
await pag.getByRole("button", { name: /nueva instalaci/i }).click();
await pag.waitForTimeout(400);
let m2 = pag.getByRole("dialog");
await m2.locator("select").first().selectOption({ label: "Taller López" });
await m2.getByPlaceholder(/playa/i).fill("El taller");
await m2.getByPlaceholder(/Tablero de 12/i).fill("Tomacorrientes trifásicos");
await m2.getByRole("button", { name: /guardar instalaci/i }).click();
await pag.waitForTimeout(1200);
t = await texto();
ok(/INS-00002/.test(t) && /Todavía no hay fecha de entrega/i.test(t), "sin fecha: lo dice, no inventa un día");

await pag.goto(`${BASE}/#/comercial/instalaciones`);
await pag.waitForTimeout(600);
await pag.getByRole("button", { name: /nueva instalaci/i }).click();
await pag.waitForTimeout(400);
m2 = pag.getByRole("dialog");
await m2.locator("select").first().selectOption({ label: "María Pérez" });
await m2.getByPlaceholder(/playa/i).fill("Local nuevo");
await m2.getByPlaceholder(/Tablero de 12/i).fill("Luminarias");
const futuro = new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10);
await m2.locator('input[type="date"]').fill(futuro);
await m2.getByRole("button", { name: /guardar instalaci/i }).click();
await pag.waitForTimeout(1200);
ok(/fecha de entrega es futura/i.test(await texto()), "una entrega futura se guarda y la ficha AVISA");
await foto("4-aviso");

console.log("\n=== encontrar ===");
await pag.goto(`${BASE}/#/comercial/instalaciones`);
await pag.waitForTimeout(800);
const buscar = pag.getByLabel("Buscar instalaciones");
t = await texto();
ok(/INS-00001/.test(t) && /INS-00002/.test(t) && /INS-00003/.test(t), "la lista muestra las 3");
await buscar.fill("perez");
await pag.waitForTimeout(300);
t = await texto();
ok(/INS-00001/.test(t) && /INS-00003/.test(t) && !/INS-00002/.test(t), "«perez» sin tilde deja las de María Pérez y quita la del taller");
await buscar.fill("escalon");
await pag.waitForTimeout(300);
t = await texto();
ok(/INS-00002/.test(t) && !/INS-00001/.test(t), "«escalon» encuentra la del taller por su dirección");
await buscar.fill("zzzz");
await pag.waitForTimeout(300);
ok(/Nada coincide/i.test(await texto()), "algo que no existe dice «Nada coincide»");
await buscar.fill("");
await pag.getByLabel("Entrega").selectOption("pendiente");
await pag.waitForTimeout(300);
t = await texto();
ok(/INS-00002/.test(t) && !/INS-00001/.test(t) && !/INS-00003/.test(t), "«sin fecha de entrega» deja solo la del taller");
await foto("5-lista");
await pag.getByLabel("Entrega").selectOption("todas");

console.log("\n=== corregir y quitar ===");
await pag.getByRole("link", { name: "La casa de la playa" }).click();
await pag.waitForTimeout(800);
await pag.getByRole("button", { name: /^editar$/i }).click();
await pag.waitForTimeout(400);
const m3 = pag.getByRole("dialog");
await m3.getByPlaceholder(/Dónde está instalado/i).fill("Km 41 Carretera al Litoral");
await m3.getByRole("button", { name: /guardar cambios/i }).click();
await pag.waitForTimeout(1000);
t = await texto();
ok(/Km 41 Carretera al Litoral/.test(t) && /Entregada el 15 mar/i.test(t), "se corrige la dirección y la entrega sigue igual");
await pag.getByRole("button", { name: /quitar…/i }).click();
await pag.getByRole("button", { name: /sí, quitarla/i }).click();
await pag.waitForTimeout(1000);
t = await texto();
ok(/#\/comercial\/instalaciones$/.test(pag.url()) && !/INS-00001/.test(t) && /INS-00002/.test(t), "se quita y vuelve a la lista, ya sin ella");

ok(malos.length === 0, "ninguna petición fallida en todo el recorrido", malos.join(" | "));
await nav.close();
console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo bien.");
process.exit(fallas ? 1 : 0);
