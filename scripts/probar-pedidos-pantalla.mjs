/**
 * OJO: la interfaz enruta con HashRouter, asi que las direcciones llevan "#".
 *
 * Pedidos en un navegador: crear uno, ver que aparta bloques del patio, que
 * otro pedido solo aparta lo libre, mandar a producir lo que falta, cancelar,
 * facturar desde el pedido y crearlo desde una cotizacion.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-ppantalla PORT=4490 node dist/index.js &
 *   node scripts/probar-pedidos-pantalla.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4490";
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
const tipo = (await llamar("GET", "/bloques/tipos"))[0];
const materiales = await llamar("GET", "/bloques/materiales");
const rr = await llamar("POST", "/bloques/recetas", {
  code: "R-PP", name: "Mezcla", blockTypeId: tipo.id, expectedBlocksPerMix: 60,
  renglones: materiales.slice(0, 3).map((m) => ({ materialId: m.id, quantityMilli: 5000 })),
});
await llamar("POST", "/bloques/lotes", { recipeId: (rr.receta ?? rr).id, mixes: 10, blocksGood: 600, blocksBroken: 0 });
const producto = await llamar("POST", "/catalog-items", { name: "Bloque de 15", code: "PP-1", type: "product", unit: "unidad", unitPriceCents: 45 });
await llamar("PATCH", `/catalog-items/${producto.id}/tipo-bloque`, { blockTypeId: tipo.id });
const ana = await llamar("POST", "/customers", { name: "Constructora Ana", type: "company", nrc: "111111-1" });
const beto = await llamar("POST", "/customers", { name: "Don Beto", type: "person" });

console.log("\n=== la pantalla vacía ===");
await ir("/comercial/pedidos");
let t = await texto();
const menu = await pag.locator("nav").first().innerText();
ok(/Pedidos/i.test(menu), "«Pedidos» está en el menú del área comercial");
ok(/No hay pedidos abiertos/i.test(t), "sin pedidos dice que no hay, no deja la pantalla en blanco");
await foto("1-vacia");

console.log("\n=== crear un pedido ===");
await pag.getByRole("link", { name: "Nuevo pedido" }).click();
await pag.waitForTimeout(900);
const bCrear = pag.getByRole("button", { name: "Crear pedido" });
ok(await bCrear.isDisabled(), "sin cliente ni productos el botón está apagado");
await pag.getByLabel("Cliente").selectOption({ label: "Constructora Ana" });
await pag.getByLabel("Producto 1").selectOption({ index: 1 });
await pag.getByLabel("Cantidad 1").fill("400");
t = await texto();
ok(/180[.,]00/.test(t), "el total se calcula al escribir: $180.00");
await foto("2-nuevo");
await bCrear.click();
await pag.waitForTimeout(1600);
t = await texto();
ok(/PED-00001/.test(t), "se crea el pedido PED-00001");
ok(/Constructora Ana/.test(t), "con el nombre del cliente");
ok(/Abierto/i.test(t), "queda abierto");
ok(/Apartado/i.test(t) && /\b400\b/.test(t), "aparta los 400 bloques");
await foto("3-ficha");

console.log("\n=== otro pedido solo aparta lo libre ===");
await ir("/comercial/pedidos/nuevo");
await pag.getByLabel("Cliente").selectOption({ label: "Don Beto" });
await pag.getByLabel("Producto 1").selectOption({ index: 1 });
await pag.getByLabel("Cantidad 1").fill("300");
await pag.getByRole("button", { name: "Crear pedido" }).click();
await pag.waitForTimeout(1600);
t = await texto();
ok(/PED-00002/.test(t), "se crea el PED-00002");
ok(/se apartaron 200 de los 300/.test(t), "avisa que solo se apartaron 200 de 300", (t.match(/se apartaron[^.]*\./) ?? [])[0]);
ok(/Falta producir/i.test(t), "y muestra la columna «Falta producir»");
await foto("4-parcial");

console.log("\n=== el inventario muestra lo apartado ===");
await ir("/comercial/inventario");
t = await texto();
ok(/Apartado/i.test(t) && /Disponible/i.test(t), "el inventario tiene las columnas Apartado y Disponible");
ok(/PED-00001/.test(t) && /PED-00002/.test(t), "y dice qué pedidos los tienen apartados");
await foto("5-inventario");

console.log("\n=== mandar a producir lo que falta ===");
await ir("/comercial/pedidos");
await pag.getByRole("link", { name: "PED-00002" }).click();
await pag.waitForTimeout(1200);
await pag.getByRole("button", { name: "Mandar a producir lo que falta" }).click();
await pag.waitForTimeout(1500);
t = await texto();
ok(/orden N° 1 con lo que falta/.test(t), "se le manda la orden N° 1 a la planta");
const ords = await llamar("GET", "/ordenes?estado=todas");
ok(Array.isArray(ords) && ords.length === 1 && /100/.test(JSON.stringify(ords[0])), "la orden pide 100 bloques: lo que faltaba", JSON.stringify(ords).slice(0, 120));

console.log("\n=== cancelar un pedido ===");
await ir("/comercial/pedidos");
await pag.getByRole("link", { name: "PED-00001" }).click();
await pag.waitForTimeout(1200);
await pag.getByRole("button", { name: "Cancelar pedido" }).click();
const si = pag.getByRole("button", { name: "Sí, cancelar" });
ok(await si.isDisabled(), "no deja cancelar sin motivo");
await pag.getByLabel("Motivo de la cancelación").fill("Cambió de obra");
await si.click();
await pag.waitForTimeout(1500);
t = await texto();
ok(/Cancelado/i.test(t) && /Cambió de obra/.test(t), "queda cancelado con su motivo");
ok(await pag.getByRole("button", { name: "Facturar lo pendiente" }).count() === 0, "y ya no ofrece facturar");

console.log("\n=== volver a apartar y facturar ===");
await ir("/comercial/pedidos");
await pag.getByRole("link", { name: "PED-00002" }).click();
await pag.waitForTimeout(1200);
await pag.getByRole("button", { name: "Apartar lo que haya libre" }).click();
await pag.waitForTimeout(1500);
await pag.getByRole("button", { name: "Facturar lo pendiente" }).click();
await pag.waitForTimeout(2000);
t = await texto();
ok(/FCF-|CCF-/.test(t), "se crea la factura desde el pedido");
await pag.goBack();
await pag.waitForTimeout(1500);
await ir("/comercial/pedidos");
await pag.getByRole("button", { name: "Todos" }).click();
await pag.waitForTimeout(800);
t = await texto();
ok(/Cumplido/i.test(t) && /Cancelado/i.test(t), "la lista «Todos» muestra uno cumplido y uno cancelado");
await foto("6-lista");

console.log("\n=== crear el pedido desde una cotización ===");
const cot = await llamar("POST", "/quotes", { customerId: ana.id, lines: [{ catalogItemId: producto.id, quantity: 20 }], taxRatePercent: 13 });
await ir(`/comercial/cotizaciones/${cot.id}`);
await pag.getByRole("button", { name: /Crear pedido/ }).click();
await pag.waitForTimeout(1800);
t = await texto();
ok(/PED-00003/.test(t), "nace el PED-00003");
ok(/Ver la cotización/.test(t), "con el enlace de vuelta a su cotización");
await ir(`/comercial/cotizaciones/${cot.id}`);
t = await texto();
ok(/PED-00003 abierto/.test(t), "y la cotización ya muestra su pedido en vez del botón");

console.log("\n=== en un teléfono ===");
await pag.setViewportSize({ width: 390, height: 844 });
for (const r of ["/comercial/pedidos", "/comercial/pedidos/nuevo"]) {
  await ir(r);
  const desborda = await pag.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 4);
  ok(!desborda, `${r} no se sale de la pantalla`);
}
await foto("7-telefono");

ok(errores.length === 0, "ningún error de JavaScript en toda la prueba", errores.join(" | "));
await nav.close();
console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
