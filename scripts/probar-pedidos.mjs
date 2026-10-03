/**
 * Pedidos y reservas: apartar bloques del patio para un cliente, que otro
 * pedido no se los lleve, y que facturar (o anular) mueva la reserva sola.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-ped PORT=4480 node dist/index.js &
 *   BASE=http://127.0.0.1:4480 node scripts/probar-pedidos.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4480";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};

function navegador() {
  let galleta = "";
  return async (ruta, cuerpo, metodo) => {
    const r = await fetch(BASE + ruta, {
      method: metodo ?? (cuerpo !== undefined ? "POST" : "GET"),
      headers: {
        ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}),
        ...(galleta ? { cookie: galleta } : {}),
      },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
    const set = r.headers.get("set-cookie");
    if (set) galleta = set.split(";")[0];
    return { estado: r.status, cuerpo: await r.json().catch(() => null) };
  };
}
const duena = navegador();
const personal = navegador();
const consulta = navegador();

await duena("/auth/primera-duena", { name: "Amada", email: "amada@bloquestitan.com", password: "unaClaveLarga1" });
await duena("/users", { name: "Beto", email: "beto@bloquestitan.com", password: "otraClaveLarga1", role: "staff" });
await duena("/users", { name: "Carla", email: "carla@bloquestitan.com", password: "otraClaveLarga1", role: "viewer" });
await personal("/auth/entrar", { email: "beto@bloquestitan.com", password: "otraClaveLarga1" });
await consulta("/auth/entrar", { email: "carla@bloquestitan.com", password: "otraClaveLarga1" });

// --- Un patio con 600 bloques, un producto enlazado y dos clientes ---------------
const tipo = (await duena("/bloques/tipos")).cuerpo[0];
const materiales = (await duena("/bloques/materiales")).cuerpo;
const rr = (
  await duena("/bloques/recetas", {
    code: "R-PED", name: "Mezcla de prueba", blockTypeId: tipo.id, expectedBlocksPerMix: 60,
    renglones: materiales.slice(0, 3).map((m) => ({ materialId: m.id, quantityMilli: 5000 })),
  })
).cuerpo;
await duena("/bloques/lotes", { recipeId: (rr.receta ?? rr).id, mixes: 10, blocksGood: 600, blocksBroken: 0 });

const producto = (
  await duena("/catalog-items", { name: tipo.name, code: "PED-1", type: "product", unit: "unidad", unitPriceCents: 45 })
).cuerpo;
await duena(`/catalog-items/${producto.id}/tipo-bloque`, { blockTypeId: tipo.id }, "PATCH");
const flete = (
  await duena("/catalog-items", { name: "Flete", code: "PED-FLETE", type: "service", unit: "viaje", unitPriceCents: 3000 })
).cuerpo;
const ana = (await duena("/customers", { name: "Constructora Ana", type: "company", nrc: "111111-1" })).cuerpo;
const beto = (await duena("/customers", { name: "Don Beto", type: "person" })).cuerpo;

const inv = async () => (await duena("/inventario")).cuerpo.find((x) => x.blockTypeId === tipo.id);
const ficha = async (id) => (await duena(`/pedidos/${id}`)).cuerpo;

console.log("\n=== el patio arranca libre ===");
let i = await inv();
ok(i.existencia === 600 && i.reservado === 0 && i.disponible === 600, "600 en el patio, nada apartado, 600 disponibles");

console.log("\n=== un pedido aparta lo que hay ===");
const vacio = await duena("/pedidos", { customerId: ana.id, lines: [] });
ok(vacio.estado === 400, "un pedido sin renglones se rechaza");
const cero = await duena("/pedidos", { customerId: ana.id, lines: [{ catalogItemId: producto.id, quantity: 0 }] });
ok(cero.estado === 400, "una cantidad de cero se rechaza");
const sinCliente = await duena("/pedidos", { customerId: "00000000-0000-4000-8000-000000000000", lines: [{ catalogItemId: producto.id, quantity: 5 }] });
ok(sinCliente.estado === 400, "un cliente que no existe se rechaza", `estado ${sinCliente.estado}`);

const p1r = await duena("/pedidos", {
  customerId: ana.id,
  neededBy: "2026-11-15T00:00:00.000Z",
  lines: [
    { catalogItemId: producto.id, quantity: 400 },
    { catalogItemId: flete.id, quantity: 1 },
  ],
});
ok(p1r.estado === 201 && p1r.cuerpo.number === 1, "se crea el pedido N° 1 de Ana: 400 bloques y un flete", `estado ${p1r.estado}`);
ok(p1r.cuerpo.avisos.length === 0, "y no hay nada que avisar: había de sobra");
let p1 = await ficha(p1r.cuerpo.id);
const l1 = p1.lines.find((l) => l.catalogItemId === producto.id);
ok(p1.estado === "abierto" && p1.customerName === "Constructora Ana", "queda abierto, con el nombre del cliente");
ok(l1.reservado === 400 && l1.porProducir === 0, "apartó los 400 y no falta producir nada", `${l1.reservado}`);
ok(p1.lines.find((l) => l.catalogItemId === flete.id).reservado === 0, "el flete no aparta nada: no es un bloque");
ok(p1.totalCents === 400 * 45 + 3000, "el total sale de los precios del catálogo", String(p1.totalCents));
i = await inv();
ok(i.existencia === 600 && i.reservado === 400 && i.disponible === 200, "el patio sigue en 600, pero solo 200 están disponibles", `${i.reservado}/${i.disponible}`);
ok(i.pedidosConReserva.includes(1), "y dice qué pedido los tiene apartados");

console.log("\n=== otro pedido solo aparta lo libre ===");
const p2r = await duena("/pedidos", { customerId: beto.id, lines: [{ catalogItemId: producto.id, quantity: 300 }] });
ok(p2r.estado === 201 && p2r.cuerpo.number === 2, "el pedido N° 2 pide 300");
ok(p2r.cuerpo.avisos.some((a) => /se apartaron 200 de los 300/.test(a) && /otros 100 hay que producirlos/.test(a)), "se aparta 200 y avisa que faltan 100", p2r.cuerpo.avisos.join(" | "));
let p2 = await ficha(p2r.cuerpo.id);
ok(p2.lines[0].reservado === 200 && p2.lines[0].porProducir === 100, "la ficha muestra 200 apartados y 100 por producir");
i = await inv();
ok(i.reservado === 600 && i.disponible === 0, "ya no queda nada libre: 0 disponibles", `${i.disponible}`);

console.log("\n=== quien consulta no promete bloques ===");
const noPuede = await consulta("/pedidos", { customerId: ana.id, lines: [{ catalogItemId: producto.id, quantity: 1 }] });
ok(noPuede.estado === 403, "quien solo consulta no crea pedidos", `estado ${noPuede.estado}`);
const sePuede = await personal("/pedidos", { customerId: ana.id, lines: [{ catalogItemId: flete.id, quantity: 1 }] });
ok(sePuede.estado === 201, "el personal sí");

console.log("\n=== cancelar libera lo apartado ===");
const sinMotivo = await duena(`/pedidos/${p1r.cuerpo.id}/cancelar`, {});
ok(sinMotivo.estado === 400, "no se cancela sin motivo");
const canc = await duena(`/pedidos/${p1r.cuerpo.id}/cancelar`, { reason: "El cliente se arrepintió" });
ok(canc.estado === 200 && canc.cuerpo.estado === "cancelado", "se cancela el pedido N° 1 con su motivo");
i = await inv();
ok(i.reservado === 200 && i.disponible === 400, "los 400 vuelven a estar libres: quedan 400 disponibles", `${i.disponible}`);
const otraVez = await duena(`/pedidos/${p1r.cuerpo.id}/cancelar`, { reason: "De nuevo" });
ok(otraVez.estado === 409, "no se cancela dos veces");
const reservaCancelado = await duena(`/pedidos/${p1r.cuerpo.id}/reservar`, {});
ok(reservaCancelado.estado === 409, "y un pedido cancelado no aparta nada");

console.log("\n=== volver a apartar cuando hay más ===");
const re = await duena(`/pedidos/${p2r.cuerpo.id}/reservar`, {});
ok(re.estado === 200 && re.cuerpo.reservado === 300 && re.cuerpo.porProducir === 0, "el N° 2 completa sus 300", `${re.cuerpo.reservado}`);
i = await inv();
ok(i.reservado === 300 && i.disponible === 300, "quedan 300 libres");
const nada = await duena(`/pedidos/${p2r.cuerpo.id}/reservar`, {});
ok(nada.cuerpo.avisos.some((a) => /ya está apartado/.test(a)), "si ya está todo apartado lo dice, no inventa");

console.log("\n=== soltar lo apartado ===");
const lib = await duena(`/pedidos/${p2r.cuerpo.id}/liberar`, {});
ok(lib.cuerpo.reservado === 0 && lib.cuerpo.porProducir === 300, "se libera todo: 0 apartados, 300 por producir");
i = await inv();
ok(i.disponible === 600, "el patio vuelve a tener 600 disponibles");
await duena(`/pedidos/${p2r.cuerpo.id}/reservar`, {});

console.log("\n=== facturar un pedido ===");
const f1 = await duena("/invoices", { salesOrderId: p2r.cuerpo.id });
ok(f1.estado === 201, "se factura el pedido N° 2 sin decir líneas", `estado ${f1.estado}`);
ok(f1.cuerpo.totalCents === 15255, "la factura sale de lo pedido", String(f1.cuerpo.totalCents));
ok(f1.cuerpo.salesOrderId === p2r.cuerpo.id, "y queda ligada al pedido");
ok((await inv()).existencia === 300, "el patio baja a 300");
p2 = await ficha(p2r.cuerpo.id);
ok(p2.estado === "cumplido" && p2.lines[0].facturado === 300 && p2.lines[0].pendiente === 0, "el pedido queda cumplido: 300 facturados, 0 pendientes");
ok(p2.reservado === 0, "y ya no tiene nada apartado: la venta se llevó la reserva");
i = await inv();
ok(i.reservado === 0 && i.disponible === 300, "el patio tiene 300 libres");
ok(p2.invoices.length === 1, "la ficha lista la factura");
const yaFacturado = await duena("/invoices", { salesOrderId: p2r.cuerpo.id });
ok(yaFacturado.estado === 409, "no se factura otra vez un pedido cumplido", `estado ${yaFacturado.estado}`);
const aCancelado = await duena("/invoices", { salesOrderId: p1r.cuerpo.id });
ok(aCancelado.estado === 409, "ni uno cancelado", `estado ${aCancelado.estado}`);

console.log("\n=== anular la factura devuelve la reserva ===");
const an = await duena(`/invoices/${f1.cuerpo.id}/anular`, { reason: "Error de cliente" });
ok(an.estado === 200, "se anula la factura");
p2 = await ficha(p2r.cuerpo.id);
ok(p2.estado === "abierto" && p2.lines[0].pendiente === 300 && p2.reservado === 300, "el pedido vuelve a deber 300 y a tenerlos apartados", `${p2.reservado}`);
i = await inv();
ok(i.existencia === 600 && i.reservado === 300, "el patio vuelve a 600 con 300 apartados");

console.log("\n=== facturar por partes ===");
const parcial = await duena("/invoices", {
  salesOrderId: p2r.cuerpo.id,
  lines: [{ salesOrderLineId: p2.lines[0].id, catalogItemId: producto.id, quantity: 100 }],
});
ok(parcial.estado === 201, "se factura una entrega de 100");
p2 = await ficha(p2r.cuerpo.id);
ok(p2.lines[0].facturado === 100 && p2.lines[0].pendiente === 200 && p2.lines[0].reservado === 200, "quedan 200 pendientes y 200 apartados", `${p2.lines[0].reservado}`);
const ajeno = await duena("/invoices", {
  salesOrderId: p2r.cuerpo.id,
  lines: [{ salesOrderLineId: "00000000-0000-4000-8000-000000000000", catalogItemId: producto.id, quantity: 1 }],
});
ok(ajeno.estado >= 400, "un renglón que no es de este pedido se rechaza", `estado ${ajeno.estado}`);

console.log("\n=== una venta suelta que se lleva bloques apartados ===");
// Hay 500 en el patio y 200 apartados: vender 450 deja solo 50.
const suelta = await duena("/invoices", { customerId: ana.id, lines: [{ catalogItemId: producto.id, quantity: 450 }] });
ok(suelta.estado === 201, "se vende sin pedido: 450 bloques");
ok(suelta.cuerpo.avisos.some((a) => /apartados para el pedido N° 2/.test(a) && /le faltan 150/.test(a)), "avisa que se llevó bloques del pedido N° 2: le faltan 150", suelta.cuerpo.avisos.join(" | "));

console.log("\n=== que-producir descuenta lo apartado para otros ===");
const q2 = (await duena("/quotes", { customerId: ana.id, lines: [{ catalogItemId: producto.id, quantity: 50 }], taxRatePercent: 13 })).cuerpo;
const qp = (await duena(`/quotes/${q2.id}/que-producir`)).cuerpo;
const lq = qp.lines.find((l) => l.esProducible);
ok(lq.enExistencia === 0 && lq.apartadoParaOtros === 200, "en el patio hay 50 pero 200 están prometidos: a esta cotización le tocan 0", `${lq.enExistencia}/${lq.apartadoParaOtros}`);
ok(lq.hayQueProducir === 50, "faltan 50 por producir");

console.log("\n=== un pedido nacido de una cotización ===");
await duena(`/pedidos/${p2r.cuerpo.id}/cancelar`, { reason: "Ya no lo quieren" });
const q3 = (await duena("/quotes", { customerId: beto.id, lines: [{ catalogItemId: producto.id, quantity: 50 }, { catalogItemId: flete.id, quantity: 1 }], taxRatePercent: 13 })).cuerpo;
const pq = await duena("/pedidos/desde-cotizacion", { quoteId: q3.id });
ok(pq.estado === 201 && pq.cuerpo.number === 4, "se crea desde la cotización", `estado ${pq.estado}`);
const fq = await ficha(pq.cuerpo.id);
ok(fq.quoteId === q3.id && fq.lines.length === 2, "copia los dos renglones");
ok(fq.lines.find((l) => l.catalogItemId === producto.id).reservado === 50, "y aparta los 50 que quedaban");
const otro = await duena("/pedidos/desde-cotizacion", { quoteId: q3.id });
ok(otro.estado === 409, "una cotización no tiene dos pedidos abiertos", `estado ${otro.estado}`);
const qp3 = (await duena(`/quotes/${q3.id}/que-producir`)).cuerpo;
ok(qp3.lines.find((l) => l.esProducible).hayQueProducir === 0, "su propia cotización no compite contra su propia reserva: no falta producir");
const q4 = (await duena("/quotes", { customerId: ana.id, lines: [{ catalogItemId: producto.id, quantity: 20 }], taxRatePercent: 13 })).cuerpo;
const qp4 = (await duena(`/quotes/${q4.id}/que-producir`)).cuerpo;
ok(qp4.lines.find((l) => l.esProducible).hayQueProducir === 20, "pero otra cotización sí ve esos 50 como ocupados");

console.log("\n=== facturar desde la cotización cumple el pedido ===");
const fcot = await duena("/invoices", { quoteId: q3.id });
ok(fcot.estado === 201, "se factura la cotización, sin tocar el pedido");
const despues = await ficha(pq.cuerpo.id);
ok(despues.estado === "cumplido" && despues.reservado === 0, "el pedido se da cuenta solo: cumplido y sin reserva", `${despues.estado}/${despues.reservado}`);
ok(despues.invoices.length === 1, "y la factura aparece en su ficha");

console.log("\n=== la lista ===");
const abiertos = (await duena("/pedidos")).cuerpo;
ok(abiertos.every((p) => p.estado === "abierto"), "por defecto solo trae los abiertos", abiertos.map((p) => p.number).join(","));
const todos = (await duena("/pedidos?estado=todos")).cuerpo;
ok(todos.length === 4 && todos[0].number === 4, "con «todos» trae los cuatro, el más nuevo primero");
ok(todos.find((p) => p.number === 1).estado === "cancelado" && todos.find((p) => p.number === 4).estado === "cumplido", "cada uno con su estado");

console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
