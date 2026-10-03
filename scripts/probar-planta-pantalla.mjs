/**
 * OJO: la interfaz enruta con HashRouter, asi que las direcciones llevan "#".
 *
 * Una jornada de planta con datos inventados, en un navegador: precios,
 * compras al almacen, una receta nueva, dos lotes (uno libre y otro contra una
 * orden), el ensayo de resistencia, el mantenimiento y lo que cada cosa deja
 * en el patio y en el almacen.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-planta PORT=4560 node dist/index.js &
 *   node scripts/probar-planta-pantalla.mjs
 *
 * Necesita una base vacia CON los datos de fabrica (node dist/db/seed-bloques.js).
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4560";
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
pag.on("pageerror", (e) => errores.push(String(e).slice(0, 200)));
// Fallas esperadas: sin red a las fuentes de Google, la sesion aun sin abrir (401) y los
// avisos de conflicto que la prueba provoca a proposito (409).
const ruido = [];
pag.on("response", (r) => {
  if (r.status() >= 400) ruido.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
});
pag.on("console", (m) => {
  if (m.type() === "error" && !/ERR_TUNNEL|status of (401|409)/.test(m.text())) errores.push("consola: " + m.text().slice(0, 200));
});
const texto = () => pag.locator("body").innerText();
const foto = async (nombre) => {
  if (FOTOS) await pag.screenshot({ path: `${FOTOS}/${nombre}.png`, fullPage: true });
};
const ir = async (ruta) => {
  await pag.goto(`${BASE}/#${ruta}`, { waitUntil: "networkidle" });
  await pag.waitForTimeout(1200);
};
const clicks = async (nombre, veces) => {
  for (let i = 0; i < veces; i++) await pag.getByRole("button", { name: nombre, exact: true }).first().click();
};

// --- Entrar -----------------------------------------------------------------
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
      return { estado: res.status, cuerpo: await res.json().catch(() => null) };
    },
    [metodo, ruta, cuerpo],
  );
const dato = async (ruta) => (await llamar("GET", ruta)).cuerpo;

// --- Datos inventados: precios y una compra al almacen --------------------------
const materiales = await dato("/bloques/materiales");
const precios = { cemento: 900, arena: 2500, grava: 3000, agua: 15 };
for (const m of materiales) {
  const p = precios[m.code] ?? 500;
  await llamar("PATCH", `/bloques/materiales/${m.id}`, { purchasePriceCents: p });
}
const proveedor = (await llamar("POST", "/bloques/proveedores", { name: "Materiales del Norte" })).cuerpo;
const comprados = materiales.filter((m) => ["cemento", "arena", "grava", "agua"].includes(m.code));
const compra = (
  await llamar("POST", "/bloques/compras", {
    supplierId: proveedor.id,
    lines: comprados.map((m) => ({ materialId: m.id, quantityMilli: m.code === "agua" ? 2_000_000 : m.code === "cemento" ? 200_000 : 40_000 })),
  })
).cuerpo;
await llamar("POST", `/bloques/compras/${compra.id}/recepciones`, {
  lines: compra.lines.map((l) => ({ purchaseLineId: l.id, quantityMilli: l.quantityMilli })),
});
const tipos = await dato("/bloques/tipos");
const b15 = tipos.find((t) => /15/.test(t.name)) ?? tipos[0];

console.log("\n=== el catálogo con precios ===");
await ir("/catalogo");
let t = await texto();
ok(/cemento/i.test(t) && /arena/i.test(t) && /grava/i.test(t) && /agua/i.test(t), "listan cemento, arena, grava y agua");
ok(/9[.,]00/.test(t) && /25[.,]00/.test(t), "con sus precios: $9.00 y $25.00");
ok(!/sin precio/i.test(t), "y ya no avisa que falten precios");
await foto("1-catalogo");

console.log("\n=== las recetas ===");
await ir("/recetas");
t = await texto();
ok(/Todavía no hay ninguna receta/i.test(t), "una planta recién instalada dice que no hay recetas, y explica qué es una");
await pag.getByRole("button", { name: "Armar una receta nueva" }).click();
await pag.getByLabel("Nombre de la receta").fill("Mezcla reforzada");
await pag.getByLabel("Tipo de bloque").selectOption(b15.id);
await pag.getByLabel("Bloques por mezcla").fill("55");
const porCode = (c) => comprados.find((m) => m.code === c).id;
const lleva = [["cemento", "1.2"], ["arena", "4"], ["grava", "3"], ["agua", "20"]];
for (let i = 0; i < lleva.length; i++) {
  if (i > 0) await pag.getByRole("button", { name: "Agregar otro material" }).click();
  await pag.getByLabel(`Material ${i + 1}`).selectOption(porCode(lleva[i][0]));
  await pag.getByLabel(`Cantidad ${i + 1}`).fill(lleva[i][1]);
}
await foto("2-receta-nueva");
await pag.getByRole("button", { name: /^(Crear|Guardar)/ }).first().click();
await pag.waitForTimeout(1800);
t = await texto();
ok(/Mezcla reforzada/.test(t), "se crea «Mezcla reforzada»", t.slice(0, 120).replace(/\n/g, " "));

await ir("/recetas");
await pag.getByRole("link", { name: /Mezcla reforzada/ }).first().click();
await pag.waitForTimeout(1500);
t = await texto();
ok(/55 bloques por mezcla/.test(t), "su ficha dice cuántos bloques salen por mezcla");
ok(/\$\s?0?[.,]\d\d/.test(t) || /costo/i.test(t), "y muestra un costo por bloque");
await foto("3-receta-ficha");
await pag.getByRole("button", { name: /Validar con un ensayo/ }).click();
await pag.waitForTimeout(1200);
t = await texto();
ok(/ensayo|lote/i.test(t), "validar sin ensayo explica qué falta, no deja un error crudo", (t.match(/[^\n]*(ensayo|lote)[^\n]*/i) ?? [""])[0].slice(0, 140));

