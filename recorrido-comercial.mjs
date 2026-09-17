/**
 * Recorrido del área comercial en el navegador de verdad.
 *
 * Lo que comprueba no es que el código compile —eso ya lo dice tsc— sino que
 * alguien que se equivoca de botón pueda arreglarlo sin llamar a nadie. Cada
 * paso hace clic donde haría clic una persona.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4310";
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
  const aviso = await p.locator(".c-avisos").first().innerText().catch(() => "");
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

// --- 4b. La ficha financiera, editada a punta de clics ---------------------
await ir("/comercial/clientes/" + cliente.id);
const celdaLimite = p.locator(".c-credito > div").first().locator(".c-celda");
if (!(await celdaLimite.isVisible().catch(() => false))) {
  errores.push("ficha: no aparece el límite de crédito en el expediente del cliente");
} else {
  await celdaLimite.click();
  // Pegado de una planilla, con coma de miles.
  await p.locator(".c-credito input").first().fill("1,200");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(800);
  const limite = await p.locator(".c-credito > div").first().locator(".c-celda").innerText();
  if (!/1,200\.00/.test(limite)) errores.push(`ficha: el límite quedó en "${limite}", se esperaba $1,200.00`);
  else paso(`ficha · límite de crédito guardado con un clic: ${limite}`);
}
// El plazo, un número libre de días.
await p.locator(".c-credito > div").nth(1).locator(".c-celda").click();
await p.locator(".c-credito input").first().fill("45");
await p.keyboard.press("Enter");
await p.waitForTimeout(700);
const plazo = await p.locator(".c-credito > div").nth(1).locator(".c-celda").innerText();
if (plazo.trim() !== "45") errores.push(`ficha: el plazo quedó en "${plazo}"`);
else paso("ficha · plazo de 45 días");
await foto("G-ficha-credito");

// Un precio propio, más barato que el catálogo.
await p.getByRole("button", { name: "+ Agregar precio acordado" }).click();
await p.waitForTimeout(700);
await p.locator(".c-ficha tbody tr").first().locator("select").selectOption({ index: 1 });
await p.waitForTimeout(600);
await p.locator(".c-ficha tbody tr").first().locator(".c-num .c-celda").click();
await p.locator(".c-ficha tbody input").first().fill("0.58");
await p.keyboard.press("Enter");
await p.waitForTimeout(800);
const precioPropio = await p.locator(".c-ficha tbody tr").first().locator(".c-num .c-celda").innerText();
if (!/0\.58/.test(precioPropio)) errores.push(`ficha: el precio propio quedó en "${precioPropio}"`);
else paso(`ficha · precio acordado con este cliente: ${precioPropio}`);

// Una nota de plata.
await p.locator(".c-nota-nueva textarea").fill("Pidio prorroga hasta fin de mes");
await p.getByRole("button", { name: "Anotar" }).click();
await p.waitForTimeout(800);
const libreta = await p.locator(".c-libreta li").count();
if (libreta < 1) errores.push("ficha: la nota de plata no se guardó");
else paso(`ficha · ${libreta} nota de plata en la libreta`);
await foto("H-ficha-precios-notas");

// --- 4c. Y que la cotización lo use ----------------------------------------
await ir("/comercial/cotizaciones/nueva");
await p.getByLabel("Cliente o prospecto").selectOption({ label: `Constructora Serpas ${SUF}` });
await p.getByLabel("Producto partida 1").selectOption({ index: 1 });
await p.getByLabel("Cantidad partida 1").fill("5000");
await p.waitForTimeout(400);
await p.getByRole("button", { name: "Guardar cotización" }).click();
await p.waitForURL(/#\/comercial\/cotizaciones\/[0-9a-f-]{36}$/, { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(800);
const textoAvisos = await p.locator(".c-avisos").innerText().catch(() => "");
if (!/precio acordado/i.test(textoAvisos)) errores.push(`cotización: no avisó que usó el precio acordado («${textoAvisos.slice(0, 80)}»)`);
else paso("cotización · avisa que tomó el precio acordado y no el del catálogo");
if (!/límite de crédito/i.test(textoAvisos)) errores.push("cotización: no avisó que se pasa del límite de crédito");
else paso("cotización · avisa que pasa el límite, y se guardó igual");
const totalAcordado = await p.locator(".c-paper-totals .c-grand dd").first().innerText().catch(() => "");
if (!/3,277\.00/.test(totalAcordado)) errores.push(`cotización: el total con precio acordado dio "${totalAcordado}", se esperaba $3,277.00`);
else paso(`cotización · 5000 × $0.58 + 13% = ${totalAcordado}`);
await foto("I-cotizacion-con-acuerdo");

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
