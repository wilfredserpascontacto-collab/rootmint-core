/**
 * Que guardar dos veces no cree dos documentos.
 *
 * El caso real: la secretaria le da «Guardar», la pantalla se queda pensando
 * porque el internet hipó, le da otra vez. Con cotizaciones eso era molesto;
 * con créditos fiscales eran dos documentos con números corridos por una sola
 * venta, que hay que anular ante Hacienda.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.idem PORT=4401 node dist/index.js &
 *   node scripts/probar-idempotencia.mjs
 *
 * Necesita una base vacía: empieza creando la primera dueña.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4401";
const CLAVE = process.env.CLAVE_PRUEBA ?? "unaClaveLarga1";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};

let galleta = "";
async function pedir(ruta, opciones = {}) {
  const res = await fetch(BASE + ruta, {
    ...opciones,
    headers: { "content-type": "application/json", ...(galleta ? { cookie: galleta } : {}), ...(opciones.headers ?? {}) },
  });
  const puesta = res.headers.get("set-cookie");
  if (puesta) galleta = puesta.split(";")[0];
  const texto = await res.text();
  return { estado: res.status, cuerpo: texto ? JSON.parse(texto) : null };
}

const dinero = (c) => "$" + (c / 100).toFixed(2);

// --- Entrar ------------------------------------------------------------------
await pedir("/auth/primera-duena", {
  method: "POST",
  body: JSON.stringify({ name: "Amada", email: "amada@prueba.sv", password: CLAVE }),
});

const cliente = (
  await pedir("/customers", {
    method: "POST",
    body: JSON.stringify({ name: "Constructora de prueba", type: "company", stage: "customer", nrc: "111111-1" }),
  })
).cuerpo;
const producto = (
  await pedir("/catalog-items", {
    method: "POST",
    body: JSON.stringify({ name: "Bloque de prueba", code: "IDEM-1", type: "product", unit: "unidad", unitPriceCents: 100 }),
  })
).cuerpo;

const cuerpoCot = JSON.stringify({
  customerId: cliente.id,
  taxRatePercent: 13,
  lines: [{ catalogItemId: producto.id, quantity: 10 }],
});

console.log("\n=== sin llave sigue como antes ===");
const sin1 = await pedir("/quotes", { method: "POST", body: cuerpoCot });
const sin2 = await pedir("/quotes", { method: "POST", body: cuerpoCot });
ok(sin1.estado === 201 && sin2.estado === 201, "dos guardados sin llave crean dos cotizaciones");
ok(sin1.cuerpo.number !== sin2.cuerpo.number, "con números distintos", `${sin1.cuerpo.number} y ${sin2.cuerpo.number}`);

console.log("\n=== con la misma llave, una sola cotización ===");
const llave = "prueba-" + Date.now();
const a = await pedir("/quotes", { method: "POST", body: cuerpoCot, headers: { "idempotency-key": llave } });
const b = await pedir("/quotes", { method: "POST", body: cuerpoCot, headers: { "idempotency-key": llave } });
ok(a.estado === 201, "el primero crea", `estado ${a.estado}`);
ok(b.estado === 200, "el segundo no crea: devuelve la que ya existe", `estado ${b.estado}`);
ok(a.cuerpo.id === b.cuerpo.id, "es la misma cotización", a.cuerpo.number === b.cuerpo.number ? `COT ${a.cuerpo.number}` : "números distintos");
ok(b.cuerpo.lines?.length === 1, "y viene completa, con sus renglones");

console.log("\n=== tres clics a la vez ===");
const llave2 = "prueba-simultanea-" + Date.now();
const juntos = await Promise.all(
  [1, 2, 3].map(() => pedir("/quotes", { method: "POST", body: cuerpoCot, headers: { "idempotency-key": llave2 } })),
);
const ids = new Set(juntos.map((r) => r.cuerpo?.id));
ok(ids.size === 1, "tres pedidos simultáneos dejan una sola cotización", `salieron ${ids.size}`);
ok(juntos.filter((r) => r.estado === 201).length === 1, "y solo uno dice haberla creado");

console.log("\n=== llave distinta, documento distinto ===");
const otra = await pedir("/quotes", { method: "POST", body: cuerpoCot, headers: { "idempotency-key": llave + "-otra" } });
ok(otra.estado === 201 && otra.cuerpo.id !== a.cuerpo.id, "una llave nueva sí crea una cotización nueva");

console.log("\n=== lo que de verdad importa: facturas ===");
const cot = a.cuerpo;
await pedir(`/quotes/${cot.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "accepted" }) });
const llaveF = "factura-" + Date.now();
const cuerpoFac = JSON.stringify({ quoteId: cot.id });
const f1 = await pedir("/invoices", { method: "POST", body: cuerpoFac, headers: { "idempotency-key": llaveF } });
const f2 = await pedir("/invoices", { method: "POST", body: cuerpoFac, headers: { "idempotency-key": llaveF } });
ok(f1.estado === 201, "la factura se emite", f1.cuerpo?.kind ? `${f1.cuerpo.kind.toUpperCase()}-${String(f1.cuerpo.number).padStart(5, "0")}` : "");
ok(f2.estado === 200, "el segundo intento no emite otra", `estado ${f2.estado}`);
ok(f1.cuerpo.id === f2.cuerpo.id, "es el mismo documento fiscal");
ok(f2.cuerpo.number === f1.cuerpo.number, "con el mismo número: la serie no se saltó nada", `número ${f2.cuerpo.number}`);

const todas = await pedir("/invoices");
const lista = Array.isArray(todas.cuerpo) ? todas.cuerpo : (todas.cuerpo.items ?? []);
ok(lista.length === 1, "y en la lista hay una sola factura", `hay ${lista.length}`);
ok(lista[0]?.totalCents === f1.cuerpo.totalCents, "por el monto correcto", dinero(lista[0]?.totalCents ?? 0));

console.log(fallos === 0 ? "\nTodo bien.\n" : `\n${fallos} fallo(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
