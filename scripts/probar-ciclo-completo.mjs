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
  nit: "0614-010101-101-1", nrc: "12345-6",
}, "PUT");
ok(perfil.estado < 300, "se pueden cargar nombre, dirección y NIT");
const p = (await pedir("/business-profile")).cuerpo;
ok(p?.nrc === "12345-6", "y el NRC, que un crédito fiscal necesita del emisor",
   p?.nrc === "12345-6" ? "" : "NO EXISTE el campo NRC de la empresa");

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
// Sin «se lo lleva ahora»: es una obra, se factura hoy y el camion sale despues.
const fac = await pedir("/invoices", { quoteId: cot.id, despacharAhora: false });
ok(fac.estado < 300, "se factura la cotización");
ok(fac.cuerpo.kind === "ccf", "y sale crédito fiscal, porque el cliente tiene NRC", fac.cuerpo.kind);
ok(fac.cuerpo.businessSnapshot?.name === "Grupo Titán, S.A. de C.V.",
   "el papel sale con los datos de la empresa", fac.cuerpo.businessSnapshot?.name);
ok(fac.cuerpo.businessSnapshot?.nrc === "12345-6", "y con el NRC del emisor congelado en la factura",
   fac.cuerpo.businessSnapshot?.nrc);
ok(!(fac.cuerpo.avisos ?? []).some((a) => /NRC cargado/.test(a)), "sin avisar que falta el NRC de la empresa");

console.log("\n─── 9 · ¿Y DESPUÉS DE FACTURAR? ───");
const patio2 = (await pedir("/inventario")).cuerpo.find((x) => x.blockTypeId === tipo.id);
ok(patio2.existencia === 1000,
   "los 1.000 siguen en el patio: están vendidos pero no han salido",
   String(patio2.existencia));
ok(patio2.porDespachar === 1000,
   "y figuran por despachar, esperando el camión",
   String(patio2.porDespachar));
ok(patio2.disponible === 0,
   "así que lo libre para vender es 0: no se venden dos veces",
   patio2.disponible === 0 ? "" : `dice ${patio2.disponible} — PROMETE BLOQUES YA VENDIDOS`);

const cot2 = (await pedir("/quotes", {
  customerId: cliente.id, lines: [{ catalogItemId: producto.id, quantity: 900 }], taxRatePercent: 13,
})).cuerpo;
const qp = (await pedir(`/quotes/${cot2.id}/que-producir`)).cuerpo;
ok(qp.lines[0].hayQueProducir === 900,
   "y una cotización nueva de 900 debería decir que hay que producir 900",
   qp.lines[0].hayQueProducir === 900 ? "" : `dice ${qp.lines[0].hayQueProducir} — PROMETE BLOQUES YA VENDIDOS`);

console.log("\n─── 10 · EL CAMIÓN SALE ───");
const pendientes = await pedir(`/invoices/${fac.cuerpo.id}/por-despachar`);
ok(pendientes.estado < 300 && pendientes.cuerpo.faltaAlgo,
   "la factura sabe qué le falta entregar",
   pendientes.estado < 300 ? "" : `no se puede preguntar (${pendientes.estado})`);
const renglonBloques = (pendientes.cuerpo?.renglones ?? []).find((r) => r.blockTypeId);

const viaje1 = await pedir("/despachos", {
  invoiceId: fac.cuerpo.id,
  receivedByName: "Maura, la maestra de obra",
  address: "Lotificación El Níspero, lote 12",
  driverName: "Chepe",
  vehiclePlate: "P 123-456",
  signature: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  lines: [{ invoiceLineId: renglonBloques?.id, quantity: 600 }],
});
ok(viaje1.estado < 300, "sale el primer viaje con 600, firmado por quien recibe",
   viaje1.estado < 300 ? "" : JSON.stringify(viaje1.cuerpo).slice(0, 120));

