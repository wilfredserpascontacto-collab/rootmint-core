/**
 * OJO: la interfaz enruta con HashRouter, asi que las direcciones llevan "#".
 *
 * Despachos en un navegador: facturar dejando los bloques en el patio, ver que
 * el inventario lo diga, despachar un viaje firmando con el dedo y subiendo una
 * foto, que el patio baje, y anular.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-dp PORT=4590 node dist/index.js &
 *   node scripts/probar-despachos-pantalla.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4590";
const CLAVE = process.env.CLAVE_PRUEBA ?? "unaClaveLarga1";
const FOTOS = process.env.FOTOS ?? "";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};

const nav = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await nav.newContext({ viewport: { width: 1400, height: 1000 }, hasTouch: true });
const pag = await ctx.newPage();
const errores = [];
pag.on("pageerror", (e) => errores.push(String(e).slice(0, 180)));
pag.on("console", (m) => {
  if (m.type() === "error" && !/ERR_TUNNEL|status of (400|401|409)/.test(m.text())) {
    errores.push("consola: " + m.text().slice(0, 180));
  }
});
const texto = () => pag.locator("body").innerText();
const foto = async (n) => { if (FOTOS) await pag.screenshot({ path: `${FOTOS}/${n}.png`, fullPage: true }); };
const ir = async (r) => { await pag.goto(`${BASE}/#${r}`, { waitUntil: "networkidle" }); await pag.waitForTimeout(1100); };

// --- Entrar y sembrar ---------------------------------------------------------
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
      const res = await fetch(r, {
        method: m,
        headers: { "content-type": "application/json" },
        body: c ? JSON.stringify(c) : undefined,
      });
      return { estado: res.status, cuerpo: await res.json().catch(() => null) };
    },
    [metodo, ruta, cuerpo],
  );
const dato = async (r) => (await llamar("GET", r)).cuerpo;

const tipo = (await dato("/bloques/tipos"))[0];
const materiales = await dato("/bloques/materiales");
const rr = (
  await llamar("POST", "/bloques/recetas", {
    code: "R-DP", name: "Mezcla", blockTypeId: tipo.id, expectedBlocksPerMix: 100,
    renglones: materiales.slice(0, 3).map((m) => ({ materialId: m.id, quantityMilli: 5000 })),
  })
).cuerpo;
await llamar("POST", "/bloques/lotes", { recipeId: (rr.receta ?? rr).id, mixes: 10, blocksGood: 1000, blocksBroken: 0 });
const producto = (
  await llamar("POST", "/catalog-items", { name: tipo.name, code: "DP-1", type: "product", unit: "unidad", unitPriceCents: 50 })
).cuerpo;
await llamar("PATCH", `/catalog-items/${producto.id}/tipo-bloque`, { blockTypeId: tipo.id });
await llamar("POST", "/customers", { name: "Constructora Ana", type: "company", nrc: "111111-1" });

const patio = async () => (await dato("/inventario")).find((i) => i.blockTypeId === tipo.id);

console.log("\n=== la pantalla vacía ===");
await ir("/comercial/despachos");
let t = await texto();
const menu = await pag.locator("nav").first().innerText();
ok(/Despachos/i.test(menu), "«Despachos» está en el menú del área comercial");
ok(/Nada entregado/i.test(t), "sin despachos lo dice, no deja la pantalla en blanco");
ok(/papel que firma quien recibe/i.test(t), "y explica para qué sirve un despacho");
await foto("1-vacia");

console.log("\n=== facturar dejando los bloques en el patio ===");
await ir("/comercial/facturas/nueva");
await pag.getByLabel("Cliente").selectOption({ label: "Constructora Ana" });
t = await texto();
ok(/Se lo lleva ahora/i.test(t), "la factura pregunta si se lo lleva ahora");
const marca = pag.getByRole("checkbox", { name: /Se lo lleva ahora/i });
ok(await marca.isChecked(), "y viene marcado: el caso común es que se lo llevan");
await marca.uncheck();
t = await texto();
ok(/se quedan en el patio/i.test(t), "al destildarlo explica qué pasa entonces", (t.match(/[^\n]*quedan en el patio[^\n]*/) ?? [""])[0].slice(0, 110));
await pag.getByLabel("Producto o servicio").first().selectOption({ index: 1 });
await pag.locator('input[type="number"]').first().fill("300");
await foto("2-factura-nueva");
await pag.getByRole("button", { name: /Emitir/i }).first().click();
await pag.waitForTimeout(2200);
t = await texto();
ok(/CCF-00001|FCF-00001/.test(t), "se emite la factura", t.replace(/\n/g, " ").slice(0, 110));
ok(/quedan en el patio/i.test(t), "y avisa que los bloques quedan en el patio");
let p = await patio();
ok(p.existencia === 1000, "el patio NO bajó", String(p.existencia));
ok(p.porDespachar === 300, "pero 300 figuran por despachar", String(p.porDespachar));
await foto("3-factura");

