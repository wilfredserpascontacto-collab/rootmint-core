/**
 * Despacho: el papel que firma quien recibe, y lo unico que saca bloques del
 * patio. Que facturar ya no los saque, que se pueda entregar en viajes, que
 * no se entregue de mas, y que anular devuelva.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-desp PORT=4580 node dist/index.js &
 *   BASE=http://127.0.0.1:4580 node scripts/probar-despachos.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4580";
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
const consulta = navegador();

/** Un PNG de 1x1 que hace de firma y de foto. */
const IMAGEN =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

await duena("/auth/primera-duena", { name: "Amada", email: "amada@bloquestitan.com", password: "unaClaveLarga1" });
await duena("/users", { name: "Carla", email: "carla@bloquestitan.com", password: "otraClaveLarga1", role: "viewer" });
await consulta("/auth/entrar", { email: "carla@bloquestitan.com", password: "otraClaveLarga1" });

// --- Un patio con 1000 bloques y un producto enlazado -------------------------
const tipo = (await duena("/bloques/tipos")).cuerpo[0];
const materiales = (await duena("/bloques/materiales")).cuerpo;
const rr = (
  await duena("/bloques/recetas", {
    code: "R-DESP", name: "Mezcla de prueba", blockTypeId: tipo.id, expectedBlocksPerMix: 100,
    renglones: materiales.slice(0, 3).map((m) => ({ materialId: m.id, quantityMilli: 5000 })),
  })
).cuerpo;
await duena("/bloques/lotes", { recipeId: (rr.receta ?? rr).id, mixes: 10, blocksGood: 1000, blocksBroken: 0 });

const producto = (
  await duena("/catalog-items", { name: tipo.name, code: "D-1", type: "product", unit: "unidad", unitPriceCents: 50 })
).cuerpo;
await duena(`/catalog-items/${producto.id}/tipo-bloque`, { blockTypeId: tipo.id }, "PATCH");
const flete = (
  await duena("/catalog-items", { name: "Flete", code: "D-FLETE", type: "service", unit: "viaje", unitPriceCents: 2500 })
).cuerpo;
const ana = (await duena("/customers", { name: "Constructora Ana", type: "company", nrc: "111111-1" })).cuerpo;
const beto = (await duena("/customers", { name: "Don Beto", type: "person" })).cuerpo;

const patio = async () => (await duena("/inventario")).cuerpo.find((i) => i.blockTypeId === tipo.id);

console.log("\n=== el mostrador: factura y se lo lleva en el acto ===");
let p = await patio();
ok(p.existencia === 1000 && p.disponible === 1000, "el patio arranca con 1000 libres", `exist ${p.existencia} disp ${p.disponible}`);

const mostrador = await duena("/invoices", {
  customerId: beto.id,
  lines: [{ catalogItemId: producto.id, quantity: 100 }],
});
ok(mostrador.estado === 201, "se emite la factura de mostrador", `estado ${mostrador.estado}`);
ok(mostrador.cuerpo.despachoNumero === 1, "y nace sola con su despacho N° 1", JSON.stringify(mostrador.cuerpo.despachoNumero));
p = await patio();
ok(p.existencia === 900, "el patio bajó a 900: el bloque salió de verdad", String(p.existencia));
ok(p.porDespachar === 0, "no queda nada esperando camión");

console.log("\n=== la obra: se factura hoy, el camión sale después ===");
const obra = await duena("/invoices", {
  customerId: ana.id,
  despacharAhora: false,
  lines: [
    { catalogItemId: producto.id, quantity: 300 },
    { catalogItemId: flete.id, quantity: 1 },
  ],
});
ok(obra.estado === 201, "se emite la factura de la obra", `estado ${obra.estado}`);
ok(obra.cuerpo.despachoNumero === null, "sin despacho todavía");
ok(
  obra.cuerpo.avisos.some((a) => /quedan en el patio/i.test(a)),
  "avisa que los bloques quedan en el patio a nombre del cliente",
  (obra.cuerpo.avisos ?? []).join(" | ").slice(0, 120),
);
p = await patio();
ok(p.existencia === 900, "el patio NO bajó: los bloques siguen ahí", String(p.existencia));
ok(p.porDespachar === 300, "pero 300 figuran por despachar", String(p.porDespachar));
ok(p.disponible === 600, "y lo libre para vender es 600, no 900", String(p.disponible));
ok(p.facturasPorDespachar.includes(obra.cuerpo.number), "diciendo de qué factura son", JSON.stringify(p.facturasPorDespachar));

