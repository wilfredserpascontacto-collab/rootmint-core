/**
 * El circulo: producir entra al inventario, y la cotizacion sabe si ya esta hecho.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-inv PORT=4400 node dist/index.js &
 *   node scripts/probar-inventario.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4400";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};

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

// La semilla de produccion trae tipos de bloque, materiales y recetas.
const tipos = (await duena("/bloques/tipos")).cuerpo ?? [];
ok(tipos.length > 0, `hay ${tipos.length} tipos de bloque de fábrica`);
const tipo = tipos[0];

console.log("\n=== el inventario arranca vacío ===");
const inv0 = await duena("/inventario");
const fila0 = inv0.cuerpo.find((x) => x.blockTypeId === tipo.id);
ok(inv0.estado === 200, "la pantalla de inventario responde");
ok(fila0?.existencia === 0, `«${tipo.name}» arranca en 0`, String(fila0?.existencia));
ok(fila0?.catalogItemId === null, "y todavía no está enlazado a ningún producto del catálogo");

console.log("\n=== producir mete bloques al patio ===");
// La semilla de fabrica trae materiales y tipos de bloque, pero no recetas:
// una receta la arma quien conoce la mezcla. Se crea una para poder producir.
const materiales = (await duena("/bloques/materiales")).cuerpo ?? [];
// La API devuelve {receta, tipoBloque}, no la receta pelada.
const respReceta = (await duena("/bloques/recetas", {
  method: "POST",
  body: JSON.stringify({
    code: "R-PRUEBA",
    name: "Mezcla de prueba",
    blockTypeId: tipo.id,
    expectedBlocksPerMix: 60,
    renglones: materiales.slice(0, 3).map((m) => ({ materialId: m.id, quantityMilli: 5000 })),
  }),
})).cuerpo;
const receta = respReceta?.receta ?? respReceta;
ok(receta?.id !== undefined, "se crea una receta para poder producir");

const lote = await duena("/bloques/lotes", {
  method: "POST",
  body: JSON.stringify({
    recipeId: receta.id,
    producedAt: new Date().toISOString(),
    mixes: 10,
    blocksGood: 600,
    blocksBroken: 30,
  }),
});
ok(lote.estado === 201, "se produce un lote de 600 buenos", `estado ${lote.estado}`);

const tipoDelLote = tipo.id;
const inv1 = await duena("/inventario");
const fila1 = inv1.cuerpo.find((x) => x.blockTypeId === tipoDelLote);
ok(fila1?.existencia === 600, "el inventario pasa a 600 solo", String(fila1?.existencia));
ok(fila1 && !inv1.cuerpo.some((x) => x.existencia === 630), "los 30 rotos NO entran: nunca fueron vendibles");

console.log("\n=== recontar mueve la diferencia, no el total ===");
const loteId = lote.cuerpo?.lote?.id ?? lote.cuerpo?.id;
await duena(`/bloques/lotes/${loteId}`, { method: "PATCH", body: JSON.stringify({ blocksGood: 597 }) });
const inv2 = await duena("/inventario");
ok(
  inv2.cuerpo.find((x) => x.blockTypeId === tipoDelLote)?.existencia === 597,
  "recontar 597 donde había 600 deja 597, no 1197",
  String(inv2.cuerpo.find((x) => x.blockTypeId === tipoDelLote)?.existencia),
);

const movs = (await duena(`/inventario/${tipoDelLote}/movimientos`)).cuerpo;
ok(movs.length === 2, "y queda como dos movimientos, no como una corrección borrada", `${movs.length} movimientos`);
ok(movs.some((m) => m.quantity === -3 && m.reason === "ajuste"), "el segundo es un ajuste de −3");

console.log("\n=== el puente entre lo que se vende y lo que se fabrica ===");
const producto = (await duena("/catalog-items", {
  method: "POST",
  body: JSON.stringify({ name: tipo.name, code: "VENTA-" + tipo.code, type: "product", unit: "unidad", unitPriceCents: 45 }),
})).cuerpo;
const enlace = await duena(`/catalog-items/${producto.id}/tipo-bloque`, {
  method: "PATCH",
  body: JSON.stringify({ blockTypeId: tipoDelLote }),
});
ok(enlace.estado === 200, "se enlaza el producto con el tipo de bloque");

const otro = (await duena("/catalog-items", {
  method: "POST",
  body: JSON.stringify({ name: "Otro bloque", code: "VENTA-OTRO", type: "product", unit: "unidad", unitPriceCents: 50 }),
})).cuerpo;
const repetido = await duena(`/catalog-items/${otro.id}/tipo-bloque`, {
  method: "PATCH",
  body: JSON.stringify({ blockTypeId: tipoDelLote }),
});
ok(repetido.estado === 409, "y no deja enlazar dos productos al mismo tipo", repetido.cuerpo?.error);

console.log("\n=== la cotización ya sabe si hace falta producir ===");
const cliente = (await duena("/customers", { method: "POST", body: JSON.stringify({ name: "Constructora", type: "company" }) })).cuerpo;

const cotChica = (await duena("/quotes", {
  method: "POST",
  body: JSON.stringify({ customerId: cliente.id, lines: [{ catalogItemId: producto.id, quantity: 400 }], taxRatePercent: 13 }),
})).cuerpo;
const qp1 = await duena(`/quotes/${cotChica.id}/que-producir`);
ok(qp1.cuerpo.lines[0].enExistencia === 597, "ve los 597 del patio");
ok(qp1.cuerpo.lines[0].hayQueProducir === 0, "y dice que no hay que producir nada para 400");
ok(
  qp1.cuerpo.avisos.some((a) => /ya está en el patio/.test(a)),
  "con el aviso que pidieron",
  qp1.cuerpo.avisos[0],
);

const cotGrande = (await duena("/quotes", {
  method: "POST",
  body: JSON.stringify({ customerId: cliente.id, lines: [{ catalogItemId: producto.id, quantity: 1000 }], taxRatePercent: 13 }),
})).cuerpo;
const qp2 = await duena(`/quotes/${cotGrande.id}/que-producir`);
ok(qp2.cuerpo.lines[0].hayQueProducir === 403, "para 1000 dice que faltan 403", String(qp2.cuerpo.lines[0].hayQueProducir));
ok(
  qp2.cuerpo.avisos.some((a) => /sólo faltan 403/.test(a)),
  "y lo explica en castellano",
  qp2.cuerpo.avisos[0],
);

console.log("\n=== lo que no es un bloque no se produce ===");
const manoDeObra = (await duena("/catalog-items", {
  method: "POST",
  body: JSON.stringify({ name: "Mano de obra", code: "MO-1", type: "service", unit: "hora", unitPriceCents: 800 }),
})).cuerpo;
const cotServicio = (await duena("/quotes", {
  method: "POST",
  body: JSON.stringify({ customerId: cliente.id, lines: [{ catalogItemId: manoDeObra.id, quantity: 8 }], taxRatePercent: 13 }),
})).cuerpo;
const qp3 = await duena(`/quotes/${cotServicio.id}/que-producir`);
ok(qp3.cuerpo.lines[0].esProducible === false, "la mano de obra no es producible");
ok(qp3.cuerpo.lines[0].sinEnlazar === false, "y no se queja de que falte enlazarla: no es un bloque");

console.log("\n=== ajustar a mano, que es lo primero que van a hacer ===");
const sinMotivo = await duena("/inventario/ajuste", {
  method: "POST",
  body: JSON.stringify({ blockTypeId: tipoDelLote, quantity: -100 }),
});
ok(sinMotivo.estado === 400, "no deja ajustar sin decir por qué");

const ajuste = await duena("/inventario/ajuste", {
  method: "POST",
  body: JSON.stringify({ blockTypeId: tipoDelLote, quantity: -97, reason: "ajuste", note: "Conteo físico del patio" }),
});
ok(ajuste.cuerpo?.existencia === 500, "ajustar −97 deja 500", String(ajuste.cuerpo?.existencia));

const negativo = await duena("/inventario/ajuste", {
  method: "POST",
  body: JSON.stringify({ blockTypeId: tipoDelLote, quantity: -600, reason: "ajuste", note: "Prueba de negativo" }),
});
ok(
  (negativo.cuerpo?.avisos ?? []).some((a) => /negativo/.test(a)),
  "y avisa cuando la existencia queda negativa",
  negativo.cuerpo?.avisos?.[0],
);

console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
