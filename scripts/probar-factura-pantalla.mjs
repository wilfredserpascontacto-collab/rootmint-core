/**
 * OJO: la interfaz enruta con HashRouter, asi que las direcciones llevan "#"
 * (`/#/comercial/facturas`). Sin el, el navegador entra al inicio y la prueba
 * falla diciendo que falta un boton que si existe.
 *
 * El camino completo en un navegador: cotizar, facturar por partes, ver el
 * papel de cada tipo, anular, y emitir una factura suelta.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-fpantalla PORT=4390 node dist/index.js &
 *   node scripts/probar-factura-pantalla.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? "http://127.0.0.1:4390";
const CLAVE = process.env.CLAVE_PRUEBA ?? "unaClaveLarga1";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};

const nav = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await nav.newContext({ viewport: { width: 1400, height: 950 } });
const pag = await ctx.newPage();
const errores = [];
pag.on("pageerror", (e) => errores.push(String(e).slice(0, 160)));

const texto = () => pag.locator("body").innerText();

// --- Entrar y sembrar --------------------------------------------------------
await pag.goto(BASE, { waitUntil: "networkidle" });
await pag.waitForTimeout(900);
await pag.getByLabel("Nombre").fill("Amada");
await pag.getByLabel("Correo").fill("amada@bloquestitan.com");
await pag.getByLabel("Contraseña").fill(CLAVE);
await pag.getByRole("button", { name: /Crear la cuenta/i }).click();
await pag.waitForTimeout(2500);

const sembrar = (ruta, cuerpo) =>
  pag.evaluate(
    async ([r, c]) => {
      const res = await fetch(r, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) });
      return res.json();
    },
    [ruta, cuerpo],
  );

const constructora = await sembrar("/customers", { name: "Constructora del Valle", type: "company", nrc: "123456-7", nit: "0614-010190-101-2" });
const rosa = await sembrar("/customers", { name: "Rosa Menjívar", type: "person" });
const bloque = await sembrar("/catalog-items", { name: "Bloque 15x20x40", code: "BLQ-15", type: "product", unit: "unidad", unitPriceCents: 45 });
const cot = await sembrar("/quotes", { customerId: constructora.id, lines: [{ catalogItemId: bloque.id, quantity: 1000 }], taxRatePercent: 13 });

console.log("\n=== la cotización ofrece facturar ===");
await pag.goto(`${BASE}/#/comercial/cotizaciones/${cot.id}`, { waitUntil: "networkidle" });
await pag.waitForTimeout(1800);
const t1 = await texto();
ok(/Facturar/.test(t1), "aparece el botón de facturar");
ok(/Todavía no se ha facturado nada/.test(t1), "y dice que no se facturó nada todavía");

console.log("\n=== facturar ===");
await pag.getByRole("button", { name: /^Facturar$/ }).click();
await pag.waitForTimeout(2800);
const t2 = await texto();
ok(/CCF-00001/.test(t2), "se emite el crédito fiscal número 1", (t2.match(/CCF-\d+/) ?? [])[0]);
ok(/CRÉDITO FISCAL/i.test(t2), "el papel dice comprobante de crédito fiscal");
ok(/NRC/.test(t2), "y muestra el NRC del cliente, que es lo que lo justifica");
ok(/IVA 13%/.test(t2), "con el IVA desglosado aparte");
ok(/\$508\.50/.test(t2), "total correcto", (t2.match(/\$[\d,]+\.\d\d/g) ?? []).slice(-1)[0]);

console.log("\n=== la cotización ya lo sabe ===");
await pag.goto(`${BASE}/#/comercial/cotizaciones/${cot.id}`, { waitUntil: "networkidle" });
await pag.waitForTimeout(1800);
ok(/facturada por completo/.test(await texto()), "dice que ya está facturada por completo");

console.log("\n=== anular ===");
await pag.goto(`${BASE}/#/comercial/facturas`, { waitUntil: "networkidle" });
await pag.waitForTimeout(1800);
ok(/CCF-00001/.test(await texto()), "la factura está en la lista");
await pag.getByRole("link", { name: "CCF-00001" }).click();
await pag.waitForTimeout(1800);
await pag.getByRole("button", { name: /^Anular$/ }).click();
await pag.waitForTimeout(500);
const botonAnular = pag.getByRole("button", { name: /^Anular$/ });
ok(await botonAnular.isDisabled(), "sin motivo no deja anular");
await pag.getByLabel("Motivo de la anulación").fill("Se facturó al cliente equivocado");
await pag.waitForTimeout(300);
await botonAnular.click();
await pag.waitForTimeout(2500);
const t3 = await texto();
ok(/Anulada/.test(t3), "queda anulada");
ok(/cliente equivocado/.test(t3), "con su motivo a la vista");
ok(/no se reusa/.test(t3), "y avisa que el número no se reusa");

await pag.goto(`${BASE}/#/comercial/cotizaciones/${cot.id}`, { waitUntil: "networkidle" });
await pag.waitForTimeout(1800);
ok(/Todavía no se ha facturado nada/.test(await texto()), "lo anulado devuelve la cotización a sin facturar");

console.log("\n=== una factura suelta, a consumidor final ===");
await pag.goto(`${BASE}/#/comercial/facturas/nueva`, { waitUntil: "networkidle" });
await pag.waitForTimeout(1600);
await pag.getByLabel("Cliente").selectOption({ label: "Rosa Menjívar" });
await pag.waitForTimeout(700);
ok(/no tiene NRC/.test(await texto()), "avisa que le corresponde consumidor final");
await pag.getByLabel("Producto o servicio").selectOption({ label: "Bloque 15x20x40" });
await pag.waitForTimeout(500);
await pag.getByLabel("Cantidad").fill("50");
await pag.waitForTimeout(300);
await pag.getByRole("button", { name: /Emitir la factura/i }).click();
await pag.waitForTimeout(2800);
const t4 = await texto();
ok(/FCF-00001/.test(t4), "sale la factura de consumidor final número 1", (t4.match(/FCF-\d+/) ?? [])[0]);
ok(/IVA incluido/.test(t4), "y el papel dice que el precio lleva el IVA adentro");
ok(!/IVA 13%/.test(t4), "sin desglosar el IVA, que es lo que la diferencia del crédito fiscal");
ok(/\$0\.51/.test(t4), "el precio unitario se muestra con IVA: $0.45 + 13% = $0.51", (t4.match(/\$0\.\d\d/g) ?? []).join(" "));
ok(/\$25\.43/.test(t4), "y el total es el mismo que cobraría un crédito fiscal", (t4.match(/\$\d+\.\d\d/g) ?? []).slice(-1)[0]);

console.log(errores.length ? `\n  errores en consola: ${errores.join(" | ")}` : "\n  sin errores en consola");
console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
await nav.close();
process.exit(fallos ? 1 : 0);