console.log("\n=== qué falta entregar de esa factura ===");
const pend = (await duena(`/invoices/${obra.cuerpo.id}/por-despachar`)).cuerpo;
ok(pend.faltaAlgo === true, "dice que falta entregar");
const renglonBloques = pend.renglones.find((r) => r.blockTypeId === tipo.id);
const renglonFlete = pend.renglones.find((r) => !r.blockTypeId);
ok(renglonBloques.falta === 300, "faltan los 300 bloques", String(renglonBloques.falta));
ok(Boolean(renglonFlete), "y el flete también figura, aunque no tenga patio");

console.log("\n=== primer viaje: 200, firmados y con foto ===");
const viaje1 = await duena("/despachos", {
  invoiceId: obra.cuerpo.id,
  receivedByName: "Maura, la maestra de obra",
  receivedByDocument: "01234567-8",
  address: "Lotificación El Níspero, lote 12",
  driverName: "Chepe",
  vehiclePlate: "P 123-456",
  signature: IMAGEN,
  fotos: [{ dataUrl: IMAGEN, caption: "El camión cargado" }],
  lines: [{ invoiceLineId: renglonBloques.id, quantity: 200 }],
});
ok(viaje1.estado === 201, "se despachan 200", `estado ${viaje1.estado} ${JSON.stringify(viaje1.cuerpo).slice(0, 140)}`);
ok(viaje1.cuerpo.number === 2, "con el despacho N° 2", String(viaje1.cuerpo.number));
ok(
  !(viaje1.cuerpo.avisos ?? []).some((a) => /sin firma/i.test(a)),
  "y no avisa de firma faltante, porque está firmado",
);
p = await patio();
ok(p.existencia === 700, "ahora sí bajó el patio: 700", String(p.existencia));
ok(p.porDespachar === 100, "y quedan 100 por salir", String(p.porDespachar));
ok(p.disponible === 600, "lo libre sigue siendo 600: no cambió, solo se movió de columna", String(p.disponible));

console.log("\n=== no se entrega más de lo facturado ===");
const demas = await duena("/despachos", {
  invoiceId: obra.cuerpo.id,
  receivedByName: "Maura",
  lines: [{ invoiceLineId: renglonBloques.id, quantity: 300 }],
});
ok(demas.estado === 409, "no deja entregar 300 cuando quedan 100", `estado ${demas.estado}`);
ok(/quedan 100/.test(demas.cuerpo?.error ?? ""), "y lo dice con números, no con un código", demas.cuerpo?.error?.slice(0, 120));

console.log("\n=== segundo viaje: los 100 que faltaban, sin firma ===");
const viaje2 = await duena("/despachos", {
  invoiceId: obra.cuerpo.id,
  receivedByName: "Maura",
  lines: [{ invoiceLineId: renglonBloques.id, quantity: 100 }],
});
ok(viaje2.estado === 201, "entra el segundo viaje", `estado ${viaje2.estado}`);
ok(
  (viaje2.cuerpo.avisos ?? []).some((a) => /sin firma/i.test(a)),
  "pero avisa que quedó sin firma",
  (viaje2.cuerpo.avisos ?? []).join(" | ").slice(0, 110),
);
p = await patio();
ok(p.existencia === 600 && p.porDespachar === 0, "el patio quedó en 600 y nada por despachar", `${p.existencia} / ${p.porDespachar}`);
const pend2 = (await duena(`/invoices/${obra.cuerpo.id}/por-despachar`)).cuerpo;
ok(pend2.renglones.find((r) => r.blockTypeId === tipo.id).falta === 0, "la factura ya no debe bloques");

