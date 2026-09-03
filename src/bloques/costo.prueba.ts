import { costoTeoricoPorBloque, resultadoDeLote, fichaDeLote, money, mpa,
         type Material, type Receta, type Lote } from "./costo.js";

// Precios de EJEMPLO. En el sistema los pone el cliente y son editables.
const materiales: Material[] = [
  { id: "cemento", nombre: "Cemento gris",  precioCompraCents: 1050, contenidoPorCompraMilli:   1_000 }, // $10.50 la bolsa, 1 bolsa
  { id: "arena",   nombre: "Arena",         precioCompraCents: 2800, contenidoPorCompraMilli:  15_385 }, // $28 el m3 = 15.385 carretillas
  { id: "grava",   nombre: "Grava",         precioCompraCents: 3200, contenidoPorCompraMilli:  15_385 },
  { id: "agua",    nombre: "Agua",          precioCompraCents:  150, contenidoPorCompraMilli: 1_000_000 }, // $1.50 el m3 = 1000 L
];

const receta: Receta = {
  id: "r1", nombre: "Bloque 15 — mezcla estandar", estado: "validada",
  bloquesPorMezclaEsperados: 60,
  renglones: [
    { materialId: "cemento", cantidadMilli:  1_000 },  // 1 bolsa
    { materialId: "arena",   cantidadMilli:  4_000 },  // 4 carretillas
    { materialId: "grava",   cantidadMilli:  3_000 },  // 3 carretillas
    { materialId: "agua",    cantidadMilli: 45_000 },  // 45 litros
  ],
};

const t = costoTeoricoPorBloque(receta, materiales);
console.log("=== Costo teorico de una mezcla ===");
for (const r of t.renglones) console.log(`  ${r.nombre.padEnd(14)} ${money(r.costoCents)}`);
console.log(`  ${"TOTAL MEZCLA".padEnd(14)} ${money(t.totalCents)}`);
console.log(`  ${t.bloquesPorMezcla} bloques  ->  ${money(t.costoPorBloqueCents)} por bloque\n`);

console.log("=== Lo que de verdad paso en tres lotes ===");
const lotes: Lote[] = [
  { id: "l1", numero: 1, recetaId: "r1", mezclas: 10, bloquesBuenos: 592, bloquesRotos:   8, costoMaterialCents: t.totalCents * 10 },
  { id: "l2", numero: 2, recetaId: "r1", mezclas: 10, bloquesBuenos: 540, bloquesRotos:  35, costoMaterialCents: t.totalCents * 10 },
  { id: "l3", numero: 3, recetaId: "r1", mezclas: 10, bloquesBuenos: 470, bloquesRotos: 105, costoMaterialCents: t.totalCents * 10 },
];
for (const l of lotes) {
  const r = resultadoDeLote(l, receta);
  const brecha = r.costoRealPorBloqueCents - t.costoPorBloqueCents;
  console.log(`  Lote ${l.numero}: ${String(r.bloquesBuenos).padStart(3)} buenos de ${r.bloquesEsperados} esperados` +
    `  | rendimiento ${String(r.rendimientoPct).padStart(5)}%  desperdicio ${String(r.desperdicioPct).padStart(4)}%` +
    `  | real ${money(r.costoRealPorBloqueCents)} vs teorico ${money(t.costoPorBloqueCents)}  (+${money(brecha)})`);
}

console.log("\n=== La ficha completa: costo y resistencia juntos ===");
const casos = [
  { nombre: "con ensayo que cumple",     ensayo: { loteId:"l1", edadDias:28, resistenciaMpaMilli:14_200, criterio:"neta" as const } },
  { nombre: "con ensayo que NO cumple",  ensayo: { loteId:"l1", edadDias:28, resistenciaMpaMilli:11_800, criterio:"neta" as const } },
  { nombre: "ensayo en area bruta",      ensayo: { loteId:"l1", edadDias:28, resistenciaMpaMilli: 8_100, criterio:"bruta" as const } },
  { nombre: "sin ensayo",                ensayo: null },
];
for (const c of casos) {
  const f = fichaDeLote(lotes[0]!, receta, materiales, c.ensayo, 13_800, "neta");
  const q: any = f.calidad;
  const detalle = q.estado === "cumple" || q.estado === "no cumple"
    ? `${mpa(q.resistenciaMpaMilli)} contra objetivo ${mpa(q.objetivoMpaMilli)}`
    : q.detalle;
  console.log(`  ${c.nombre.padEnd(26)} costo ${money(f.real.costoRealPorBloqueCents)}  |  calidad: ${q.estado.toUpperCase()} — ${detalle}`);
}

console.log("\n=== Material borrado del catalogo ===");
const f = costoTeoricoPorBloque(receta, materiales.filter(m => m.id !== "grava"));
console.log(`  costo por bloque ${money(f.costoPorBloqueCents)}  | faltantes: ${f.faltantes.join(", ")}  | confiable: ${f.confiable}`);
console.log("  ^ sin la grava el bloque parece mas barato. Por eso se avisa en vez de callar.");

// ---------------------------------------------------------------------------
// Regresion: un precio en CERO hace el mismo daño que un material ausente.
// Medido el 3 de septiembre de 2026 contra la API: quitarle el precio a la
// grava bajaba el costo de $0.40 a $0.30 —25% menos— y "confiable" seguia
// diciendo true. Un cero es "todavia no lo cargue", nunca "es gratis".
console.log("\n=== Material con precio en cero ===");
const sinPrecio = materiales.map(m => m.id === "grava" ? { ...m, precioCompraCents: 0 } : m);
const z = costoTeoricoPorBloque(receta, sinPrecio);
console.log(`  costo por bloque ${money(z.costoPorBloqueCents)}  | sin precio: ${z.sinPrecio.join(", ") || "ninguno"}  | confiable: ${z.confiable}`);
if (z.confiable) { console.error("  *** FALLO: un renglon en cero no puede pasar como confiable ***"); process.exitCode = 1; }
else console.log("  ^ el costo baja igual, pero el sistema ya no lo da por bueno.");