console.log("\n=== el inventario lo dice ===");
await ir("/comercial/inventario");
t = await texto();
ok(/Por despachar/i.test(t), "el inventario tiene la columna «Por despachar»");
ok(/esperando camión/i.test(t), "y explica que ya están vendidos", (t.match(/[^\n]*esperando[^\n]*/) ?? [""])[0]);
ok(/\b700\b/.test(t), "lo disponible bajó a 700, aunque en el patio haya 1000");
await foto("4-inventario");

console.log("\n=== despachar un viaje, con firma y foto ===");
await ir("/comercial/facturas");
await pag.getByRole("link", { name: /CCF-00001|FCF-00001/ }).first().click();
await pag.waitForTimeout(1400);
t = await texto();
ok(/Despachar \(300\)/.test(t.replace(/\n/g, " ")), "la factura ofrece despachar los 300", (t.match(/Despachar[^\n]*/) ?? [""])[0]);
await pag.getByRole("link", { name: /Despachar/ }).first().click();
await pag.waitForTimeout(1500);
t = await texto();
ok(/Nuevo despacho/i.test(t), "se abre la pantalla de despacho");
const cantidad = pag.getByLabel("Cantidad 1");
ok((await cantidad.inputValue()) === "300", "con la cantidad que falta ya puesta", await cantidad.inputValue());

const registrar = pag.getByRole("button", { name: "Registrar la entrega" });
ok(await registrar.isDisabled(), "sin el nombre de quien recibe no deja registrar");

await cantidad.fill("500");
await pag.waitForTimeout(400);
t = await texto();
ok(/solo faltan 300/i.test(t), "si se pone más de lo que falta, lo dice ahí mismo", (t.match(/[^\n]*solo faltan[^\n]*/i) ?? [""])[0]);
await cantidad.fill("200");

await pag.getByLabel("Nombre de quien recibe").fill("Maura, la maestra de obra");
await pag.getByLabel("Chofer").fill("Chepe");
await pag.getByLabel("Placa").fill("P 123-456");
await pag.getByLabel("Dirección de entrega").fill("Lotificación El Níspero, lote 12");

// La firma: tres trazos con el dedo sobre el cuadro.
const lienzo = pag.getByLabel("Firma de quien recibe");
// Sin esto el cuadro queda debajo de la vista y el raton pincha donde no hay nada.
await lienzo.scrollIntoViewIfNeeded();
await pag.waitForTimeout(300);
const caja = await lienzo.boundingBox();
await pag.mouse.move(caja.x + 40, caja.y + 120);
await pag.mouse.down();
for (const [dx, dy] of [[40, -60], [40, 50], [50, -40], [45, 30], [40, -20]]) {
  await pag.mouse.move(caja.x + 40 + dx * 2, caja.y + 120 + dy);
  await pag.mouse.move(caja.x + 80 + dx * 2, caja.y + 120 + dy / 2);
}
await pag.mouse.up();
await pag.waitForTimeout(300);
t = await texto();
ok(/Firmado\./.test(t), "la firma se dibuja con el dedo y queda registrada", (t.match(/Firmado\./) ?? [""])[0]);

// Una foto: un PNG de 1x1 basta para comprobar que viaja y se guarda.
await pag.getByLabel("Fotos de la carga").setInputFiles({
  name: "camion.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
});
await pag.waitForTimeout(900);
t = await texto();
ok(/1 de 6/.test(t), "la foto entra y se ve cuántas van", (t.match(/\d de 6/) ?? [""])[0]);
await foto("5-despachando");

ok(!(await registrar.isDisabled()), "con todo puesto, el botón se enciende");
await registrar.click();
await pag.waitForTimeout(2500);
t = await texto();
ok(/DES-00001/.test(t), "nace el despacho DES-00001", t.replace(/\n/g, " ").slice(0, 100));
ok(/Maura, la maestra de obra/.test(t), "con el nombre de quien recibió");
ok(/Chepe/.test(t) && /P 123-456/.test(t), "y quién lo llevó");
ok(/\b200\b/.test(t), "y los 200 que salieron");
await foto("6-ficha");

p = await patio();
ok(p.existencia === 800, "ahora sí bajó el patio: 800", String(p.existencia));
ok(p.porDespachar === 100, "y quedan 100 por despachar", String(p.porDespachar));

