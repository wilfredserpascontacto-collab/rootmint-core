/**
 * La factura, golpeando la API de verdad.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-factura PORT=4380 node dist/index.js &
 *   node scripts/probar-factura.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4380";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};
const dinero = (c) => `$${(c / 100).toFixed(2)}`;

function navegador() {
  let galleta = "";
  return async (ruta, opciones = {}) => {
    const r = await fetch(BASE + ruta, {
      ...opciones,
      headers: {
        ...(opciones.body ? { "content-type": "application/json" } : {}),
        ...(galleta ? { cookie: galleta } : {}),
      },
    });
    const set = r.headers.get("set-cookie");
    if (set) galleta = set.split(";")[0];
    return { estado: r.status, cuerpo: await r.json().catch(() => null) };
  };
}

const duena = navegador();
await duena("/auth/primera-duena", {
  method: "POST",
  body: JSON.stringify({ name: "Amada", email: "amada@bloquestitan.com", password: "unaClaveLarga1" }),
});

// --- Con qué trabajar --------------------------------------------------------
const constructora = (await duena("/customers", {
  method: "POST",
  body: JSON.stringify({ name: "Constructora del Valle", type: "company", nrc: "123456-7", nit: "0614-010190-101-2" }),
})).cuerpo;

const persona = (await duena("/customers", {
  method: "POST",
  body: JSON.stringify({ name: "Rosa Menjívar", type: "person" }),
})).cuerpo;

const bloque = (await duena("/catalog-items", {
  method: "POST",
  body: JSON.stringify({ name: "Bloque 15x20x40", code: "BLQ-15", type: "product", unit: "unidad", unitPriceCents: 45 }),
})).cuerpo;

console.log("\n=== el tipo de documento se propone solo ===");
const cot = (await duena("/quotes", {
  method: "POST",
  body: JSON.stringify({
    customerId: constructora.id,
    lines: [{ catalogItemId: bloque.id, quantity: 1000 }],
    taxRatePercent: 13,
  }),
})).cuerpo;
ok(cot?.id !== undefined, "se crea una cotización de 1000 bloques", cot && dinero(cot.totalCents));

// El renglon de la cotizacion: hace falta para poder facturar por partes.
const renglonCot = (await duena(`/quotes/${cot.id}/por-facturar`)).cuerpo.lines[0];
const f1 = await duena("/invoices", {
  method: "POST",
  body: JSON.stringify({
    quoteId: cot.id,
    lines: [{ catalogItemId: bloque.id, quoteLineId: renglonCot.quoteLineId, quantity: 400, unitPriceCents: 45 }],
  }),
});
ok(f1.estado === 201, "se factura una parte", `estado ${f1.estado}`);
ok(f1.cuerpo?.kind === "ccf", "y sale como crédito fiscal, porque el cliente tiene NRC", f1.cuerpo?.kind);
ok(f1.cuerpo?.number === 1, "con el número 1 de su serie");
ok(f1.cuerpo?.subtotalCents === 18000, "subtotal correcto", dinero(f1.cuerpo?.subtotalCents ?? 0));
ok(f1.cuerpo?.taxCents === 2340, "IVA del 13%", dinero(f1.cuerpo?.taxCents ?? 0));
ok(f1.cuerpo?.totalCents === 20340, "total", dinero(f1.cuerpo?.totalCents ?? 0));

const fPersona = await duena("/invoices", {
  method: "POST",
  body: JSON.stringify({ customerId: persona.id, lines: [{ catalogItemId: bloque.id, quantity: 50 }] }),
});
ok(fPersona.cuerpo?.kind === "final", "a una persona sin NRC le sale consumidor final", fPersona.cuerpo?.kind);
ok(fPersona.cuerpo?.number === 1, "y también arranca en 1: cada serie lleva su propia cuenta");

console.log("\n=== avisa cuando el tipo no cuadra ===");
const forzada = await duena("/invoices", {
  method: "POST",
  body: JSON.stringify({ customerId: persona.id, kind: "ccf", lines: [{ catalogItemId: bloque.id, quantity: 10 }] }),
});
ok(
  (forzada.cuerpo?.avisos ?? []).some((a) => /NRC/.test(a)),
  "un crédito fiscal a alguien sin NRC avisa",
  forzada.cuerpo?.avisos?.[0],
);
ok(forzada.estado === 201, "pero lo deja hacer: avisar no es impedir");

console.log("\n=== lo que queda por facturar ===");
const pf = await duena(`/quotes/${cot.id}/por-facturar`);
const renglon = pf.cuerpo?.lines?.[0];
ok(renglon?.cotizado === 1000, "cotizados 1000");
ok(renglon?.facturado === 400, "facturados 400");
ok(renglon?.pendiente === 600, "quedan 600");

console.log("\n=== facturar el resto sin decir cuánto ===");
const f2 = await duena("/invoices", { method: "POST", body: JSON.stringify({ quoteId: cot.id }) });
ok(f2.estado === 201, "se factura el saldo solo", `estado ${f2.estado}`);
// Van tres de credito fiscal: la parcial, la que se forzo a la persona sin
// NRC, y esta. Contarlas mal es facil, y es justo lo que hay que vigilar en
// una serie de correlativos.
ok(f2.cuerpo?.number === 3, "con el número 3 de crédito fiscal", `salió la ${f2.cuerpo?.number}`);
ok(f2.cuerpo?.subtotalCents === 27000, "por los 600 que faltaban", dinero(f2.cuerpo?.subtotalCents ?? 0));

const otra = await duena("/invoices", { method: "POST", body: JSON.stringify({ quoteId: cot.id }) });
ok(otra.estado === 409, "y ya no deja facturarla de nuevo", otra.cuerpo?.error);

console.log("\n=== facturar de más avisa, pero deja ===");
const cot2 = (await duena("/quotes", {
  method: "POST",
  body: JSON.stringify({ customerId: constructora.id, lines: [{ catalogItemId: bloque.id, quantity: 100 }], taxRatePercent: 13 }),
})).cuerpo;
const lineasCot2 = (await duena(`/quotes/${cot2.id}/por-facturar`)).cuerpo.lines;
const demas = await duena("/invoices", {
  method: "POST",
  body: JSON.stringify({
    quoteId: cot2.id,
    lines: [{ quoteLineId: lineasCot2[0].quoteLineId, description: "Bloque 15x20x40", unitPriceCents: 45, quantity: 130 }],
  }),
});
ok(demas.estado === 201, "deja facturar 130 de 100 cotizados");
ok(
  (demas.cuerpo?.avisos ?? []).some((a) => /quedaban 100/.test(a)),
  "y lo dice",
  demas.cuerpo?.avisos?.[0],
);

console.log("\n=== anular ===");
const sinMotivo = await duena(`/invoices/${f1.cuerpo.id}/anular`, { method: "POST", body: JSON.stringify({ reason: "" }) });
ok(sinMotivo.estado === 400, "no deja anular sin decir por qué", sinMotivo.cuerpo?.error);

const anulada = await duena(`/invoices/${f1.cuerpo.id}/anular`, {
  method: "POST",
  body: JSON.stringify({ reason: "Se facturó al cliente equivocado" }),
});
ok(anulada.estado === 200 && anulada.cuerpo?.status === "annulled", "se anula con motivo");
ok(anulada.cuerpo?.annulReason === "Se facturó al cliente equivocado", "y el motivo queda guardado");

const dosVeces = await duena(`/invoices/${f1.cuerpo.id}/anular`, {
  method: "POST",
  body: JSON.stringify({ reason: "otra vez" }),
});
ok(dosVeces.estado === 409, "no se anula dos veces", dosVeces.cuerpo?.error);

const pf2 = await duena(`/quotes/${cot.id}/por-facturar`);
ok(pf2.cuerpo?.lines?.[0]?.pendiente === 400, "lo anulado vuelve a quedar por facturar", `pendiente ${pf2.cuerpo?.lines?.[0]?.pendiente}`);

const siguiente = await duena("/invoices", {
  method: "POST",
  body: JSON.stringify({ customerId: constructora.id, lines: [{ catalogItemId: bloque.id, quantity: 1 }] }),
});
// La 1 quedo anulada y la serie ya iba por 4 (parcial, forzada, resto, la de
// mas). Esta es la 5: el hueco de la 1 se queda donde esta.
ok(siguiente.cuerpo?.number === 5, "el número anulado NO se reusa: la serie sigue", `salió la ${siguiente.cuerpo?.number}`);

console.log("\n=== una factura emitida no se edita ===");
const editar = await duena(`/invoices/${f2.cuerpo.id}`, { method: "PATCH", body: JSON.stringify({ totalCents: 1 }) });
ok(editar.estado === 404 || editar.estado === 405, "no hay forma de editarla", `dio ${editar.estado}`);

console.log("\n=== queda congelada ===");
const detalle = await duena(`/invoices/${f2.cuerpo.id}`);
ok(detalle.cuerpo?.customerSnapshot?.name === "Constructora del Valle", "guarda al cliente como estaba");
ok((detalle.cuerpo?.lines ?? []).length === 1, "y sus líneas");

console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
