/**
 * El almacen de materia prima: comprar, recibir, consumir y contar.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-alm PORT=4460 node dist/index.js &
 *   BASE=http://127.0.0.1:4460 node scripts/probar-almacen.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4460";
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

// --- Materiales propios, con unidades de compra distintas a las de dosificar --------
const unidades = (await duena("/bloques/unidades")).cuerpo;
const kg = unidades.find((u) => u.abbreviation === "kg");
const carretilla = unidades.find((u) => u.abbreviation === "carretilla");
const cemento = (
  await duena("/bloques/materiales", {
    code: "ALM-CEM", name: "Cemento de prueba", purchaseUnit: "bolsa", purchasePriceCents: 900,
    dosingUnitId: kg.id, contentPerPurchaseMilli: 42500,
  })
).cuerpo;
const arena = (
  await duena("/bloques/materiales", {
    code: "ALM-ARE", name: "Arena de prueba", purchaseUnit: "m3", purchasePriceCents: 2500,
    dosingUnitId: carretilla.id, contentPerPurchaseMilli: 15000,
  })
).cuerpo;

const stock = async () => {
  const r = (await duena("/bloques/almacen/materiales")).cuerpo;
  const por = (id) => r.materiales.find((m) => m.materialId === id);
  return { r, cem: por(cemento.id), are: por(arena.id) };
};

console.log("\n=== el almacén arranca en cero ===");
let s = await stock();
ok(s.cem.existenciaMilli === 0 && s.are.existenciaMilli === 0, "no hay nada: el sistema no inventa existencias");
ok(s.cem.ultimoCostoUnidadCents === null, "y no tiene costo: nunca se compró por el sistema");
ok(s.cem.unidad === "kg" && s.are.unidad === "carretilla", "cada material habla en su unidad de dosificación");

console.log("\n=== proveedores ===");
const malCorreo = await duena("/bloques/proveedores", { name: "X", email: "no-es-correo" });
ok(malCorreo.estado === 400, "un correo mal escrito se rechaza", `estado ${malCorreo.estado}`);
const sinNombre = await duena("/bloques/proveedores", { name: "  " });
ok(sinNombre.estado === 400, "un proveedor sin nombre se rechaza");
const prov = (await duena("/bloques/proveedores", { name: "Cementos del Norte", nit: "0614-000000-000-0", phone: "2222-0000" })).cuerpo;
ok(Boolean(prov?.id), "se da de alta un proveedor");
const inactivo = (await duena("/bloques/proveedores", { name: "Ferretería vieja" })).cuerpo;
await duena(`/bloques/proveedores/${inactivo.id}`, { active: false }, "PATCH");
const lista = (await duena("/bloques/proveedores")).cuerpo;
ok(lista.length === 2 && lista.find((p) => p.id === inactivo.id)?.active === false, "y se puede inactivar sin borrarlo");

console.log("\n=== pedir una compra no mete nada al almacén ===");
const vacia = await duena("/bloques/compras", { supplierId: prov.id, lines: [] });
ok(vacia.estado === 400, "una compra sin materiales se rechaza");
const aInactivo = await duena("/bloques/compras", {
  supplierId: inactivo.id, lines: [{ materialId: cemento.id, quantityMilli: 1000 }],
});
ok(aInactivo.estado === 409, "no se le compra a un proveedor inactivo", `estado ${aInactivo.estado}`);
const negativa = await duena("/bloques/compras", {
  supplierId: prov.id, lines: [{ materialId: cemento.id, quantityMilli: -5 }],
});
ok(negativa.estado === 400, "una cantidad negativa se rechaza");

const compra = await duena("/bloques/compras", {
  supplierId: prov.id,
  documentRef: "PED-77",
  lines: [
    { materialId: cemento.id, quantityMilli: 100000 }, // 100 bolsas, al precio del catálogo ($9.00)
    { materialId: arena.id, quantityMilli: 10000, unitCostCents: 2600 }, // 10 m3 a $26.00
  ],
});
ok(compra.estado === 201, "se pide una compra de 100 bolsas y 10 m³", `estado ${compra.estado}`);
const c = compra.cuerpo;
ok(c.number === 1 && c.estado === "pendiente", "es la compra N° 1 y está pendiente");
ok(c.totalCents === 116000, "vale $1,160.00 (100 × $9.00 + 10 × $26.00)", String(c.totalCents));
ok(c.lines[0].unitCostCents === 900, "el precio sale del catálogo si no se dice otro");
s = await stock();
ok(s.cem.existenciaMilli === 0, "el almacén sigue en cero: pedir no es recibir");
ok(s.cem.porRecibirMilli === 4_250_000, "pero sabe que vienen 4,250 kg de cemento", String(s.cem.porRecibirMilli));
ok(s.are.porRecibirMilli === 150_000, "y 150 carretillas de arena (10 m³ × 15)", String(s.are.porRecibirMilli));

console.log("\n=== recibir por partes ===");
const lc = c.lines.find((l) => l.materialId === cemento.id);
const la = c.lines.find((l) => l.materialId === arena.id);
const sinRenglones = await duena(`/bloques/compras/${c.id}/recepciones`, { lines: [] });
ok(sinRenglones.estado === 400, "una recepción vacía se rechaza");
const ajena = await duena(`/bloques/compras/${c.id}/recepciones`, {
  lines: [{ purchaseLineId: "00000000-0000-4000-8000-000000000000", quantityMilli: 1000 }],
});
ok(ajena.estado === 400, "un renglón que no es de esta compra se rechaza", `estado ${ajena.estado}`);

const r1 = await duena(`/bloques/compras/${c.id}/recepciones`, {
  documentRef: "REM-001", lines: [{ purchaseLineId: lc.id, quantityMilli: 40000 }],
});
ok(r1.estado === 201, "llegan 40 bolsas", `estado ${r1.estado}`);
ok(r1.cuerpo.estado === "parcial", "la compra queda parcial");
s = await stock();
ok(s.cem.existenciaMilli === 1_700_000, "entran 1,700 kg: 40 bolsas × 42.5 kg", String(s.cem.existenciaMilli));
ok(s.cem.porRecibirMilli === 2_550_000, "y todavía faltan por llegar 2,550 kg", String(s.cem.porRecibirMilli));
ok(r1.cuerpo.recibidoCents === 36000, "se recibieron $360.00 de los $1,160.00", String(r1.cuerpo.recibidoCents));

const r2 = await duena(`/bloques/compras/${c.id}/recepciones`, {
  lines: [
    { purchaseLineId: lc.id, quantityMilli: 60000, unitCostCents: 950 },
    { purchaseLineId: la.id, quantityMilli: 10000 },
  ],
});
ok(r2.estado === 201 && r2.cuerpo.estado === "completa", "llegan las 60 bolsas restantes y la arena: compra completa");
ok(r2.cuerpo.avisos.some((a) => /se pidió a \$9\.00.*llegó a \$9\.50/.test(a)), "avisa que el cemento llegó a otro precio", r2.cuerpo.avisos.join(" | "));
ok(r2.cuerpo.avisos.some((a) => /quedó completa/.test(a)), "y que la compra quedó completa");
s = await stock();
ok(s.cem.existenciaMilli === 4_250_000, "hay 4,250 kg de cemento", String(s.cem.existenciaMilli));
ok(s.are.existenciaMilli === 150_000, "y 150 carretillas de arena", String(s.are.existenciaMilli));
ok(s.cem.porRecibirMilli === 0, "ya no hay nada por recibir");

const demas = await duena(`/bloques/compras/${c.id}/recepciones`, {
  lines: [{ purchaseLineId: lc.id, quantityMilli: 5000 }],
});
ok(demas.estado === 201 && demas.cuerpo.avisos.some((a) => /llegó de más/.test(a)), "si llega de más se anota y se avisa", demas.cuerpo.avisos.join(" | "));
s = await stock();
ok(s.cem.existenciaMilli === 4_462_500, "el almacén sube a 4,462.5 kg", String(s.cem.existenciaMilli));

console.log("\n=== el costo y el valor ===");
ok(Math.abs(s.cem.ultimoCostoUnidadCents - 4500 / 212.5) < 0.01, "el último costo sale de la última recepción: $0.2118 por kg", String(s.cem.ultimoCostoUnidadCents));
ok(s.cem.valorCents === 94500, "el cemento vale $945.00 a último costo", String(s.cem.valorCents));
ok(s.r.totales.valorCents === s.cem.valorCents + s.are.valorCents, "el total suma lo valorado");
const movs = (await duena(`/bloques/almacen/materiales/${cemento.id}/movimientos`)).cuerpo;
ok(movs.length === 3 && movs.every((m) => m.reason === "compra" && m.refType === "purchase_receipt"), "cada entrada quedó como movimiento ligado a su recepción", `${movs.length}`);

console.log("\n=== producir un lote descuenta lo que usó ===");
const tipo = (await duena("/bloques/tipos")).cuerpo[0];
const receta = (
  await duena("/bloques/recetas", {
    code: "R-ALM", name: "Mezcla del almacén", blockTypeId: tipo.id, expectedBlocksPerMix: 60,
    renglones: [
      { materialId: cemento.id, quantityMilli: 5000 },
      { materialId: arena.id, quantityMilli: 2000 },
    ],
  })
).cuerpo;
const recetaId = (receta.receta ?? receta).id;
const lote1 = await duena("/bloques/lotes", { recipeId: recetaId, mixes: 10, blocksGood: 590, blocksBroken: 10 });
ok(lote1.estado === 201, "se produce un lote de 10 mezclas", `estado ${lote1.estado}`);
s = await stock();
ok(s.cem.existenciaMilli === 4_412_500, "el cemento baja 50 kg: 10 mezclas × 5 kg", String(s.cem.existenciaMilli));
ok(s.are.existenciaMilli === 130_000, "la arena baja 20 carretillas", String(s.are.existenciaMilli));
const movs2 = (await duena(`/bloques/almacen/materiales/${cemento.id}/movimientos`)).cuerpo;
const consumo = movs2.find((m) => m.reason === "consumo");
ok(consumo?.quantityMilli === -50_000 && consumo.refType === "batch", "queda un movimiento de consumo ligado al lote", String(consumo?.quantityMilli));
ok(!(lote1.cuerpo.avisos ?? []).some((a) => /almacén/.test(a)), "y no avisa nada: había de sobra");

const lote2 = await duena("/bloques/lotes", { recipeId: recetaId, mixes: 70, blocksGood: 4000, blocksBroken: 100 });
ok(lote2.estado === 201, "un lote que se pasa de lo que hay SÍ se registra: el bloque ya se hizo");
ok(
  (lote2.cuerpo.avisos ?? []).some((a) => /Arena de prueba.*quedó en -10/.test(a)),
  "pero avisa que la arena quedó en −10 carretillas",
  (lote2.cuerpo.avisos ?? []).join(" | "),
);
s = await stock();
ok(s.are.existenciaMilli === -10_000, "y el almacén lo muestra en negativo, a la vista", String(s.are.existenciaMilli));
ok(s.r.totales.negativos === 1, "el resumen cuenta 1 material en negativo");

console.log("\n=== ajustes a mano ===");
const sinMotivo = await duena("/bloques/almacen/ajuste", { materialId: arena.id, quantityMilli: 10000 });
ok(sinMotivo.estado === 400, "no deja ajustar sin decir por qué");
const mermaPositiva = await duena("/bloques/almacen/ajuste", { materialId: arena.id, quantityMilli: 1000, reason: "merma", note: "Se cayó" });
ok(mermaPositiva.estado === 400, "una merma positiva no tiene sentido y se rechaza");
const merma = await duena("/bloques/almacen/ajuste", { materialId: cemento.id, quantityMilli: -2500, reason: "merma", note: "Una bolsa se rompió" });
ok(merma.cuerpo?.existenciaMilli === 4_412_500 - 350_000 - 2_500, "una merma de 2.5 kg baja la existencia", String(merma.cuerpo?.existenciaMilli));
const ajusteArena = await duena("/bloques/almacen/ajuste", { materialId: arena.id, quantityMilli: 10000, note: "Se olvidó anotar una compra" });
ok(ajusteArena.cuerpo?.existenciaMilli === 0 && ajusteArena.cuerpo.avisos.length === 0, "ajustar +10 deja la arena en cero, sin avisos");

console.log("\n=== el mínimo para comprar ===");
await duena(`/bloques/almacen/materiales/${cemento.id}/minimo`, { minStockMilli: 5_000_000 }, "PATCH");
s = await stock();
ok(s.cem.bajoMinimo === true && s.r.totales.bajoMinimo === 1, "con un mínimo de 5,000 kg el cemento figura bajo mínimo");
await duena(`/bloques/almacen/materiales/${cemento.id}/minimo`, { minStockMilli: null }, "PATCH");
s = await stock();
ok(s.cem.bajoMinimo === false && s.cem.minStockMilli === null, "y sin mínimo no hay alerta: nulo no es cero");

console.log("\n=== anular una recepción ===");
const antes = (await stock()).cem.existenciaMilli;
const rec1 = r1.cuerpo.receipts[0];
const sinMotivoRec = await duena(`/bloques/recepciones/${rec1.id}/anular`, {});
ok(sinMotivoRec.estado === 400, "no se anula sin motivo");
const anulaRec = await duena(`/bloques/recepciones/${rec1.id}/anular`, { reason: "Se anotó en la compra equivocada" });
ok(anulaRec.estado === 200, "se anula la primera recepción (40 bolsas)", `estado ${anulaRec.estado}`);
ok((await stock()).cem.existenciaMilli === antes - 1_700_000, "salen del almacén los 1,700 kg", String((await stock()).cem.existenciaMilli - antes));
ok(anulaRec.cuerpo.estado === "parcial", "la compra vuelve a quedar parcial: faltan esas 40 bolsas", anulaRec.cuerpo.estado);
const dobleAnula = await duena(`/bloques/recepciones/${rec1.id}/anular`, { reason: "Otra vez" });
ok(dobleAnula.estado === 409, "no se anula dos veces", `estado ${dobleAnula.estado}`);
ok((await stock()).cem.existenciaMilli === antes - 1_700_000, "y no sale dos veces");

console.log("\n=== cancelar compras ===");
const c2 = (await duena("/bloques/compras", { supplierId: prov.id, lines: [{ materialId: arena.id, quantityMilli: 5000 }] })).cuerpo;
const canc = await duena(`/bloques/compras/${c2.id}/cancelar`, { reason: "El proveedor no tenía" });
ok(canc.estado === 200 && canc.cuerpo.estado === "cancelada", "una compra sin recibir se cancela");
const sobreCancelada = await duena(`/bloques/compras/${c2.id}/recepciones`, {
  lines: [{ purchaseLineId: c2.lines[0].id, quantityMilli: 1000 }],
});
ok(sobreCancelada.estado === 409, "a una cancelada no se le anotan recepciones", `estado ${sobreCancelada.estado}`);
const cancelaOtra = await duena(`/bloques/compras/${c2.id}/cancelar`, { reason: "De nuevo" });
ok(cancelaOtra.estado === 409, "y no se cancela dos veces");
const cerrada = await duena(`/bloques/compras/${c.id}/cancelar`, { reason: "Ya no vamos a esperar las 40 bolsas" });
ok(cerrada.cuerpo?.estado === "cerrada", "una compra a medias que se cancela queda «cerrada»", cerrada.cuerpo?.estado);
ok(cerrada.cuerpo?.avisos?.some((a) => /se queda en el almacén/.test(a)), "y avisa que lo recibido se queda");
const lista2 = (await duena("/bloques/compras")).cuerpo;
ok(lista2.length === 2 && lista2.find((x) => x.id === c2.id).estado === "cancelada", "el listado muestra el estado de cada una");

console.log("\n=== el conteo físico ===");
const conteo = await duena("/bloques/conteos", { notes: "Conteo de fin de mes" });
ok(conteo.estado === 201 && conteo.cuerpo.status === "abierto", "se abre un conteo");
ok(conteo.cuerpo.lines.length >= 2, "con todos los materiales del catálogo", String(conteo.cuerpo.lines.length));
const otro = await duena("/bloques/conteos", {});
ok(otro.estado === 409, "no deja abrir otro mientras hay uno abierto", otro.cuerpo?.error);

const lcem = conteo.cuerpo.lines.find((l) => l.materialId === cemento.id);
const lare = conteo.cuerpo.lines.find((l) => l.materialId === arena.id);
ok(lcem.expectedMilli === (await stock()).cem.existenciaMilli, "congela lo que el sistema creía que había");
ok(lcem.countedMilli === null, "y nada está contado todavía");
const vacio = await duena(`/bloques/conteos/${conteo.cuerpo.id}/aprobar`, {});
ok(vacio.estado === 409, "no se aprueba un conteo sin contar nada", `estado ${vacio.estado}`);

const negativoContado = await duena(`/bloques/conteos/${conteo.cuerpo.id}/lineas`, { lines: [{ id: lcem.id, countedMilli: -5 }] }, "PATCH");
ok(negativoContado.estado === 400, "lo contado no puede ser negativo");
const esperado = lcem.expectedMilli;
await duena(`/bloques/conteos/${conteo.cuerpo.id}/lineas`, {
  lines: [{ id: lcem.id, countedMilli: esperado - 20_000, note: "Faltan 20 kg" }, { id: lare.id, countedMilli: 0 }],
}, "PATCH");
const parcial = (await duena(`/bloques/conteos/${conteo.cuerpo.id}`)).cuerpo;
const pc = parcial.lines.find((l) => l.materialId === cemento.id);
ok(pc.countedMilli === esperado - 20_000 && pc.diferenciaMilli === -20_000, "se guarda lo contado y se ve la diferencia: −20 kg");
ok(parcial.lines.find((l) => l.materialId === arena.id).countedMilli === 0, "contar cero es un conteo válido: «no hay nada»");

// Entra algo mientras se cuenta: no se debe pisar.
const rLate = await duena(`/bloques/compras`, { supplierId: prov.id, lines: [{ materialId: cemento.id, quantityMilli: 10000 }] });
await duena(`/bloques/compras/${rLate.cuerpo.id}/recepciones`, { lines: [{ purchaseLineId: rLate.cuerpo.lines[0].id, quantityMilli: 10000 }] });
const conMovimiento = (await duena(`/bloques/conteos/${conteo.cuerpo.id}`)).cuerpo.lines.find((l) => l.materialId === cemento.id);
ok(conMovimiento.movimientoDesdeElCorteMilli === 425_000, "avisa que desde el corte entraron 425 kg (10 bolsas)", String(conMovimiento.movimientoDesdeElCorteMilli));

const noDuena = await personal(`/bloques/conteos/${conteo.cuerpo.id}/aprobar`, {});
ok(noDuena.estado === 403, "el personal NO puede aprobar un conteo", `estado ${noDuena.estado}`);
const soloLee = await consulta(`/bloques/compras`, { supplierId: prov.id, lines: [{ materialId: cemento.id, quantityMilli: 1000 }] });
ok(soloLee.estado === 403, "y quien solo consulta no puede comprar", `estado ${soloLee.estado}`);
const personalCompra = await personal(`/bloques/compras`, { supplierId: prov.id, lines: [{ materialId: arena.id, quantityMilli: 1000 }] });
ok(personalCompra.estado === 201, "pero el personal sí puede pedir compras");

const antesAprobar = (await stock()).cem.existenciaMilli;
const aprueba = await duena(`/bloques/conteos/${conteo.cuerpo.id}/aprobar`, {});
ok(aprueba.estado === 200 && aprueba.cuerpo.status === "aprobado", "la dueña aprueba el conteo", `estado ${aprueba.estado}`);
ok((await stock()).cem.existenciaMilli === antesAprobar - 20_000, "se ajusta solo la diferencia (−20 kg) y se conservan los 425 kg que entraron", String((await stock()).cem.existenciaMilli - antesAprobar));
ok(aprueba.cuerpo.ajustes.length === 1 || aprueba.cuerpo.ajustes.length === 2, "queda registrado qué se ajustó");
const movsConteo = (await duena(`/bloques/almacen/materiales/${cemento.id}/movimientos`)).cuerpo.find((m) => m.refType === "material_count");
ok(movsConteo?.reason === "ajuste" && /Conteo físico N° 1/.test(movsConteo.note), "el ajuste dice de qué conteo salió", movsConteo?.note);
ok(aprueba.cuerpo.avisos.some((a) => /aprobado/.test(a)), "y avisa en castellano");
const reaprueba = await duena(`/bloques/conteos/${conteo.cuerpo.id}/aprobar`, {});
ok(reaprueba.estado === 409, "un conteo aprobado no se aprueba otra vez", `estado ${reaprueba.estado}`);
ok((await stock()).cem.existenciaMilli === antesAprobar - 20_000, "y por eso no se ajusta dos veces");
const cambiaCerrado = await duena(`/bloques/conteos/${conteo.cuerpo.id}/lineas`, { lines: [{ id: lcem.id, countedMilli: 1 }] }, "PATCH");
ok(cambiaCerrado.estado === 409, "tampoco se pueden cambiar las cantidades de un conteo cerrado");

const conteo2 = (await duena("/bloques/conteos", {})).cuerpo;
const canc2 = await duena(`/bloques/conteos/${conteo2.id}/cancelar`, { reason: "Se abrió por error" });
ok(canc2.cuerpo?.status === "cancelado", "un conteo abierto por error se cancela con su motivo");
const lConteos = (await duena("/bloques/conteos")).cuerpo;
ok(lConteos.length === 2 && lConteos[0].number === 2, "el listado trae los dos, el más nuevo primero");

console.log("\n=== reiniciar la producción también limpia sus movimientos ===");
const inv = async () => (await duena("/inventario")).cuerpo.find((x) => x.blockTypeId === tipo.id)?.existencia;
ok((await inv()) > 0, "antes de reiniciar el patio tiene bloques de los lotes", String(await inv()));
await duena("/bloques/reiniciar-produccion", { confirmacion: "BORRAR" });
const movs3 = (await duena(`/bloques/almacen/materiales/${cemento.id}/movimientos`)).cuerpo;
ok(!movs3.some((m) => m.reason === "consumo"), "el consumo de esos lotes se fue con ellos");
ok(movs3.some((m) => m.reason === "compra"), "pero las compras siguen: no eran del lote");
ok((await inv()) === 0, "y el patio dejó de mostrar bloques de lotes que ya no existen", String(await inv()));

console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