const patio3 = (await pedir("/inventario")).cuerpo.find((x) => x.blockTypeId === tipo.id);
ok(patio3.existencia === 400, "ahora sí bajó el patio: quedan 400", String(patio3.existencia));
ok(patio3.porDespachar === 400, "y 400 siguen esperando el segundo viaje", String(patio3.porDespachar));

const viaje2 = await pedir("/despachos", {
  invoiceId: fac.cuerpo.id,
  receivedByName: "Maura",
  lines: [{ invoiceLineId: renglonBloques?.id, quantity: 400 }],
});
ok(viaje2.estado < 300, "y el segundo viaje completa la entrega");
const patio4 = (await pedir("/inventario")).cuerpo.find((x) => x.blockTypeId === tipo.id);
ok(patio4.existencia === 0 && patio4.porDespachar === 0,
   "el patio queda en 0 y no falta nada por entregar",
   `${patio4.existencia} / ${patio4.porDespachar}`);

const ficha = await pedir(`/despachos/${viaje1.cuerpo?.id}`);
ok(Boolean(ficha.cuerpo?.signature), "y queda guardada la firma de quien recibió");

console.log("\n─── 11 · ¿Y EL COBRO? ───");
const cobro = await pedir(`/invoices/${fac.cuerpo.id}/pagos`, { amountCents: 10000 });
ok(cobro.estado < 300, "se debería poder registrar que el cliente pagó",
   cobro.estado < 300 ? "" : `no existe dónde registrarlo (${cobro.estado})`);
const estado = await pedir(`/customers/${cliente.id}/estado-cuenta`);
ok(estado.estado < 300, "y ver cuánto debe este cliente",
   estado.estado < 300 ? "" : `no existe el estado de cuenta (${estado.estado})`);

console.log("\n─── 12 · LO QUE TODAVÍA NO SE PUEDE ───");
// Esta parte NO sale en verde a proposito: marca los huecos que quedan, para
// que aparezcan en rojo cada vez que se corre en vez de olvidarse.
const segunda = (await pedir("/invoices", {
  customerId: cliente.id, despacharAhora: false,
  lines: [{ catalogItemId: producto.id, quantity: 1 }],
})).cuerpo;
const unCheque = await pedir("/pagos", {
  customerId: cliente.id, amountCents: 5000,
  aplicaciones: [{ invoiceId: fac.cuerpo.id, amountCents: 2500 }, { invoiceId: segunda.id, amountCents: 2500 }],
});
ok(unCheque.estado < 300, "un solo cheque debería poder cubrir varias facturas",
   unCheque.estado < 300 ? "" : `no existe (${unCheque.estado}) — HAY QUE TECLEAR UN COBRO POR FACTURA`);
const anticipo = await pedir(`/customers/${cliente.id}/anticipos`, { amountCents: 50000 });
ok(anticipo.estado < 300, "debería poder anotarse un anticipo antes de facturar",
   anticipo.estado < 300 ? "" : `no existe (${anticipo.estado}) — EL 50% PARA ARRANCAR NO CABE EN NINGÚN LADO`);
const nota = await pedir("/notas-credito", {
  invoiceId: fac.cuerpo.id, lines: [{ catalogItemId: producto.id, quantity: 200 }],
});
// Ojo: una ruta que no existe NO da 404 — cae en la interfaz y contesta el HTML
// con 200. Lo que se mira es si contesto algo que parece una nota de credito.
ok(Boolean(nota.cuerpo?.id), "y una devolución de 200 bloques debería ser una nota de crédito",
   nota.cuerpo?.id ? "" : "no existe — SOLO SE PUEDE ANULAR LA FACTURA ENTERA");

const bien = pasos.filter((x) => x.b).length;
console.log(`\n${bien} de ${pasos.length} pasos del ciclo funcionan hoy.`);
console.log("\nLo que NO:");
for (const x of pasos.filter((y) => !y.b)) console.log(`  · ${x.t}${x.extra ? ` (${x.extra})` : ""}`);
