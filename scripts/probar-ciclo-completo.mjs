/**
 * El ciclo entero, de una base vacia hasta la factura, como lo haria la planta
 * de verdad el primer dia.
 *
 * No es una prueba de que el codigo funciona: las otras ya hacen eso. Esta
 * contesta una pregunta distinta, la que hizo David — "¿podemos hacer un ciclo
 * completo ahorita, o todavia falta?" — y esta escrita para ENCONTRAR donde se
 * traba, no para salir en verde. Lo que no se puede hacer se imprime igual.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4510";
let galleta = "";
const pasos = [];
const ok = (b, t, extra = "") => {
  pasos.push({ b, t, extra });
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
};

async function pedir(ruta, cuerpo, metodo) {
  const m = metodo ?? (cuerpo ? "POST" : "GET");
  const r = await fetch(BASE + ruta, {
    method: m,
    headers: {
      ...(cuerpo ? { "content-type": "application/json" } : {}),
      ...(galleta ? { cookie: galleta } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const set = r.headers.get("set-cookie");
  if (set) galleta = set.split(";")[0];
  return { estado: r.status, cuerpo: await r.json().catch(() => null) };
}

console.log("\n─── 1 · ABRIR EL SISTEMA ───");
const alta = await pedir("/auth/primera-duena", {
  name: "Amada", email: "amada@bloquestitan.com", password: "unaClaveLarga1",
});
ok(alta.estado < 300, "se crea la primera dueña y queda adentro");

console.log("\n─── 2 · LOS DATOS DE LA EMPRESA ───");
const perfil = await pedir("/business-profile", {
  name: "Grupo Titán, S.A. de C.V.",
  address: "Km 24 Carretera a Santa Ana",
  phone: "2222-3333", email: "ventas@bloquestitan.sv",
  nit: "0614-010101-101-1",
}, "PUT");
ok(perfil.estado < 300, "se pueden cargar nombre, dirección y NIT");
const p = (await pedir("/business-profile")).cuerpo;
ok("nrc" in (p ?? {}), "y el NRC, que un crédito fiscal necesita del emisor",
   "nrc" in (p ?? {}) ? "" : "NO EXISTE el campo NRC de la empresa");

console.log("\n─── 3 · QUÉ SE FABRICA ───");
const tipos = (await pedir("/bloques/tipos")).cuerpo ?? [];
ok(tipos.length > 0, `vienen ${tipos.length} tipos de bloque de fábrica`);
const tipo = tipos[0];
const materiales = (await pedir("/bloques/materiales")).cuerpo ?? [];
ok(materiales.length > 0, `y ${materiales.length} materiales`);
const rr = (await pedir("/bloques/recetas", {
  code: "R-1", name: "Mezcla estándar", blockTypeId: tipo.id, expectedBlocksPerMix: 60,
  renglones: materiales.slice(0, 3).map((m) => ({ materialId: m.id, quantityMilli: 5000 })),
})).cuerpo;
const receta = rr.receta ?? rr;
ok(Boolean(receta?.id), "se arma una receta para poder producir");

console.log("\n─── 4 · QUÉ SE VENDE, Y QUE SEA EL MISMO BLOQUE ───");
const producto = (await pedir("/catalog-items", {
  name: tipo.name, code: "BL-15", type: "product", unit: "unidad", unitPriceCents: 45,
})).cuerpo;
const enlace = await pedir(`/catalog-items/${producto.id}/tipo-bloque`, { blockTypeId: tipo.id }, "PATCH");
ok(enlace.estado === 200, "el producto del catálogo queda enlazado a su tipo de bloque");

console.log("\n─── 5 · EL CLIENTE Y LA COTIZACIÓN ───");
const cliente = (await pedir("/customers", {
  name: "Constructora del Valle", type: "company", nrc: "123456-7", nit: "0614-020202-102-2",
})).cuerpo;
ok(Boolean(cliente?.id), "se da de alta el cliente con su NRC");
const cot = (await pedir("/quotes", {
  customerId: cliente.id,
  description: "Muro perimetral",
  lines: [{ catalogItemId: producto.id, quantity: 1000 }],
  taxRatePercent: 13,
})).cuerpo;
ok(Boolean(cot?.id), "se cotizan 1.000 bloques", `total ${(cot.totalCents / 100).toFixed(2)} USD`);
await pedir(`/quotes/${cot.id}/status`, { status: "sent" }, "PATCH");
const acept = await pedir(`/quotes/${cot.id}/status`, { status: "accepted" }, "PATCH");
ok(acept.estado === 200, "el cliente la acepta y queda registrado");

console.log("\n─── 6 · PASARLA A PRODUCCIÓN ───");
const orden = await pedir("/ordenes/desde-cotizacion", { quoteId: cot.id });
ok(orden.estado === 201, "la cotización se pasa a la planta como orden");
ok(orden.cuerpo.lines[0].quantity === 1000, "y pide los 1.000: el patio está vacío",
   String(orden.cuerpo.lines[0].quantity));

console.log("\n─── 7 · LA PLANTA PRODUCE ───");
const l1 = await pedir("/bloques/lotes", {
  recipeId: receta.id, productionOrderId: orden.cuerpo.id, mixes: 10, blocksGood: 600, blocksBroken: 14,
});
ok(l1.estado === 201, "se corre un lote de 600 buenos contra la orden");
const l2 = await pedir("/bloques/lotes", {
  recipeId: receta.id, productionOrderId: orden.cuerpo.id, mixes: 7, blocksGood: 400, blocksBroken: 8,
});
ok(/quedó terminada/.test((l2.cuerpo.avisos ?? []).join(" ")), "el segundo la completa y la orden se cierra sola");

const patio1 = (await pedir("/inventario")).cuerpo.find((x) => x.blockTypeId === tipo.id);
ok(patio1.existencia === 1000, "el patio tiene 1.000 sin que nadie los escribiera", String(patio1.existencia));
ok(patio1.lotes === 2, "y sabe que salieron de 2 lotes", String(patio1.lotes));

console.log("\n─── 8 · LA FACTURA ───");
const fac = await pedir("/invoices", { quoteId: cot.id });
ok(fac.estado < 300, "se factura la cotización");
ok(fac.cuerpo.kind === "ccf", "y sale crédito fiscal, porque el cliente tiene NRC", fac.cuerpo.kind);
ok(fac.cuerpo.businessSnapshot?.name === "Grupo Titán, S.A. de C.V.",
   "el papel sale con los datos de la empresa", fac.cuerpo.businessSnapshot?.name);

console.log("\n─── 9 · ¿Y DESPUÉS DE FACTURAR? ───");
const patio2 = (await pedir("/inventario")).cuerpo.find((x) => x.blockTypeId === tipo.id);
ok(patio2.existencia === 0,
   "el patio debería quedar en 0: esos 1.000 ya se vendieron",
   patio2.existencia === 0 ? "" : `sigue diciendo ${patio2.existencia} — FACTURAR NO DESCUENTA`);

const cot2 = (await pedir("/quotes", {
  customerId: cliente.id, lines: [{ catalogItemId: producto.id, quantity: 900 }], taxRatePercent: 13,
})).cuerpo;
const qp = (await pedir(`/quotes/${cot2.id}/que-producir`)).cuerpo;
ok(qp.lines[0].hayQueProducir === 900,
   "y una cotización nueva de 900 debería decir que hay que producir 900",
   qp.lines[0].hayQueProducir === 900 ? "" : `dice ${qp.lines[0].hayQueProducir} — PROMETE BLOQUES YA VENDIDOS`);

console.log("\n─── 10 · ¿Y EL COBRO? ───");
const cobro = await pedir(`/invoices/${fac.cuerpo.id}/pagos`, { amountCents: 10000 });
ok(cobro.estado < 300, "se debería poder registrar que el cliente pagó",
   cobro.estado < 300 ? "" : `no existe dónde registrarlo (${cobro.estado})`);
const estado = await pedir(`/customers/${cliente.id}/estado-cuenta`);
ok(estado.estado < 300, "y ver cuánto debe este cliente",
   estado.estado < 300 ? "" : `no existe el estado de cuenta (${estado.estado})`);

const bien = pasos.filter((x) => x.b).length;
console.log(`\n${bien} de ${pasos.length} pasos del ciclo funcionan hoy.`);
console.log("\nLo que NO:");
for (const x of pasos.filter((y) => !y.b)) console.log(`  · ${x.t}${x.extra ? ` (${x.extra})` : ""}`);
