/**
 * Entradas malas contra la API corriendo.
 *
 * Lo que se busca no es que nada falle: es que cuando falle lo diga. Un 400
 * con un mensaje es un buen resultado. Un 500 es un error mío. Y lo peor de
 * todo es un 200 con una cifra equivocada, que es lo que este archivo caza.
 */
const BASE = "http://localhost:3000";
const malos = [];
const bien = [];

async function pega(metodo, ruta, cuerpo) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { "content-type": "application/json" },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
  let j = null;
  try { j = await r.json(); } catch { /* 204 */ }
  return { estado: r.status, cuerpo: j };
}

/**
 * @param espera "rechaza" (400-499), "acepta" (2xx) o una función que revisa.
 */
async function caso(nombre, metodo, ruta, cuerpo, espera) {
  const { estado, cuerpo: res } = await pega(metodo, ruta, cuerpo);
  if (estado >= 500) {
    malos.push(`${nombre} → ${estado} ${JSON.stringify(res).slice(0, 90)} (se cayó, no explicó)`);
    return res;
  }
  if (espera === "rechaza") {
    if (estado < 400) malos.push(`${nombre} → ${estado}: lo ACEPTÓ y debía rechazarlo`);
    else bien.push(`${nombre} → ${estado} ${res?.error ?? ""}`);
  } else if (espera === "acepta") {
    if (estado >= 400) malos.push(`${nombre} → ${estado} ${JSON.stringify(res).slice(0, 90)}`);
    else bien.push(`${nombre} → ${estado}`);
  } else if (typeof espera === "function") {
    const problema = espera(estado, res);
    if (problema) malos.push(`${nombre} → ${problema}`);
    else bien.push(`${nombre} → ok`);
  }
  return res;
}

const mats = await (await fetch(`${BASE}/bloques/materiales`)).json();
const tipos = await (await fetch(`${BASE}/bloques/tipos`)).json();
const recetas = await (await fetch(`${BASE}/bloques/recetas`)).json();
const lotes = await (await fetch(`${BASE}/bloques/lotes`)).json();
const unMat = mats[0].id;
const unTipo = tipos[0].id;
const unaReceta = recetas[0].id;
const unLote = lotes[0]?.id;

const FANTASMA = "00000000-0000-0000-0000-000000000000";

// --- Números que no son números ---------------------------------------------
await caso("material con precio de texto", "POST", "/bloques/materiales",
  { code: `x${Date.now()}`, name: "X", purchaseUnit: "u", purchasePriceCents: "mucho" }, "rechaza");
await caso("material con precio negativo", "POST", "/bloques/materiales",
  { code: `y${Date.now()}`, name: "Y", purchaseUnit: "u", purchasePriceCents: -500 }, "rechaza");
await caso("material con precio decimal en centavos", "POST", "/bloques/materiales",
  { code: `z${Date.now()}`, name: "Z", purchaseUnit: "u", purchasePriceCents: 10.5 }, "rechaza");
await caso("material sin nombre", "POST", "/bloques/materiales",
  { code: `w${Date.now()}`, name: "", purchaseUnit: "u" }, "rechaza");
await caso("material con equivalencia cero", "POST", "/bloques/materiales",
  { code: `v${Date.now()}`, name: "V", purchaseUnit: "u", contentPerPurchaseMilli: 0 }, "rechaza");

// --- Recetas -----------------------------------------------------------------
await caso("receta sin renglones", "POST", "/bloques/recetas",
  { code: `R${Date.now()}`, name: "R", blockTypeId: unTipo, expectedBlocksPerMix: 60, renglones: [] }, "rechaza");
await caso("receta con cero bloques por mezcla", "POST", "/bloques/recetas",
  { code: `R2${Date.now()}`, name: "R2", blockTypeId: unTipo, expectedBlocksPerMix: 0,
    renglones: [{ materialId: unMat, quantityMilli: 1000 }] }, "rechaza");
await caso("receta con bloques por mezcla decimal", "POST", "/bloques/recetas",
  { code: `R3${Date.now()}`, name: "R3", blockTypeId: unTipo, expectedBlocksPerMix: 59.5,
    renglones: [{ materialId: unMat, quantityMilli: 1000 }] }, "rechaza");
await caso("receta con material inexistente", "POST", "/bloques/recetas",
  { code: `R4${Date.now()}`, name: "R4", blockTypeId: unTipo, expectedBlocksPerMix: 60,
    renglones: [{ materialId: FANTASMA, quantityMilli: 1000 }] }, "rechaza");
await caso("receta con tipo de bloque inexistente", "POST", "/bloques/recetas",
  { code: `R5${Date.now()}`, name: "R5", blockTypeId: FANTASMA, expectedBlocksPerMix: 60,
    renglones: [{ materialId: unMat, quantityMilli: 1000 }] }, "rechaza");
await caso("receta con id que no es uuid", "GET", "/bloques/recetas/pepito", undefined, "rechaza");

// --- Lotes -------------------------------------------------------------------
await caso("lote con receta inexistente", "POST", "/bloques/lotes",
  { recipeId: FANTASMA, mixes: 1, blocksGood: 10, blocksBroken: 0 }, "rechaza");
await caso("lote con cero mezclas", "POST", "/bloques/lotes",
  { recipeId: unaReceta, mixes: 0, blocksGood: 10, blocksBroken: 0 }, "rechaza");
