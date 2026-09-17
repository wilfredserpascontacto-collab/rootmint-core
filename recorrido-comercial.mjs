/**
 * Recorrido del área comercial en el navegador de verdad.
 *
 * Lo que comprueba no es que el código compile —eso ya lo dice tsc— sino que
 * alguien que se equivoca de botón pueda arreglarlo sin llamar a nadie. Cada
 * paso hace clic donde haría clic una persona.
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4310";
const errores = [];
const pasos = [];
const SUF = String(Date.now()).slice(-5);

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const p = await ctx.newPage();
p.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL_CONNECTION_FAILED/.test(m.text())) errores.push(`consola: ${m.text()}`); });
p.on("pageerror", (e) => errores.push(`excepción: ${e.message}`));
// Lo que no sale de la app no es problema de la app: este contenedor no tiene
// salida a internet y cualquier recurso externo falla por el proxy.
p.on("requestfailed", (r) => { if (r.url().startsWith(BASE)) errores.push(`petición fallida: ${r.url()}`); });

const paso = (t) => { pasos.push(t); console.log("·", t); };
const ir = async (r) => { await p.goto(`${BASE}/#${r}`, { waitUntil: "networkidle" }); await p.waitForTimeout(400); };
const foto = (n) => p.screenshot({ path: `/tmp/shots-comercial/${n}.png`, fullPage: true });

// --- 0. Datos mínimos, por la API: el recorrido es de la cotización --------
await fetch(`${BASE}/business-profile`, { method: "PUT", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "BloquesTitán", address: "Cantón El Rosario, La Libertad", phone: "2222-0000", terms: "50% de anticipo. Entrega en planta." }) });
const cliente = await fetch(`${BASE}/customers`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: `Constructora Serpas ${SUF}`, type: "company", stage: "customer" }) }).then((r) => r.json());
await fetch(`${BASE}/catalog-items`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Bloque 15x20x40", code: `B15-${SUF}`, type: "product", unit: "unidad", unitPriceCents: 65 }) });

// --- 1. Armar una cotización como la armaría una persona -------------------
await ir("/comercial/cotizaciones/nueva");
await p.getByLabel("Cliente o prospecto").selectOption({ label: `Constructora Serpas ${SUF}` });
await p.getByLabel("Nombre del proyecto").fill("Suministro · Residencial Las Palmas");
await p.getByLabel("Producto partida 1").selectOption({ index: 1 });
await p.getByLabel("Cantidad partida 1").fill("3000");
await p.waitForTimeout(300);
const total = await p.locator(".c-grand dd").first().innerText();
if (!/2,203\.50/.test(total)) errores.push(`cotización: el total dice "${total}", se esperaba $2,203.50 (3000 × $0.65 + 13%)`);
paso(`cotización · total en vivo: ${total}`);
await foto("A-cotizacion-nueva");
await p.getByRole("button", { name: "Guardar cotización" }).click();
await p.waitForURL(/#\/comercial\/cotizaciones\/[0-9a-f-]{36}/, { timeout: 8000 }).catch(() => errores.push("cotización: guardar no llevó a la ficha"));
paso("cotización · guardada como borrador");

// --- 1b. Corregirla: lo que hasta hoy no se podía hacer --------------------
await p.getByRole("link", { name: "Corregir" }).click();
await p.waitForTimeout(800);
const precioCargado = await p.getByLabel("Precio partida 1").inputValue();
if (precioCargado !== "0.65") errores.push(`corregir: el precio no se precargó (dice "${precioCargado}")`);
else paso("corregir · el formulario abre con lo que ya estaba escrito");
// Un precio pegado desde una planilla, con coma de miles y signo de dólar.
await p.getByLabel("Precio partida 1").fill("$1,250.00");
await p.waitForTimeout(250);
const conComa = await p.locator(".c-line-total").first().innerText();
if (!/3,750,000\.00/.test(conComa)) errores.push(`corregir: «$1,250.00» × 3000 dio "${conComa}"`);
else paso(`corregir · acepta «$1,250.00» pegado de una planilla: ${conComa}`);
// Un precio que no se entiende avisa en vez de congelarse en silencio.
await p.getByLabel("Precio partida 1").fill("dos sesenta");
await p.waitForTimeout(250);
const quejaPrecio = await p.locator(".c-line-editor .c-error").first().innerText().catch(() => "");
if (!/no se entiende/i.test(quejaPrecio)) errores.push("corregir: un precio ilegible no avisó");
else paso(`corregir · precio ilegible: «${quejaPrecio.slice(0, 60)}…»`);
await foto("A2-precio-ilegible");
// Y el aviso de guardado dice cuál partida, no «alguna».
await p.getByRole("button", { name: "Guardar cambios" }).click();
await p.waitForTimeout(500);
const cual = await p.locator(".c-summary .c-error").first().innerText().catch(() => "");
if (!/partida 1/i.test(cual)) errores.push(`corregir: el aviso no dijo cuál partida («${cual}»)`);
else paso(`corregir · el aviso señala la partida: «${cual.slice(0, 70)}…»`);

await p.getByLabel("Precio partida 1").fill("0.65");
await p.getByLabel("Cantidad partida 1").fill("1200");
await p.waitForTimeout(300);
await p.getByRole("button", { name: "Guardar cambios" }).click();
await p.waitForURL(/#\/comercial\/cotizaciones\/[0-9a-f-]{36}$/, { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(700);
const totalCorregido = await p.locator(".c-paper-totals .c-grand dd").first().innerText().catch(() => "");
if (!/881\.40/.test(totalCorregido)) errores.push(`corregir: el total quedó en "${totalCorregido}", se esperaba $881.40 (1200 × $0.65 + 13%)`);
else paso(`corregir · guardado y recalculado: ${totalCorregido}`);
await foto("A3-corregida");

// --- 2. El botón equivocado ------------------------------------------------
await p.getByRole("button", { name: "Marcar como emitida" }).click();
await p.waitForTimeout(700);
if (!(await p.locator(".c-badge.sent").first().isVisible().catch(() => false))) {
  errores.push("estado: no quedó en Emitida");
} else paso("estado · quedó Emitida (el clic que antes no tenía vuelta atrás)");
await foto("B-emitida");

// --- 3. Y la vuelta atrás, que es lo que se arregló hoy --------------------
const volver = p.getByRole("button", { name: "Volver a borrador" });
if (!(await volver.isVisible().catch(() => false))) {
  errores.push("estado: estando Emitida no se ofrece «Volver a borrador»");
} else {
  await volver.click();
  await p.waitForTimeout(700);
  const aviso = await p.locator(".c-aviso").first().innerText().catch(() => "");
  if (!/corrigió/i.test(aviso)) errores.push(`estado: volver atrás no avisó («${aviso}»)`);
  else paso(`estado · aviso: «${aviso}»`);
  if (!(await p.locator(".c-badge").first().innerText()).match(/Borrador/)) {
    errores.push("estado: el aviso salió pero la insignia no volvió a Borrador");
  } else paso("estado · volvió a Borrador");
}
await foto("C-corregida");

// --- 4. Archivar una cotización que ya no es borrador ---------------------
await p.getByRole("button", { name: "Marcar como emitida" }).click();
await p.waitForTimeout(700);
await p.getByRole("button", { name: "Archivar", exact: true }).click();
await p.waitForTimeout(300);
await foto("D-confirmar-archivado");
await p.getByRole("button", { name: "Sí, archivar" }).click();
await p.waitForURL(/#\/comercial\/cotizaciones$/, { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(600);
if (!/#\/comercial\/cotizaciones$/.test(p.url())) {
  errores.push(`archivado: no volvió a la lista (url ${p.url()})`);
} else paso("archivado · una cotización emitida se archivó y volvió a la lista");
const quedan = await p.locator("table tbody tr").count();
paso(`archivado · quedan ${quedan} cotizaciones en la lista`);
await foto("E-lista");

// --- 5. La pantalla angosta ----------------------------------------------
await p.setViewportSize({ width: 390, height: 844 });
await ir("/comercial");
const ancho = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (ancho > 2) errores.push(`teléfono: la página se desborda ${ancho}px a lo ancho`);
else paso("teléfono · el resumen no se desborda");
await foto("F-telefono");

await b.close();

console.log(`\n${pasos.length} pasos.`);
if (errores.length) { console.log("\nFALLAS:"); for (const e of errores) console.log(" ·", e); process.exit(1); }
console.log("Sin fallas.");
