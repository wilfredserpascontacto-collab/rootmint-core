/**
 * La orden de produccion, de punta a punta y por las pantallas de verdad.
 *
 * Cotizar → pasar a produccion → el maquinista la ve en planta → corre el
 * lote contra ella → entra al inventario → la orden se cierra sola → la
 * cotizacion deja de pedir produccion.
 *
 * OJO: la interfaz enruta con HashRouter, asi que las direcciones llevan "#".
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-orden node dist/db/migrate.js
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-orden node dist/db/seed-bloques.js
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-orden PORT=4420 node dist/index.js &
 *   node scripts/probar-orden.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? "http://127.0.0.1:4420";
const CLAVE = process.env.CLAVE_PRUEBA ?? "unaClaveLarga1";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};

// En algunos entornos el navegador de Playwright vive en otro lado.
const nav = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await nav.newContext({ viewport: { width: 1400, height: 1000 } });
const pag = await ctx.newPage();
const errores = [];
pag.on("pageerror", (e) => errores.push(String(e).slice(0, 160)));
const texto = () => pag.locator("body").innerText();
const esperar = (ms = 1800) => pag.waitForTimeout(ms);

await pag.goto(BASE, { waitUntil: "networkidle" });
await esperar(900);
await pag.getByLabel("Nombre").fill("Amada");
await pag.getByLabel("Correo").fill("amada@bloquestitan.com");
await pag.getByLabel("Contraseña").fill(CLAVE);
await pag.getByRole("button", { name: /Crear la cuenta/i }).click();
await esperar(2500);

const api = (ruta, cuerpo, metodo = "POST") =>
  pag.evaluate(
    async ([r, c, m]) => {
      const res = await fetch(r, {
        method: m,
        headers: c ? { "content-type": "application/json" } : undefined,
        body: c ? JSON.stringify(c) : undefined,
      });
      return { estado: res.status, cuerpo: await res.json().catch(() => null) };
    },
    [ruta, cuerpo ?? null, metodo],
  );

// --- El decorado: un producto enlazado a su bloque, con receta ---------------
const tipos = (await api("/bloques/tipos", null, "GET")).cuerpo;
const tipo = tipos[0];
const producto = (await api("/catalog-items", {
  name: tipo.name, code: "VENTA-1", type: "product", unit: "unidad", unitPriceCents: 45,
})).cuerpo;
await api(`/catalog-items/${producto.id}/tipo-bloque`, { blockTypeId: tipo.id }, "PATCH");
const materiales = (await api("/bloques/materiales", null, "GET")).cuerpo;
const rr = (await api("/bloques/recetas", {
  code: "R-1", name: "Mezcla estándar", blockTypeId: tipo.id, expectedBlocksPerMix: 60,
  renglones: materiales.slice(0, 3).map((m) => ({ materialId: m.id, quantityMilli: 5000 })),
})).cuerpo;
const receta = rr.receta ?? rr;
const cliente = (await api("/customers", { name: "Constructora del Valle", type: "company", nrc: "123456-7" })).cuerpo;

// Algo en el patio, para que la orden tenga que descontarlo.
await api("/bloques/lotes", { recipeId: receta.id, mixes: 3, blocksGood: 180, blocksBroken: 0 });

console.log("\n=== la cotización ofrece pasar a producción ===");
const cot = (await api("/quotes", {
  customerId: cliente.id, lines: [{ catalogItemId: producto.id, quantity: 500 }], taxRatePercent: 13,
})).cuerpo;
await pag.goto(`${BASE}/#/comercial/cotizaciones/${cot.id}`, { waitUntil: "networkidle" });
await esperar(2200);
const t0 = await texto();
ok(/Para poder entregar esto/.test(t0), "el panel de producción está");
ok(/320/.test(t0), "dice que faltan 320 de los 500 (hay 180 en el patio)", (t0.match(/\b320\b/) ?? [])[0]);
ok(await pag.getByRole("button", { name: /Pasar a producción/i }).isVisible(), "y ofrece el botón que pidieron");

console.log("\n=== la orden pide lo que FALTA, no lo que se vendió ===");
await pag.getByRole("button", { name: /Pasar a producción/i }).click();
await esperar(2500);
const t1 = await texto();
ok(/Orden N° 1/.test(t1), "queda creada la orden N° 1");
ok(/0 de 320 bloques fabricados/.test(t1), "y pide 320, no 500", (t1.match(/\d+ de \d+ bloques fabricados/) ?? [])[0]);
ok(/sólo faltan 320 de los 500/.test(t1), "y el panel explica por qué", (t1.match(/sólo faltan[^.]*/) ?? [])[0]);
ok((t1.match(/sólo faltan 320 de los 500/g) ?? []).length === 1, "una sola vez: el mismo aviso repetido no se lee");
ok(!(await pag.getByRole("button", { name: /Pasar a producción/i }).isVisible().catch(() => false)),
   "y el botón desaparece: no se manda dos veces lo mismo");