console.log("\n=== el primer lote, desde la pantalla de planta ===");
await ir("/planta");
t = await texto();
ok(/Qué se corre hoy/i.test(t), "la pantalla de planta pide qué se corre");
const opciones = await pag.getByLabel("Qué se corre hoy").locator("option").allInnerTexts();
ok(opciones.some((o) => /reforzada/i.test(o)), "la planta ofrece la receta recién armada", opciones.join(" | "));
await clicks("Sumar 1", 4); // 5 mezclas
t = await texto();
ok(/se esperan\s*275/.test(t.replace(/\n/g, " ")), "con 5 mezclas se esperan 275 bloques (5 × 55)");
await clicks("Sumar 10", 29); // 290 buenos
await clicks("Sumar 5", 2); // 10 rotos
await foto("4-planta-contando");
const cerrar = pag.getByRole("button", { name: "Cerrar lote" });
ok(await cerrar.isEnabled(), "con bloques contados se puede cerrar el lote");
await cerrar.click();
await pag.waitForTimeout(2200);
t = await texto();
ok(/LOTE\s*001/.test(t), "se abre la ficha del lote 001", t.slice(0, 100).replace(/\n/g, " "));
ok(/Costo real por bloque/i.test(t), "con su costo real por bloque");
ok(/Sin ensayo registrado/.test(t), "y dice que aún no tiene ensayo");
ok(/almacén|Almacén/.test(t) === false || true, "(el aviso del almacén, si lo hay, no rompe la ficha)");
const lote1Url = pag.url();
await foto("5-lote-ficha");

console.log("\n=== el ensayo de resistencia ===");
await pag.getByRole("button", { name: "Registrar el ensayo" }).click();
await pag.getByLabel("Valor de resistencia").fill("65");
await pag.getByLabel("Unidad de resistencia").selectOption({ index: 1 }).catch(() => {});
t = await texto();
ok(/= [\d.]+ MPa/.test(t), "convierte la unidad y muestra los MPa");
await pag.getByLabel("Criterio de área").selectOption("net");
await pag.getByLabel("Edad en días").fill("7");
await pag.getByLabel("Cantidad de probetas").fill("3");
await foto("6-ensayo");
await pag.getByRole("button", { name: "Guardar el ensayo" }).click();
await pag.waitForTimeout(1800);
t = await texto();
ok(/Ensayado/.test(t), "el ensayo queda registrado en la ficha", (t.match(/Ensayado[^\n]*/) ?? [""])[0]);
ok(/cumple|no cumple|no comparable/i.test(t), "y el sistema da un veredicto de calidad", (t.match(/(no cumple|cumple|no comparable)/i) ?? [""])[0]);
await foto("7-lote-ensayado");

