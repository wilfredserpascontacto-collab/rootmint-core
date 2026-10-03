/**
 * OJO: la interfaz enruta con HashRouter, asi que las direcciones llevan "#".
 *
 * Mira en un navegador lo que deja `node dist/db/demo-planta.js`: que cada
 * pantalla de la planta tenga algo que ensenar. La carga y el borrado los
 * orquesta scripts/probar-demo-planta.sh (el cargador necesita la base sola).
 *
 *   MODO=lleno  -> despues de cargar el ejemplo
 *   MODO=vacio  -> despues de quitarlo
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4570";
const MODO = process.env.MODO ?? "lleno";
const FOTOS = process.env.FOTOS ?? "";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};

const nav = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const pag = await (await nav.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errores = [];
pag.on("pageerror", (e) => errores.push(String(e).slice(0, 200)));
const texto = async () => (await pag.locator("body").innerText()).replace(/\n+/g, " ");
const foto = async (n) => { if (FOTOS) await pag.screenshot({ path: `${FOTOS}/${n}.png`, fullPage: true }); };
const ir = async (r) => { await pag.goto(`${BASE}/#${r}`, { waitUntil: "networkidle" }); await pag.waitForTimeout(1200); };
const llamar = (m, r) => pag.evaluate(async ([m, r]) => { const x = await fetch(r, { method: m }); return x.json(); }, [m, r]);

await pag.goto(BASE, { waitUntil: "networkidle" });
await pag.waitForTimeout(800);
await pag.getByLabel("Correo").fill("a@x.com");
await pag.getByLabel("Contraseña").fill("unaClaveLarga1");
await pag.getByRole("button", { name: /Entrar/i }).click();
await pag.waitForTimeout(2000);

let t;
if (MODO === "lleno") {
  console.log("\n=== planta ===");
  await ir("/planta");
  t = await texto();
  ok(/Qué se corre hoy/i.test(t), "la pantalla de planta abre");
  const op = await pag.getByLabel("Qué se corre hoy").locator("option").allInnerTexts();
  ok(op.some((o) => /bloque 15/i.test(o)) && op.some((o) => /bloque 10/i.test(o)), "ofrece las dos recetas de ejemplo", op.join(" | "));
  const ped = await pag.getByLabel("Qué hay pedido").locator("option").allInnerTexts();
  ok(ped.length >= 2, "y las órdenes abiertas", ped.join(" | "));
  await foto("planta");

  console.log("\n=== lotes ===");
  await ir("/lotes");
  t = await texto();
  ok(/001/.test(t) && /002/.test(t) && /003/.test(t) && /004/.test(t), "cuatro lotes numerados 001 a 004");
  ok(/470/.test(t) && /540/.test(t) && /600/.test(t) && /340/.test(t), "con sus bloques buenos");
  await foto("lotes");
  const lotes = await llamar("GET", "/bloques/lotes");
  const l1 = lotes.find((l) => l.numero === 1);
  await ir(`/lotes/${l1.id}`);
  t = await texto();
  ok(/14[.,]2/.test(t) && /CUMPLE/i.test(t), "el lote 001 muestra su ensayo de 14.2 MPa y que cumple");
  await foto("lote-1");
  const l3 = lotes.find((l) => l.numero === 3);
  await ir(`/lotes/${l3.id}`);
  t = await texto();
  ok(/2[.,]1/.test(t) && !/CUMPLE\b(?!E)/i.test(t.replace(/NO CUMPLE/gi, "")), "el lote 003 muestra el ensayo flojo y no dice que cumple", (t.match(/NO CUMPLE|CUMPLE|BAJO[^ ]*/i) ?? [""])[0]);

  console.log("\n=== recetas ===");
  await ir("/recetas");
  t = await texto();
  ok(/bloque 15/i.test(t) && /bloque 10/i.test(t), "las dos recetas están");
  ok(/validada/i.test(t), "la que tiene ensayo que cumple figura validada");
  await foto("recetas");

  console.log("\n=== órdenes ===");
  await ir("/ordenes");
  t = await texto();
  ok(/Orden N° 1/i.test(t) && /Orden N° 2/i.test(t), "las dos órdenes");
  ok(/340 \/ 900/.test(t), "la primera lleva 340 de 900");
  await foto("ordenes");

  console.log("\n=== mantenimiento ===");
  await ir("/mantenimiento");
  t = await texto();
  ok(/La planta lleva 34 mezclas en 4 lotes/i.test(t), "cuenta 34 mezclas en 4 lotes", (t.match(/La planta lleva[^.]*/i) ?? [""])[0]);
  ok(/vencid/i.test(t), "avisa que hay tareas vencidas");
  await foto("mantenimiento");

  console.log("\n=== almacén ===");
  await ir("/almacen");
  t = await texto();
  ok(/Cemento/i.test(t) && /Arena/i.test(t), "muestra existencias");
  ok(!/−\s?\d|-\d+ bolsa/.test(t), "ningún material en negativo");
  await foto("almacen");
  const compras = await llamar("GET", "/bloques/compras");
  ok(Array.isArray(compras) && compras.length === 2, "dos compras");

  console.log("\n=== patio ===");
  await ir("/comercial/inventario");
  t = await texto();
  const inv = await llamar("GET", "/inventario");
  const de = (c) => inv.find((x) => x.code === c)?.existencia;
  ok(de("B15") === 1350 && de("B10") === 600, "el patio recibió 1,350 de bloque 15 (470+540+340) y 600 de bloque 10", `B15=${de("B15")} B10=${de("B10")}`);
  await foto("patio");
} else {
  console.log("\n=== sin el ejemplo ===");
  await ir("/lotes");
  t = await texto();
  ok(!/\b00[1-4]\b/.test(t), "no quedan lotes");
  const ords = await llamar("GET", "/ordenes?estado=todas");
  ok(Array.isArray(ords) && ords.length === 0, "no quedan órdenes");
  const compras = await llamar("GET", "/bloques/compras");
  ok(Array.isArray(compras) && compras.length === 0, "no quedan compras");
  const provs = await llamar("GET", "/bloques/proveedores");
  ok(Array.isArray(provs) && provs.length === 0, "ni proveedores");
  await ir("/recetas");
  t = await texto();
  ok(/Todavía no hay ninguna receta/i.test(t), "ni recetas");
  const inv = await llamar("GET", "/inventario");
  ok(JSON.stringify(inv).indexOf('"quantity":') === -1 || !/"(onHand|existencia)":\s*[1-9]/.test(JSON.stringify(inv)), "el patio quedó en cero", JSON.stringify(inv).slice(0, 160));
}

ok(errores.length === 0, "ningún error de JavaScript", errores.join(" | "));
await nav.close();
console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