const orden = (await api("/ordenes?estado=todas", null, "GET")).cuerpo[0];

console.log("\n=== no se puede mandar dos veces la misma cotización ===");
const doble = await api("/ordenes/desde-cotizacion", { quoteId: cot.id });
ok(doble.estado === 409, "el segundo intento se rechaza", `estado ${doble.estado}`);
ok(/ya tiene la orden N° 1/.test(doble.cuerpo?.error ?? ""), "y dice cuál está abierta", doble.cuerpo?.error?.slice(0, 60));

console.log("\n=== el maquinista la ve en su pantalla ===");
await pag.goto(`${BASE}/#/planta`, { waitUntil: "networkidle" });
await esperar(2000);
const t2 = await texto();
ok(/qué hay pedido/i.test(t2), "la planta tiene el selector de órdenes");
ok(/Orden N° 1/.test(t2), "y la orden aparece en la lista");

await pag.getByLabel("Qué hay pedido").selectOption({ index: 1 });
await esperar(900);
const t3 = await texto();
ok(/320 de /.test(t3), "al elegirla dice cuántos faltan de qué bloque", (t3.match(/\d+ de [^\n·]+/) ?? [])[0]);
ok(/Constructora del Valle/.test(t3), "y para quién es");

console.log("\n=== y le calcula las mezclas ===");
ok(/cubren la orden/i.test(t3), "ofrece poner las mezclas que cubren la orden");
await pag.getByRole("button", { name: /cubren la orden/i }).click();
await esperar(700);
ok(/se esperan 360/.test(await texto()), "6 mezclas de 60 para 320 bloques", (await texto()).match(/se esperan \d+/)?.[0]);

console.log("\n=== correr el lote contra la orden ===");
// 300 buenos: deliberadamente menos de los 320, para ver que NO se cierra sola.
await api("/bloques/lotes", { recipeId: receta.id, productionOrderId: orden.id, mixes: 6, blocksGood: 300, blocksBroken: 12 });
const o1 = (await api(`/ordenes/${orden.id}`, null, "GET")).cuerpo;
ok(o1.producido === 300, "la orden lleva 300", String(o1.producido));
ok(o1.falta === 20, "y le faltan 20", String(o1.falta));
ok(o1.status === "en_proceso", "pasó sola a «en proceso»", o1.status);

const inv = (await api("/inventario", null, "GET")).cuerpo.find((x) => x.blockTypeId === tipo.id);
ok(inv.existencia === 480, "y el patio subió a 480 sin que nadie lo escribiera", String(inv.existencia));

console.log("\n=== los rotos no cuentan para la orden ===");
ok(o1.producido !== 312, "los 12 rotos no se cuentan como cumplidos");

console.log("\n=== el último lote la cierra sola ===");
const cierre = await api("/bloques/lotes", { recipeId: receta.id, productionOrderId: orden.id, mixes: 1, blocksGood: 25, blocksBroken: 0 });
ok(/quedó terminada/.test((cierre.cuerpo?.avisos ?? []).join(" ")), "avisa al cerrar el lote", cierre.cuerpo?.avisos?.[0]);
const o2 = (await api(`/ordenes/${orden.id}`, null, "GET")).cuerpo;
ok(o2.status === "terminada", "la orden quedó terminada sin que nadie apretara nada", o2.status);

console.log("\n=== y la cotización ya no pide producir ===");
await pag.goto(`${BASE}/#/comercial/cotizaciones/${cot.id}`, { waitUntil: "networkidle" });
await esperar(2200);
const t4 = await texto();
ok(/No hace falta producir nada/.test(t4), "dice que ya está todo");
ok(/Terminada/.test(t4), "y muestra la orden como terminada");

