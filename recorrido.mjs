/**
 * Recorrido de una planta nueva, en el navegador de verdad.
 *
 * No comprueba que el código compile —eso ya lo dice tsc—; comprueba que
 * alguien que abre la app sin nada cargado pueda llegar hasta producir. Cada
 * paso hace clic donde haría clic una persona.
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const errores = [];
const SUFIJO = String(Date.now()).slice(-5);
const pasos = [];

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const p = await ctx.newPage();
p.on("console", (m) => { if (m.type() === "error") errores.push(`consola: ${m.text()}`); });
p.on("pageerror", (e) => errores.push(`excepción: ${e.message}`));

async function ir(ruta) {
  await p.goto(`${BASE}/#${ruta}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
}
async function foto(n) { await p.screenshot({ path: `/tmp/shots/${n}.png`, fullPage: true }); }
function paso(t) { pasos.push(t); console.log("·", t); }

// --- 0. Planta virgen: sin historial -----------------------------------------
await fetch(`${BASE}/bloques/reiniciar-produccion`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ confirmacion: "BORRAR" }),
});

// --- 1. Agregar un material --------------------------------------------------
await ir("/catalogo");
await p.getByRole("button", { name: "Agregar un material" }).click();
await p.getByLabel("Nombre del material").fill(`Arena de prueba ${SUFIJO}`);
await p.getByLabel("Unidad de compra").fill("m3");
await p.getByLabel("Precio", { exact: true }).fill("30.00");
const opciones = await p.getByLabel("Unidad de dosificación").locator("option").allTextContents();
const carretilla = opciones.find((o) => /carretilla/i.test(o));
if (!carretilla) errores.push("catálogo: no hay unidad «carretilla» para dosificar");
else await p.getByLabel("Unidad de dosificación").selectOption({ label: carretilla });
await p.getByLabel("Equivalencia").fill("11");
await p.waitForTimeout(200);
const previaMat = await p.locator("text=/Sale a \\$/").first().innerText().catch(() => "");
if (!/2\.7273/.test(previaMat)) errores.push(`catálogo: la previa de precio dice "${previaMat}", se esperaba $2.7273 ($30 ÷ 11)`);
paso(`catálogo · previa de precio unitario: ${previaMat}`);
await foto("A-material-nuevo");
await p.getByRole("button", { name: "Agregar al catálogo" }).click();
await p.waitForTimeout(900);
if (!(await p.locator(`text=Arena de prueba ${SUFIJO}`).first().isVisible())) {
  errores.push("catálogo: el material nuevo no aparece en la tabla");
} else paso("catálogo · el material nuevo aparece en la tabla");

// --- 2. Armar una receta -----------------------------------------------------
await ir("/recetas");
await p.getByRole("button", { name: "Armar una receta nueva" }).click();
await p.getByLabel("Nombre de la receta").fill(`Mezcla de prueba nocturna ${SUFIJO}`);
const tipos = await p.getByLabel("Tipo de bloque").locator("option").allTextContents();
await p.getByLabel("Tipo de bloque").selectOption({ index: 1 });
paso(`recetas · tipo de bloque elegido: ${tipos[1]}`);
await p.getByLabel("Bloques por mezcla").fill("60");
await p.getByLabel("Material 1").selectOption({ label: "Cemento gris" }).catch(async () => {
  await p.getByLabel("Material 1").selectOption({ index: 1 });
});
await p.getByLabel("Cantidad 1").fill("1");
await p.getByRole("button", { name: "Agregar otro material" }).click();
await p.getByLabel("Material 2").selectOption({ label: `Arena de prueba ${SUFIJO}` });
await p.getByLabel("Cantidad 2").fill("4");
await p.waitForTimeout(300);
const previaCosto = await p.locator(".cifra.mono").first().innerText();
paso(`recetas · costo por bloque en vivo: ${previaCosto}`);
await foto("B-receta-nueva");

// El material repetido tiene que avisar.
await p.getByRole("button", { name: "Agregar otro material" }).click();
await p.getByLabel("Material 3").selectOption({ label: `Arena de prueba ${SUFIJO}` });
await p.getByLabel("Cantidad 3").fill("2");
await p.waitForTimeout(300);
if (!(await p.locator("text=material repetido").first().isVisible().catch(() => false))) {
  errores.push("recetas: repetir un material no avisó");
} else paso("recetas · repetir un material avisa y bloquea el guardado");
await p.getByRole("button", { name: "Quitar" }).last().click();
await p.waitForTimeout(300);

await p.getByRole("button", { name: "Crear la receta" }).click();
await p.waitForTimeout(1200);
if (!/#\/recetas\//.test(p.url())) errores.push(`recetas: no navegó a la receta creada (url ${p.url()})`);
else paso("recetas · creada y abierta");
await foto("C-receta-creada");

// --- 3. Validar sin ensayo: tiene que negarse --------------------------------
await p.getByRole("button", { name: "Validar con un ensayo" }).click();
await p.waitForTimeout(900);
const negativa = await p.locator(".aviso.rojo").first().innerText().catch(() => "");
if (!/ensayo/i.test(negativa)) errores.push(`receta: validar sin ensayo no explicó por qué («${negativa}»)`);
else paso(`receta · validar sin ensayo: «${negativa.slice(0, 80)}…»`);

// --- 4. Correr un lote de prueba con la receta sin validar -------------------
await ir("/planta");
await p.getByLabel("Qué se corre hoy").selectOption({ label: new RegExp(`Mezcla de prueba nocturna ${SUFIJO}`) }).catch(async () => {
  const etiquetas = await p.locator("select option").allTextContents();
  const mia = etiquetas.find((t) => t.includes(SUFIJO));
  if (!mia) errores.push(`planta: la receta recién creada no está en el selector (${etiquetas.join(" | ")})`);
  else await p.locator("select").first().selectOption({ label: mia });
});
await p.waitForTimeout(400);
const avisoPrueba = await p.locator(".aviso.ambar").first().innerText().catch(() => "");
if (!/no pasó un ensayo/i.test(avisoPrueba)) {
  errores.push(`planta: no avisó que la receta está sin validar («${avisoPrueba.slice(0, 60)}»)`);
} else paso("planta · avisa que la receta corre sin respaldo de ensayo");
await p.getByLabel("Sumar 10").click();
for (let i = 0; i < 5; i++) await p.getByLabel("Sumar 10").click();
await foto("D-planta");
await p.getByRole("button", { name: "Cerrar lote" }).click();
await p.waitForTimeout(1500);
if (!/#\/lotes\//.test(p.url())) errores.push(`planta: cerrar lote no llevó a la ficha (url ${p.url()})`);
else paso("planta · lote cerrado, va a la ficha");

// --- 5. Registrar el ensayo en kg/cm² ---------------------------------------
await p.getByRole("button", { name: "Registrar el ensayo" }).click();
await p.getByLabel("Valor de resistencia").fill("175");
await p.waitForTimeout(300);
const convertido = await p.locator("text=/= [0-9.]+ MPa/").first().innerText();
if (!/17\.2/.test(convertido)) errores.push(`ensayo: 175 kg/cm² se convirtió a «${convertido}», se esperaba 17.2 MPa`);
else paso(`ensayo · 175 kg/cm² ${convertido}`);

// La unidad equivocada tiene que gritar.
await p.getByLabel("Unidad de resistencia").selectOption("MPa");
await p.waitForTimeout(300);
const grito = await p.locator(".aviso.rojo").first().innerText().catch(() => "");
if (!/no es resistencia de bloque/i.test(grito)) {
  errores.push("ensayo: 175 MPa no disparó el aviso de unidad equivocada");
} else paso("ensayo · 175 MPa dispara el aviso de unidad equivocada");
await foto("E-ensayo-unidad-mala");
await p.getByLabel("Unidad de resistencia").selectOption("kg/cm2");

await p.getByLabel("Criterio de área").selectOption("net");
await p.getByRole("button", { name: "Guardar el ensayo" }).click();
await p.waitForTimeout(1500);
const veredicto = await p.locator(".insignia").first().innerText().catch(() => "");
if (!/cumple/i.test(veredicto)) errores.push(`ficha: tras el ensayo el veredicto dice «${veredicto}»`);
else paso(`ficha · veredicto tras el ensayo: ${veredicto}`);
await foto("F-ficha-con-ensayo");

// --- 6. Ahora sí, validar ----------------------------------------------------
const recetas = await (await fetch(`${BASE}/bloques/recetas`)).json();
const nueva = recetas.find((r) => r.name === `Mezcla de prueba nocturna ${SUFIJO}`);
await ir(`/recetas/${nueva.id}`);
await p.getByRole("button", { name: "Validar con un ensayo" }).click();
await p.waitForTimeout(1200);
const estado = await p.locator(".insignia").first().innerText();
if (!/validada/i.test(estado)) errores.push(`receta: después del ensayo sigue en «${estado}»`);
else paso("receta · validada con el ensayo que la respalda");
await foto("G-receta-validada");

// --- 7. Mantenimiento: puesto y tarea propios -------------------------------
await ir("/mantenimiento");
await p.getByRole("button", { name: "Agregar un puesto" }).click();
await p.getByLabel("Nombre del puesto").fill(`Encargada de turno ${SUFIJO}`);
await p.getByLabel("Descripción del puesto").fill("Revisa la corrida y firma el lote");
await p.getByRole("button", { name: "Agregar el puesto" }).click();
await p.waitForTimeout(1000);
if (!(await p.locator(`text=Encargada de turno ${SUFIJO}`).first().isVisible())) {
  errores.push("mantenimiento: el puesto nuevo no apareció");
} else paso("mantenimiento · puesto nuevo creado");

await p.getByRole("button", { name: "Agregar una tarea propia de esta planta" }).click();
await p.getByLabel("Nombre de la tarea").fill(`Engrasar las guías del molde ${SUFIJO}`);
await p.getByLabel("Intervalo", { exact: true }).fill("12");
await p.getByLabel("Puesto responsable").selectOption({ label: `Encargada de turno ${SUFIJO}` });
await p.getByRole("button", { name: "Agregar la tarea" }).click();
await p.waitForTimeout(1200);
if (!(await p.locator(`text=Engrasar las guías del molde ${SUFIJO}`).first().isVisible())) {
  errores.push("mantenimiento: la tarea nueva no apareció en el tablero");
} else paso("mantenimiento · tarea propia creada y en el tablero");
await foto("H-mantenimiento");

// --- 8. Teléfono -------------------------------------------------------------
const tel = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const pt = await tel.newPage();
await pt.goto(`${BASE}/#/planta`, { waitUntil: "networkidle" });
await pt.waitForTimeout(700);
const anchoDoc = await pt.evaluate(() => document.documentElement.scrollWidth);
if (anchoDoc > 391) errores.push(`teléfono: la página se desborda a lo ancho (${anchoDoc}px en 390)`);
else paso("teléfono · la pantalla de planta no se desborda");
await pt.screenshot({ path: "/tmp/shots/I-telefono.png", fullPage: true });

await b.close();

console.log("\n=== PASOS ===");
pasos.forEach((s) => console.log("  ✓", s));
console.log(`\n=== ${errores.length} PROBLEMA(S) ===`);
errores.forEach((e) => console.log("  ✗", e));
process.exit(errores.length ? 1 : 0);