await caso("lote con mezclas negativas", "POST", "/bloques/lotes",
  { recipeId: unaReceta, mixes: -3, blocksGood: 10, blocksBroken: 0 }, "rechaza");
await caso("lote con bloques negativos", "POST", "/bloques/lotes",
  { recipeId: unaReceta, mixes: 1, blocksGood: -10, blocksBroken: 0 }, "rechaza");
await caso("lote con mezclas gigantescas", "POST", "/bloques/lotes",
  { recipeId: unaReceta, mixes: 999_999_999_999, blocksGood: 1, blocksBroken: 0 }, "rechaza");
await caso("ficha de un lote inexistente", "GET", `/bloques/lotes/${FANTASMA}/ficha`, undefined, "rechaza");

/**
 * Cero bloques buenos y cero rotos: la mezcla se hizo y no salió nada.
 * Puede pasar de verdad. Lo que NO puede es que la ficha divida entre cero.
 */
const vacio = await caso("lote sin un solo bloque", "POST", "/bloques/lotes",
  { recipeId: unaReceta, mixes: 1, blocksGood: 0, blocksBroken: 0 },
  (estado, res) => {
    if (estado >= 400) return null; // rechazarlo también es una respuesta válida
    const r = res?.real;
    if (!r) return "aceptó pero no devolvió la ficha";
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === "number" && !Number.isFinite(v)) return `${k} salió ${v}`;
    }
    if (res.perdidaRotosCents !== 0) return `pérdida por rotos = ${res.perdidaRotosCents} sin rotos`;
    return null;
  });

// --- Ensayos -----------------------------------------------------------------
if (unLote) {
  await caso("ensayo sin criterio de área", "POST", `/bloques/lotes/${unLote}/ensayos`,
    { ageDays: 28, specimens: 3, strengthMpaMilli: 14000 }, "rechaza");
  await caso("ensayo con resistencia cero", "POST", `/bloques/lotes/${unLote}/ensayos`,
    { ageDays: 28, specimens: 3, strengthMpaMilli: 0, basis: "net" }, "rechaza");
  await caso("ensayo con resistencia negativa", "POST", `/bloques/lotes/${unLote}/ensayos`,
    { ageDays: 28, specimens: 3, strengthMpaMilli: -14000, basis: "net" }, "rechaza");
  await caso("ensayo a cero días", "POST", `/bloques/lotes/${unLote}/ensayos`,
    { ageDays: 0, specimens: 3, strengthMpaMilli: 14000, basis: "net" }, "rechaza");
  await caso("ensayo con criterio inventado", "POST", `/bloques/lotes/${unLote}/ensayos`,
    { ageDays: 28, specimens: 3, strengthMpaMilli: 14000, basis: "diagonal" }, "rechaza");
  await caso("ensayo en lote inexistente", "POST", `/bloques/lotes/${FANTASMA}/ensayos`,
    { ageDays: 28, specimens: 3, strengthMpaMilli: 14000, basis: "net" }, "rechaza");
}

// --- Mantenimiento -----------------------------------------------------------
await caso("tarea sin intervalo", "POST", "/bloques/mantenimiento/tareas",
  { code: `t${Date.now()}`, name: "T" }, "rechaza");
await caso("tarea por mezclas Y por lotes", "POST", "/bloques/mantenimiento/tareas",
  { code: `t2${Date.now()}`, name: "T2", everyMixes: 10, everyBatches: 5 }, "rechaza");
await caso("tarea con intervalo cero", "POST", "/bloques/mantenimiento/tareas",
  { code: `t3${Date.now()}`, name: "T3", everyMixes: 0 }, "rechaza");
await caso("tarea con puesto inexistente", "POST", "/bloques/mantenimiento/tareas",
  { code: `t4${Date.now()}`, name: "T4", everyMixes: 10, roleId: FANTASMA }, "rechaza");
await caso("marcar hecha una tarea inexistente", "POST",
  `/bloques/mantenimiento/tareas/${FANTASMA}/hecha`, {}, "rechaza");

// --- Ajustes -----------------------------------------------------------------
await caso("rango con mínimo mayor que el máximo", "PUT", "/bloques/ajustes/rango.cemento_agregado",
  { min: 20, max: 5 }, "rechaza");
await caso("rango con texto", "PUT", "/bloques/ajustes/rango.cemento_agregado",
  { min: "poco", max: "mucho" }, "rechaza");
await caso("ajuste que no existe", "PUT", "/bloques/ajustes/rango.inventado",
  { min: 1, max: 2 }, "rechaza");

// --- Reinicio ----------------------------------------------------------------
await caso("reiniciar sin la palabra", "POST", "/bloques/reiniciar-produccion", {}, "rechaza");
await caso("reiniciar con la palabra en minúscula", "POST", "/bloques/reiniciar-produccion",
  { confirmacion: "borrar" }, "rechaza");

// --- Cuerpos rotos -----------------------------------------------------------
const roto = await fetch(`${BASE}/bloques/materiales`, {
  method: "POST", headers: { "content-type": "application/json" }, body: "{esto no es json",
});
if (roto.status >= 500) malos.push(`json roto → ${roto.status} (se cayó)`);
else bien.push(`json roto → ${roto.status}`);

console.log(`=== ${bien.length} casos se comportaron bien ===`);
bien.forEach((s) => console.log("  ✓", s));
console.log(`\n=== ${malos.length} PROBLEMA(S) ===`);
malos.forEach((s) => console.log("  ✗", s));
process.exit(malos.length ? 1 : 0);