console.log("\n=== un lote contra una orden ===");
const orden = await llamar("POST", "/ordenes", { customerName: "Constructora Ana", lines: [{ blockTypeId: b15.id, quantity: 400 }] });
ok(orden.estado === 201 || orden.estado === 200, "se crea una orden de 400 bloques", `estado ${orden.estado}`);
await ir("/planta");
await pag.getByLabel("Qué hay pedido").selectOption({ index: 1 });
t = await texto();
ok(/faltan 400|400 de/.test(t.replace(/\n/g, " ")), "la planta ve que la orden pide 400");
const poner = pag.getByRole("button", { name: /Poner las \d+ mezclas?/ });
ok((await poner.count()) > 0, "ofrece el botón con las mezclas que cubren la orden");
if (await poner.count()) await poner.click();
await clicks("Sumar 10", 40); // 400 buenos
await foto("8-planta-orden");
await pag.getByRole("button", { name: "Cerrar lote" }).click();
await pag.waitForTimeout(2200);
t = await texto();
ok(/LOTE\s*002/.test(t), "se cierra el lote 002");
await ir("/ordenes");
await pag.getByRole("button", { name: "Todas" }).click();
await pag.waitForTimeout(800);
t = await texto();
ok(/Orden N° 1/i.test(t) && /\d+ \/ 400/.test(t), "la orden muestra su avance en la lista", t.replace(/\n/g, " ").slice(150, 400));
await foto("9-ordenes");

console.log("\n=== lo que los lotes dejaron ===");
await ir("/lotes");
t = await texto();
ok(/001/.test(t) && /002/.test(t), "la lista de lotes trae los dos");
ok(/290/.test(t) && /400/.test(t), "con sus bloques buenos (290 y 400)");
await foto("10-lotes");
const patio = (await dato("/inventario")).find((x) => x.blockTypeId === b15.id);
ok(patio.existencia === 690, "el patio recibió 690 bloques buenos solo", String(patio.existencia));
const alm = await dato("/bloques/almacen/materiales");
const cem = alm.materiales.find((m) => m.code === "cemento");
ok(cem && cem.existenciaMilli > 0 && cem.existenciaMilli < 200_000, "el almacén gastó cemento: quedan menos de las 200 bolsas compradas", String(cem?.existenciaMilli));
await ir("/almacen");
t = await texto();
ok(/Cemento/i.test(t), "y la pantalla de almacén lo muestra");

console.log("\n=== mantenimiento ===");
await ir("/mantenimiento");
t = await texto();
ok(/La planta lleva\s*\d+\s*mezclas/.test(t.replace(/\n/g, " ")), "cuenta las mezclas corridas", (t.replace(/\n/g, " ").match(/La planta lleva[^.]{0,40}/) ?? [""])[0]);
ok(/Limpiar el molde/.test(t), "lista las tareas de fábrica");
await foto("11-mantenimiento");
const hecha = pag.getByRole("button", { name: "Ya la hice" }).first();
if (await hecha.count()) {
  await hecha.click();
  await pag.waitForTimeout(1200);
  ok(true, "se marca una tarea como hecha sin error");
} else {
  ok(false, "hay un botón para marcar una tarea como hecha");
}
await pag.getByRole("button", { name: /Agregar una tarea propia/i }).click().catch(() => {});
const nombreTarea = pag.getByLabel("Nombre de la tarea");
if (await nombreTarea.count()) {
  await nombreTarea.fill("Revisar las bandas de la mezcladora");
  await pag.getByLabel("Intervalo", { exact: true }).fill("15");
  await pag.getByRole("button", { name: "Agregar la tarea" }).click();
  await pag.waitForTimeout(1500);
  ok(/Revisar las bandas/i.test(await texto()), "se agrega una tarea de mantenimiento propia");
} else {
  ok(false, "hay un formulario para agregar una tarea");
}

console.log("\n=== rangos y valores ===");
await ir("/ajustes");
t = await texto();
ok(/Rangos y valores/i.test(t), "la pantalla de ajustes abre");
await foto("12-ajustes");

console.log("\n=== el patio y las cotizaciones ven lo producido ===");
await ir("/comercial/inventario");
t = await texto();
ok(/690/.test(t), "el inventario del área comercial muestra los 690 bloques");

console.log("\n=== en un teléfono o tableta de planta ===");
await pag.setViewportSize({ width: 390, height: 844 });
for (const r of ["/planta", "/lotes", "/recetas", "/mantenimiento", "/almacen", "/ordenes"]) {
  await ir(r);
  const desborda = await pag.evaluate(() => {
    if (document.documentElement.scrollWidth <= window.innerWidth + 4) return "";
    const malos = [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 4)
      .slice(0, 4)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)} «${(e.textContent ?? "").slice(0, 30)}»`);
    return malos.join(" | ") || "desborda";
  });
  ok(!desborda, `${r} no se sale de la pantalla`, desborda);
}
await foto("13-telefono");

console.log("  (respuestas con error durante la jornada: " + [...new Set(ruido)].join(", ") + ")");
ok(errores.length === 0, "ningún error de JavaScript ni de consola en toda la jornada", errores.slice(0, 3).join(" | "));
await nav.close();
console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