console.log("\n=== la firma y la foto quedaron guardadas ===");
const firmaEnPantalla = pag.getByRole("img", { name: /Firma de quien recibió/i });
ok((await firmaEnPantalla.count()) === 1, "la firma se ve en la ficha");
const srcFirma = await firmaEnPantalla.getAttribute("src");
ok((srcFirma ?? "").startsWith("data:image/png"), "y es una imagen de verdad", (srcFirma ?? "").slice(0, 24));
ok((await pag.getByRole("img", { name: /Foto de la entrega/i }).count()) >= 1, "y la foto también");

console.log("\n=== la lista ===");
await ir("/comercial/despachos");
t = await texto();
ok(/DES-00001/.test(t), "el despacho está en la lista");
ok(/Firmado/.test(t), "y la lista dice que está firmado");
ok(/1 foto/.test(t), "y cuántas fotos tiene", (t.match(/\d foto\w*/) ?? [""])[0]);
await foto("7-lista");

console.log("\n=== el segundo viaje ===");
await ir("/comercial/facturas");
await pag.getByRole("link", { name: /CCF-00001|FCF-00001/ }).first().click();
await pag.waitForTimeout(1400);
t = await texto();
ok(/Despachar lo que falta \(100\)/.test(t.replace(/\n/g, " ")), "la factura dice que faltan 100", (t.match(/Despachar[^\n]*/) ?? [""])[0]);
ok(/DES-00001/.test(t), "y enlaza el despacho que ya salió");
await pag.getByRole("link", { name: /Despachar lo que falta/ }).click();
await pag.waitForTimeout(1500);
await pag.getByLabel("Nombre de quien recibe").fill("Maura");
await pag.getByRole("button", { name: "Registrar la entrega" }).click();
await pag.waitForTimeout(2500);
t = await texto();
ok(/DES-00002/.test(t), "sale el segundo despacho");
ok(/quedó sin firma/i.test(t), "y avisa que quedó sin firma", (t.match(/[^\n]*sin firma[^\n]*/i) ?? [""])[0].slice(0, 100));
p = await patio();
ok(p.existencia === 700 && p.porDespachar === 0, "el patio quedó en 700 y no falta nada por despachar", `${p.existencia} / ${p.porDespachar}`);

await ir("/comercial/facturas");
await pag.getByRole("link", { name: /CCF-00001|FCF-00001/ }).first().click();
await pag.waitForTimeout(1400);
t = await texto();
ok(/Entregado/.test(t) && !/Despachar \(/.test(t), "la factura ya figura entregada y no ofrece despachar más");

console.log("\n=== anular un despacho devuelve los bloques ===");
await ir("/comercial/despachos");
await pag.getByRole("link", { name: "DES-00002" }).click();
await pag.waitForTimeout(1300);
await pag.getByRole("button", { name: "Anular", exact: true }).click();
const siAnular = pag.getByRole("button", { name: "Anular", exact: true }).last();
await pag.getByLabel("Motivo de la anulación").fill("Se cargó el camión equivocado");
await siAnular.click();
await pag.waitForTimeout(2000);
t = await texto();
ok(/Anulado\./.test(t) && /camión equivocado/.test(t), "queda anulado con su motivo", (t.match(/Anulado[^\n]*/) ?? [""])[0].slice(0, 90));
p = await patio();
ok(p.existencia === 800 && p.porDespachar === 100, "y los 100 volvieron al patio y a «por despachar»", `${p.existencia} / ${p.porDespachar}`);
await foto("8-anulado");

console.log("\n=== el mostrador: factura y se lo lleva ===");
await ir("/comercial/facturas/nueva");
await pag.getByLabel("Cliente").selectOption({ label: "Constructora Ana" });
await pag.getByLabel("Producto o servicio").first().selectOption({ index: 1 });
await pag.locator('input[type="number"]').first().fill("50");
await pag.getByRole("button", { name: /Emitir/i }).first().click();
await pag.waitForTimeout(2200);
p = await patio();
ok(p.existencia === 750, "con «se lo lleva ahora» marcado el patio baja en el acto", String(p.existencia));
await ir("/comercial/despachos");
t = await texto();
ok(/DES-00003/.test(t), "y su despacho nació solo, sin un paso más");

console.log("\n=== en un teléfono ===");
await pag.setViewportSize({ width: 390, height: 844 });
for (const r of ["/comercial/despachos", "/comercial/despachos/nuevo", "/comercial/inventario"]) {
  await ir(r);
  const desborda = await pag.evaluate(() => {
    if (document.documentElement.scrollWidth <= window.innerWidth + 4) return "";
    return [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 4)
      .slice(0, 3)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 24)}`)
      .join(" | ");
  });
  ok(!desborda, `${r} no se sale de la pantalla`, desborda);
}
await foto("9-telefono");

ok(errores.length === 0, "ningún error de JavaScript ni de consola", errores.join(" | ").slice(0, 200));
await nav.close();
console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
