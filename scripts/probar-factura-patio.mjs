/**
 * Facturar saca bloques del patio, y anular los devuelve.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-fp PORT=4430 node dist/index.js &
 *   BASE=http://127.0.0.1:4430 node scripts/probar-factura-patio.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4430";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};

let galleta = "";
async function pedir(ruta, cuerpo, metodo) {
  const r = await fetch(BASE + ruta, {
    method: metodo ?? (cuerpo ? "POST" : "GET"),
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
const patio = async (tipoId) =>
  (await pedir("/inventario")).cuerpo.find((x) => x.blockTypeId === tipoId)?.existencia;

await pedir("/auth/primera-duena", {
  name: "Amada",
  email: "amada@bloquestitan.com",
  password: "unaClaveLarga1",
});

const tipo = (await pedir("/bloques/tipos")).cuerpo[0];
const materiales = (await pedir("/bloques/materiales")).cuerpo;
const rr = (
  await pedir("/bloques/recetas", {
    code: "R-FP",
    name: "Mezcla de prueba",
    blockTypeId: tipo.id,
    expectedBlocksPerMix: 60,
    renglones: materiales.slice(0, 3).map((m) => ({ materialId: m.id, quantityMilli: 5000 })),
  })
).cuerpo;
const receta = rr.receta ?? rr;
await pedir("/bloques/lotes", { recipeId: receta.id, mixes: 10, blocksGood: 600, blocksBroken: 0 });

const producto = (
  await pedir("/catalog-items", {
    name: tipo.name,
    code: "FP-1",
    type: "product",
    unit: "unidad",
    unitPriceCents: 45,
  })
).cuerpo;
await pedir(`/catalog-items/${producto.id}/tipo-bloque`, { blockTypeId: tipo.id }, "PATCH");
const flete = (
  await pedir("/catalog-items", {
    name: "Flete",
    code: "FP-FLETE",
    type: "service",
    unit: "viaje",
    unitPriceCents: 3000,
  })
).cuerpo;
const cliente = (
  await pedir("/customers", { name: "Constructora", type: "company", nrc: "123456-7" })
).cuerpo;

console.log("\n=== el patio arranca con 600 ===");
ok((await patio(tipo.id)) === 600, "hay 600 en el patio", String(await patio(tipo.id)));

console.log("\n=== facturar una cotización saca sus bloques ===");
const cot = (
  await pedir("/quotes", {
    customerId: cliente.id,
    lines: [
      { catalogItemId: producto.id, quantity: 400 },
      { catalogItemId: flete.id, quantity: 1 },
    ],
    taxRatePercent: 13,
  })
).cuerpo;
const fac = await pedir("/invoices", { quoteId: cot.id });
ok(fac.estado === 201, "se factura la cotización completa", `estado ${fac.estado}`);
ok((await patio(tipo.id)) === 200, "el patio baja de 600 a 200", String(await patio(tipo.id)));
const movs = (await pedir(`/inventario/${tipo.id}/movimientos`)).cuerpo;
const venta = movs.find((m) => m.reason === "venta");
ok(venta?.quantity === -400, "queda un movimiento de venta por −400", String(venta?.quantity));
ok(venta?.refType === "invoice" && venta?.refId === fac.cuerpo.id, "y apunta a la factura que lo explica");
ok(/N° \d+/.test(venta?.note ?? ""), "con el número de la factura en la nota", venta?.note);
ok(
  (fac.cuerpo.avisos ?? []).some((a) => /empresa no tiene NRC/.test(a)),
  "avisa que a la empresa le falta el NRC para un crédito fiscal",
  (fac.cuerpo.avisos ?? []).join(" | "),
);
ok(
  (fac.cuerpo.avisos ?? []).every((a) => !/existencia quedó/.test(a)),
  "y no avisa nada raro: había de sobra",
);

console.log("\n=== la cotización entregada no pide fabricar de nuevo ===");
const qp = (await pedir(`/quotes/${cot.id}/que-producir`)).cuerpo;
const linea = qp.lines.find((l) => l.esProducible);
ok(linea.hayQueProducir === 0, "ya entregada, no hay nada que producir", String(linea.hayQueProducir));
ok(linea.yaFacturado === 400, "y dice cuántos ya se facturaron", String(linea.yaFacturado));
const noProd = qp.lines.find((l) => !l.esProducible);
ok(noProd !== undefined, "el flete sigue sin ser producible");

console.log("\n=== el flete no mueve el patio ===");
ok((await patio(tipo.id)) === 200, "sigue en 200: el flete no es un bloque");

console.log("\n=== anular devuelve los bloques ===");
const anul = await pedir(`/invoices/${fac.cuerpo.id}/anular`, { reason: "Error de cliente" });
ok(anul.estado === 200, "se anula la factura", `estado ${anul.estado}`);
ok((await patio(tipo.id)) === 600, "el patio vuelve a 600", String(await patio(tipo.id)));
ok(
  (anul.cuerpo?.avisos ?? []).some((a) => /400 bloques.*volvieron/.test(a)),
  "y lo dice en castellano",
  (anul.cuerpo?.avisos ?? []).join(" | "),
);
const movs2 = (await pedir(`/inventario/${tipo.id}/movimientos`)).cuerpo;
ok(
  movs2.some((m) => m.reason === "devolucion" && m.quantity === 400 && m.refId === fac.cuerpo.id),
  "la devolución queda como movimiento, no como un borrado",
);
ok(movs2.some((m) => m.reason === "venta"), "y la venta original sigue en la historia");
const dosVeces = await pedir(`/invoices/${fac.cuerpo.id}/anular`, { reason: "Otra vez" });
ok(dosVeces.estado === 409, "no se puede anular dos veces", `estado ${dosVeces.estado}`);
ok((await patio(tipo.id)) === 600, "y por eso no se devuelven dos veces", String(await patio(tipo.id)));

console.log("\n=== con la anulada, la cotización vuelve a estar por entregar ===");
const qp2 = (await pedir(`/quotes/${cot.id}/que-producir`)).cuerpo;
const l2 = qp2.lines.find((l) => l.esProducible);
ok(l2.yaFacturado === 0, "ya no cuenta como facturada", String(l2.yaFacturado));
ok(l2.hayQueProducir === 0, "y los 600 del patio cubren los 400", String(l2.hayQueProducir));

console.log("\n=== facturar por partes ===");
const pend = (await pedir(`/quotes/${cot.id}/por-facturar`)).cuerpo.lines.find(
  (l) => l.description === tipo.name,
);
const parcial = await pedir("/invoices", {
  quoteId: cot.id,
  lines: [{ catalogItemId: producto.id, quoteLineId: pend.quoteLineId, quantity: 150 }],
});
ok(parcial.estado === 201, "se facturan solo 150");
ok((await patio(tipo.id)) === 450, "el patio baja 150", String(await patio(tipo.id)));
const qp3 = (await pedir(`/quotes/${cot.id}/que-producir`)).cuerpo.lines.find((l) => l.esProducible);
ok(qp3.yaFacturado === 150, "la cotización sabe que van 150 entregados", String(qp3.yaFacturado));
const resto = await pedir("/invoices", { quoteId: cot.id });
ok(resto.estado === 201, "lo que falta se factura sin escribir líneas");
ok((await patio(tipo.id)) === 200, "y salen los 250 restantes del patio", String(await patio(tipo.id)));

console.log("\n=== facturar más de lo que hay ===");
const grande = await pedir("/invoices", {
  customerId: cliente.id,
  lines: [{ catalogItemId: producto.id, quantity: 500 }],
});
ok(grande.estado === 201, "no se impide facturar: puede faltar anotar producción");
ok(
  (grande.cuerpo.avisos ?? []).some((a) => /había 200.*quedó en -300/.test(a)),
  "pero avisa que la existencia quedó en −300",
  (grande.cuerpo.avisos ?? []).join(" | "),
);
ok((await patio(tipo.id)) === -300, "y el patio queda en −300, a la vista", String(await patio(tipo.id)));

console.log("\n=== una factura suelta sin producto no toca el patio ===");
const suelta = await pedir("/invoices", {
  customerId: cliente.id,
  lines: [{ description: "Arena", unitPriceCents: 1000, quantity: 3 }],
});
ok(suelta.estado === 201, "se factura una línea libre");
ok((await patio(tipo.id)) === -300, "y el patio no se mueve", String(await patio(tipo.id)));

console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