console.log("\n=== la ficha guarda la firma y la foto ===");
const ficha = (await duena(`/despachos/${viaje1.cuerpo.id}`)).cuerpo;
ok(ficha.signature === IMAGEN, "la firma quedó guardada");
ok(ficha.fotos.length === 1 && ficha.fotos[0].caption === "El camión cargado", "y la foto con su pie");
ok(ficha.receivedByName === "Maura, la maestra de obra", "con el nombre de quien recibió");
ok(ficha.driverName === "Chepe" && ficha.vehiclePlate === "P 123-456", "y quién lo llevó");

console.log("\n=== la lista no arrastra las fotos ===");
const lista = (await duena("/despachos")).cuerpo;
ok(lista.length === 3, "hay tres despachos", String(lista.length));
ok(lista[0].number === 4 || lista[0].number === 3, "el más nuevo primero", String(lista[0].number));
ok(!("signature" in lista[0]) && !("fotos" in lista[0] && typeof lista[0].fotos === "object"), "la lista no trae la firma");
const enLista = lista.find((d) => d.id === viaje1.cuerpo.id);
ok(enLista.tieneFirma === true && enLista.fotos === 1, "pero sí dice que tiene firma y cuántas fotos", `${enLista.tieneFirma} / ${enLista.fotos}`);
ok(enLista.bloques === 200, "y cuántos bloques salieron", String(enLista.bloques));

console.log("\n=== anular un despacho devuelve los bloques ===");
const sinMotivo = await duena(`/despachos/${viaje2.cuerpo.id}/anular`, { reason: "" });
ok(sinMotivo.estado === 400, "no deja anular sin motivo", `estado ${sinMotivo.estado}`);
const anulado = await duena(`/despachos/${viaje2.cuerpo.id}/anular`, { reason: "Se cargó el camión equivocado" });
ok(anulado.estado === 200, "se anula con motivo", `estado ${anulado.estado}`);
p = await patio();
ok(p.existencia === 700, "los 100 volvieron al patio", String(p.existencia));
ok(p.porDespachar === 100, "y vuelven a figurar por despachar", String(p.porDespachar));
const dosVeces = await duena(`/despachos/${viaje2.cuerpo.id}/anular`, { reason: "otra vez" });
ok(dosVeces.estado === 409, "no se anula dos veces", `estado ${dosVeces.estado}`);

console.log("\n=== anular la factura ===");
const conFirma = await duena(`/invoices/${obra.cuerpo.id}/anular`, { reason: "El cliente se arrepintió" });
ok(conFirma.estado === 409, "no deja anular una factura con un despacho firmado", `estado ${conFirma.estado}`);
ok(/firmado o tiene fotos/.test(conFirma.cuerpo?.error ?? ""), "y explica por qué", conFirma.cuerpo?.error?.slice(0, 130));

await duena(`/despachos/${viaje1.cuerpo.id}/anular`, { reason: "Devolvieron todo" });
const ahoraSi = await duena(`/invoices/${obra.cuerpo.id}/anular`, { reason: "El cliente se arrepintió" });
ok(ahoraSi.estado === 200, "anulado el despacho, la factura sí se anula", `estado ${ahoraSi.estado}`);
p = await patio();
ok(p.existencia === 900 && p.porDespachar === 0, "el patio volvió a 900 y no queda nada por despachar", `${p.existencia} / ${p.porDespachar}`);

console.log("\n=== la factura de mostrador se anula de un golpe ===");
const mostradorAnulada = await duena(`/invoices/${mostrador.cuerpo.id}/anular`, { reason: "Se equivocó de producto" });
ok(mostradorAnulada.estado === 200, "se anula sin pedir anular antes el despacho", `estado ${mostradorAnulada.estado} ${mostradorAnulada.cuerpo?.error ?? ""}`);
p = await patio();
ok(p.existencia === 1000, "y los 100 del mostrador volvieron: el patio está otra vez en 1000", String(p.existencia));
const despMostrador = (await duena("/despachos?estado=anulado")).cuerpo;
ok(despMostrador.some((d) => d.number === 1), "su despacho quedó anulado también", JSON.stringify(despMostrador.map((d) => d.number)));

