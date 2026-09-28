/**
 * El circulo entero en un navegador: enlazar el producto con su tipo de
 * bloque, producir, ver el patio, ajustar un conteo, y que la cotizacion diga
 * sola cuanto falta fabricar.
 *
 * OJO: la interfaz enruta con HashRouter, asi que las direcciones llevan "#".
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-circulo node dist/db/migrate.js
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-circulo node dist/db/seed-bloques.js
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-circulo PORT=4410 node dist/index.js &
 *   node scripts/probar-circulo.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? "http://127.0.0.1:4410";
const CLAVE = process.env.CLAVE_PRUEBA ?? "unaClaveLarga1";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};

const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 1400, height: 1000 } });
const pag = await ctx.newPage();
const errores = [];
pag.on("pageerror", (e) => errores.push(String(e).slice(0, 160)));
const texto = () => pag.locator("body").innerText();

await pag.goto(BASE, { waitUntil: "networkidle" });
await pag.waitForTimeout(900);
await pag.getByLabel("Nombre").fill("Amada");
await pag.getByLabel("Correo").fill("amada@bloquestitan.com");
await pag.getByLabel("Contraseña").fill(CLAVE);
await pag.getByRole("button", { name: /Crear la cuenta/i }).click();
await pag.waitForTimeout(2500);

const api = (ruta, cuerpo, metodo = "POST") =>
  pag.evaluate(
    async ([r, c, m]) => {
      const res = await fetch(r, { method: m, headers: c ? { "content-type": "application/json" } : undefined, body: c ? JSON.stringify(c) : undefined });
      return res.json();
    },
    [ruta, cuerpo ?? null, metodo],
  );

console.log("\n=== el patio arranca vacío ===");
await pag.goto(`${BASE}/#/comercial/inventario`, { waitUntil: "networkidle" });
await pag.waitForTimeout(1800);
const t0 = await texto();
ok(/Inventario/.test(t0), "la pantalla abre");
ok(/no corresponden a ningún producto|no corresponde a ningún producto/.test(t0), "avisa que los bloques no están enlazados al catálogo");

console.log("\n=== enlazar el producto con su tipo de bloque ===");
const tipos = await api("/bloques/tipos", null, "GET");
const producto = await api("/catalog-items", { name: tipos[0].name, code: "VENTA-1", type: "product", unit: "unidad", unitPriceCents: 45 });
await pag.goto(`${BASE}/#/comercial/productos`, { waitUntil: "networkidle" });
await pag.waitForTimeout(1800);
ok(/sin enlazar/.test(await texto()), "el producto aparece como sin enlazar");

await pag.getByRole("button", { name: "Editar" }).first().click();
await pag.waitForTimeout(900);
await pag.getByLabel(/Qué bloque es, en producción/i).selectOption({ label: tipos[0].name });
await pag.getByRole("button", { name: /Guardar producto/i }).click();
await pag.waitForTimeout(2500);
ok((await texto()).includes(tipos[0].name), "queda enlazado y se ve en la columna", tipos[0].name);

console.log("\n=== producir mete bloques al patio ===");
const materiales = await api("/bloques/materiales", null, "GET");
const receta = await api("/bloques/recetas", {
  code: "R-1", name: "Mezcla estándar", blockTypeId: tipos[0].id, expectedBlocksPerMix: 60,
  renglones: materiales.slice(0, 3).map((m) => ({ materialId: m.id, quantityMilli: 5000 })),
});
await api("/bloques/lotes", { recipeId: (receta.receta ?? receta).id, mixes: 10, blocksGood: 600, blocksBroken: 30 });

await pag.goto(`${BASE}/#/comercial/inventario`, { waitUntil: "networkidle" });
await pag.waitForTimeout(1800);
const t1 = await texto();
ok(/600/.test(t1), "el patio muestra 600 sin que nadie los escribiera");
ok(!/630/.test(t1), "los 30 rotos no entraron");

console.log("\n=== de dónde sale ese número ===");
await pag.getByRole("button", { name: /De dónde sale/i }).first().click();
await pag.waitForTimeout(1500);
const t2 = await texto();
ok(/Producción/.test(t2), "se puede abrir y ver el movimiento que lo explica");
ok(/\+600/.test(t2), "con su cantidad", (t2.match(/\+\d+/) ?? [])[0]);

console.log("\n=== ajustar contando el patio de verdad ===");
await pag.getByRole("button", { name: /^Ajustar$/ }).first().click();
await pag.waitForTimeout(900);
await pag.getByLabel(/Cuántos hay/i).fill("540");
await pag.getByLabel(/Por qué se ajusta/i).fill("Conteo físico del sábado");
await pag.waitForTimeout(400);
ok(/movimiento de.*-60|−60/.test(await texto()), "calcula solo la diferencia: −60");
await pag.getByRole("button", { name: /Guardar el conteo/i }).click();
await pag.waitForTimeout(2500);
ok(/540/.test(await texto()), "el patio queda en 540");

console.log("\n=== y la cotización ya sabe qué falta fabricar ===");
const cliente = await api("/customers", { name: "Constructora del Valle", type: "company", nrc: "123456-7" });
const cot = await api("/quotes", { customerId: cliente.id, lines: [{ catalogItemId: producto.id, quantity: 1000 }], taxRatePercent: 13 });
await pag.goto(`${BASE}/#/comercial/cotizaciones/${cot.id}`, { waitUntil: "networkidle" });
await pag.waitForTimeout(2200);
const t3 = await texto();
ok(/Para poder entregar esto/.test(t3), "aparece el panel de producción");
ok(/460/.test(t3), "dice que faltan 460 de los 1000", (t3.match(/faltan \d+/) ?? [])[0]);
ok(/540/.test(t3), "y que hay 540 en el patio");

const cotChica = await api("/quotes", { customerId: cliente.id, lines: [{ catalogItemId: producto.id, quantity: 300 }], taxRatePercent: 13 });
await pag.goto(`${BASE}/#/comercial/cotizaciones/${cotChica.id}`, { waitUntil: "networkidle" });
await pag.waitForTimeout(2200);
ok(/No hace falta producir nada/.test(await texto()), "y para 300 dice que no hace falta producir nada");

console.log(errores.length ? `\n  errores en consola: ${errores.join(" | ")}` : "\n  sin errores en consola");
console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
await nav.close();
process.exit(fallos ? 1 : 0);