console.log("\n=== recontar para abajo la vuelve a abrir ===");
const lote = (await api(`/ordenes/${orden.id}`, null, "GET")).cuerpo.lotes.find((l) => l.blocksGood === 300);
await api(`/bloques/lotes/${lote.id}`, { blocksGood: 275 }, "PATCH");
const o3 = (await api(`/ordenes/${orden.id}`, null, "GET")).cuerpo;
ok(o3.status === "en_proceso", "vuelve a estar abierta", o3.status);
ok(o3.falta === 20, "con los 20 que el recuento dejó sin fabricar", String(o3.falta));

console.log("\n=== cerrar a mano exige un porqué ===");
const sinMotivo = await api(`/ordenes/${orden.id}/cerrar`, { reason: "" });
ok(sinMotivo.estado === 400, "no deja cerrar sin explicación", `estado ${sinMotivo.estado}`);

await pag.goto(`${BASE}/#/ordenes/${orden.id}`, { waitUntil: "networkidle" });
await esperar(2000);
await pag.getByRole("button", { name: /Cerrar con lo que hay/i }).click();
await esperar(700);
await pag.getByLabel(/Por qué se cierra/i).fill("El cliente se conformó con lo entregado");
await pag.getByRole("button", { name: /Sí, cerrar/i }).click();
await esperar(2500);
const t5 = await texto();
ok(/quedaron 20 sin fabricar/.test(t5), "al cerrar corta dice cuántos quedaron", (t5.match(/quedaron \d+ sin fabricar/) ?? [])[0]);

console.log("\n=== y un cierre decidido por una persona no lo revierte el sistema ===");
await api(`/bloques/lotes/${lote.id}`, { blocksGood: 300 }, "PATCH");
const o4 = (await api(`/ordenes/${orden.id}`, null, "GET")).cuerpo;
ok(o4.status === "terminada", "la orden cerrada a mano sigue cerrada", o4.status);

console.log("\n=== una orden suelta, sin cotización ===");
const suelta = await api("/ordenes", { lines: [{ blockTypeId: tipo.id, quantity: 120 }], notes: "Para tener existencia" });
ok(suelta.estado === 201, "se puede crear sin cotización", `estado ${suelta.estado}`);
await pag.goto(`${BASE}/#/ordenes`, { waitUntil: "networkidle" });
await esperar(2000);
const cola = await texto();
ok(/Orden N° 2/.test(cola), "y aparece en la cola de la planta");

console.log("\n=== la cola se atiende por antigüedad, y la fecha manda ===");
await api("/ordenes", { lines: [{ blockTypeId: tipo.id, quantity: 80 }] });
const sinFecha = (await api("/ordenes", null, "GET")).cuerpo.map((o) => o.number);
ok(JSON.stringify(sinFecha) === "[2,3]", "sin fecha, primero la que lleva más esperando", JSON.stringify(sinFecha));

await api("/ordenes", { lines: [{ blockTypeId: tipo.id, quantity: 90 }], neededBy: "2026-01-05T00:00:00.000Z" });
const conFecha = (await api("/ordenes", null, "GET")).cuerpo.map((o) => o.number);
ok(conFecha[0] === 4, "y la que tiene fecha se pone adelante", JSON.stringify(conFecha));

console.log("\n=== la receta que no corresponde a la orden se rechaza ===");
const otroTipo = tipos[1];
const otraReceta = (await api("/bloques/recetas", {
  code: "R-2", name: "Otra mezcla", blockTypeId: otroTipo.id, expectedBlocksPerMix: 40,
  renglones: materiales.slice(0, 2).map((m) => ({ materialId: m.id, quantityMilli: 4000 })),
})).cuerpo;
const cruzado = await api("/bloques/lotes", {
  recipeId: (otraReceta.receta ?? otraReceta).id,
  productionOrderId: suelta.cuerpo.id, mixes: 1, blocksGood: 40,
});
ok(cruzado.estado === 409, "no deja cargar un bloque que la orden no pide", `estado ${cruzado.estado}`);
ok(/no pide este tipo de bloque/.test(cruzado.cuerpo?.error ?? ""), "y lo explica", cruzado.cuerpo?.error?.slice(0, 70));

console.log(errores.length ? `\n  errores en consola: ${errores.join(" | ")}` : "\n  sin errores en consola");
console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
await nav.close();
process.exit(fallos ? 1 : 0);