console.log("\n=== quien solo mira, solo mira ===");
const intento = await consulta("/despachos", {
  customerId: beto.id,
  receivedByName: "Alguien",
  lines: [{ catalogItemId: producto.id, quantity: 1 }],
});
ok(intento.estado === 403, "una cuenta de solo lectura no puede despachar", `estado ${intento.estado}`);
ok((await consulta("/despachos")).estado === 200, "pero sí puede verlos");

console.log("\n=== entregar sin factura, contra un pedido ===");
const nuevoPedido = await duena("/pedidos", {
  customerId: ana.id,
  lines: [{ catalogItemId: producto.id, quantity: 400 }],
});
ok(nuevoPedido.estado === 201, "se crea un pedido", `estado ${nuevoPedido.estado} ${JSON.stringify(nuevoPedido.cuerpo).slice(0, 160)}`);
const pedido = (await duena(`/pedidos/${nuevoPedido.cuerpo.id}`)).cuerpo;
const renglonPedido = pedido.lines[0];
const dePedido = await duena("/despachos", {
  salesOrderId: pedido.id,
  receivedByName: "Maura",
  signature: IMAGEN,
  lines: [{ salesOrderLineId: renglonPedido.id, quantity: 50 }],
});
ok(dePedido.estado === 201, "se puede entregar contra un pedido, sin factura de por medio", `estado ${dePedido.estado} ${JSON.stringify(dePedido.cuerpo).slice(0, 130)}`);
p = await patio();
ok(p.existencia === 950, "y eso sí baja el patio", String(p.existencia));

console.log("\n=== cosas que no deberían pasar ===");
const vacio = await duena("/despachos", { customerId: ana.id, receivedByName: "Maura", lines: [] });
ok(vacio.estado === 400, "un despacho sin renglones no pasa", `estado ${vacio.estado}`);
const sinNombre = await duena("/despachos", {
  customerId: ana.id,
  receivedByName: "A",
  lines: [{ catalogItemId: producto.id, quantity: 1 }],
});
ok(sinNombre.estado === 400, "ni uno sin nombre de quien recibe", `estado ${sinNombre.estado}`);
const sinNadie = await duena("/despachos", {
  receivedByName: "Maura",
  lines: [{ catalogItemId: producto.id, quantity: 1 }],
});
ok(sinNadie.estado === 400, "ni uno sin cliente, factura ni pedido", `estado ${sinNadie.estado}`);
const noEsImagen = await duena("/despachos", {
  customerId: ana.id,
  receivedByName: "Maura",
  signature: "https://ejemplo.com/firma.png",
  lines: [{ catalogItemId: producto.id, quantity: 1 }],
});
ok(noEsImagen.estado === 400, "una «firma» que es una dirección de internet no pasa", `estado ${noEsImagen.estado}`);
const sinProducto = await duena("/despachos", {
  customerId: ana.id,
  receivedByName: "Maura",
  lines: [{ description: "Algo", quantity: 10 }],
});
ok(sinProducto.estado === 400, "ni un renglón que no dice qué producto se entrega", `estado ${sinProducto.estado}`);
const inventado = await duena("/despachos", {
  customerId: ana.id,
  receivedByName: "Maura",
  lines: [{ invoiceLineId: "00000000-0000-4000-8000-000000000000", quantity: 10 }],
});
ok(inventado.estado === 400, "ni uno que apunta a un renglón de factura que no existe", `estado ${inventado.estado}`);
const contraAnulada = await duena("/despachos", {
  invoiceId: obra.cuerpo.id,
  receivedByName: "Maura",
  lines: [{ catalogItemId: producto.id, quantity: 1 }],
});
ok(contraAnulada.estado === 409, "no se entrega contra una factura anulada", `estado ${contraAnulada.estado}`);

console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
