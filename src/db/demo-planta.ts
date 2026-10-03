/**
 * Una jornada de planta con datos INVENTADOS, para ver el sistema funcionando
 * antes de tener la máquina delante.
 *
 *   node dist/db/demo-planta.js            carga los datos de ejemplo
 *   node dist/db/demo-planta.js --quitar   los borra otra vez
 *
 * Se carga por las mismas rutas que usa la pantalla, como si la dueña hubiera
 * hecho todo a mano: así lo que queda en el almacén, el patio, las órdenes y
 * el mantenimiento es exactamente lo que dejaría la planta de verdad.
 *
 * Todo lo que se crea lleva la marca «(demo)» o «Datos de ejemplo» para poder
 * reconocerlo y quitarlo sin tocar nada real. Se niega a cargarse si ya hay
 * lotes de verdad: los datos de ejemplo nunca se mezclan con los reales.
 *
 * Los PRECIOS de los materiales sí se quedan después de quitar el ejemplo
 * (son lo primero que hay que poner de todos modos). Se cambian en Catálogo.
 */

import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, pool } from "./client.js";
import { sessions, users, counters, inventoryMoves } from "./schema.js";
import {
  batches,
  batchLines,
  tests,
  recipes,
  recipeLines,
  productionOrders,
  productionOrderLines,
  maintenanceLogs,
  suppliers,
  purchases,
  purchaseLines,
  purchaseReceipts,
  purchaseReceiptLines,
  materialMoves,
} from "./schema-bloques.js";
import { buildServer } from "../server.js";
import { COOKIE } from "../lib/auth.js";

const NOTA = "Datos de ejemplo";
const CLIENTE = "Constructora Ejemplo (demo)";
const PROVEEDOR = "Materiales del Norte (demo)";

const dias = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// --- Quitar --------------------------------------------------------------------

async function quitar() {
  const lotes = await db.select({ id: batches.id }).from(batches).where(like(batches.notes, `${NOTA}%`));
  const idsLotes = lotes.map((l) => l.id);
  const ordenes = await db.select({ id: productionOrders.id }).from(productionOrders).where(eq(productionOrders.customerName, CLIENTE));
  const idsOrdenes = ordenes.map((o) => o.id);
  const provs = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, PROVEEDOR));
  const idsProv = provs.map((p) => p.id);

  await db.transaction(async (tx) => {
    if (idsLotes.length) {
      await tx.delete(tests).where(inArray(tests.batchId, idsLotes));
      await tx.delete(materialMoves).where(and(eq(materialMoves.refType, "batch"), inArray(materialMoves.refId, idsLotes)));
      await tx.delete(inventoryMoves).where(and(eq(inventoryMoves.refType, "batch"), inArray(inventoryMoves.refId, idsLotes)));
      await tx.delete(batchLines).where(inArray(batchLines.batchId, idsLotes));
      await tx.delete(batches).where(inArray(batches.id, idsLotes));
    }
    await tx.delete(maintenanceLogs).where(like(maintenanceLogs.notes, `${NOTA}%`));

    if (idsOrdenes.length) {
      await tx.delete(productionOrderLines).where(inArray(productionOrderLines.orderId, idsOrdenes));
      await tx.delete(productionOrders).where(inArray(productionOrders.id, idsOrdenes));
    }

    if (idsProv.length) {
      const compras = await tx.select({ id: purchases.id }).from(purchases).where(inArray(purchases.supplierId, idsProv));
      const idsCompras = compras.map((c) => c.id);
      if (idsCompras.length) {
        const recs = await tx.select({ id: purchaseReceipts.id }).from(purchaseReceipts).where(inArray(purchaseReceipts.purchaseId, idsCompras));
        const idsRecs = recs.map((r) => r.id);
        if (idsRecs.length) {
          await tx.delete(materialMoves).where(and(eq(materialMoves.refType, "purchase_receipt"), inArray(materialMoves.refId, idsRecs)));
          await tx.delete(purchaseReceiptLines).where(inArray(purchaseReceiptLines.receiptId, idsRecs));
          await tx.delete(purchaseReceipts).where(inArray(purchaseReceipts.id, idsRecs));
        }
        await tx.delete(purchaseLines).where(inArray(purchaseLines.purchaseId, idsCompras));
        await tx.delete(purchases).where(inArray(purchases.id, idsCompras));
      }
      await tx.delete(suppliers).where(inArray(suppliers.id, idsProv));
    }

    const rs = await tx.select({ id: recipes.id }).from(recipes).where(like(recipes.code, "DEMO-%"));
    const idsRecetas = rs.map((r) => r.id);
    if (idsRecetas.length) {
      await tx.delete(recipeLines).where(inArray(recipeLines.recipeId, idsRecetas));
      await tx.delete(recipes).where(inArray(recipes.id, idsRecetas));
    }

    // Los correlativos vuelven a donde estaban: el primer lote real es el 1, no el 5.
    for (const [id, tabla] of [
      ["batch", "batches"],
      ["production_order", "production_orders"],
      ["purchase", "purchases"],
      ["purchase_receipt", "purchase_receipts"],
    ] as const) {
      await tx.update(counters).set({ value: sql`coalesce((select max(number) from ${sql.raw(tabla)}), 0)` }).where(eq(counters.id, id));
    }
  });

  console.log(
    `Quitado: ${idsLotes.length} lotes, ${idsOrdenes.length} órdenes, ${idsProv.length} proveedor, las compras, recetas y tareas hechas de ejemplo.`,
  );
}

// --- Cargar --------------------------------------------------------------------

async function cargar() {
  const hay = await db.select({ n: sql<number>`count(*)` }).from(batches);
  if (Number(hay[0]?.n ?? 0) > 0) {
    throw new Error(
      "Ya hay lotes registrados. Los datos de ejemplo no se mezclan con los reales. " +
        "Si esos lotes son de ejemplo, corré primero con --quitar.",
    );
  }
  const [yaReceta] = await db.select({ id: recipes.id }).from(recipes).where(like(recipes.code, "DEMO-%"));
  if (yaReceta) throw new Error("Los datos de ejemplo ya están cargados. Para empezar de nuevo corré con --quitar.");

  const [duena] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.active, true)))
    .limit(1);
  if (!duena) throw new Error("Primero hay que crear la cuenta de la dueña (al abrir el sistema por primera vez).");

  // Una sesión de un solo uso, solo dentro de este proceso: no se escribe en ningún lado.
  const llave = randomBytes(32).toString("hex");
  const [ses] = await db
    .insert(sessions)
    .values({ userId: duena.id, tokenHash: createHash("sha256").update(llave).digest("hex"), userAgent: "demo-planta" })
    .returning({ id: sessions.id });

  const app = await buildServer({ silencioso: true });
  try {
    const llamar = async (metodo: "GET" | "POST" | "PATCH", url: string, payload?: unknown) => {
      const r = await app.inject({ method: metodo, url, payload: payload as object | undefined, cookies: { [COOKIE]: llave } });
      const cuerpo = (() => { try { return r.json(); } catch { return null; } })();
      if (r.statusCode >= 400) throw new Error(`${metodo} ${url} → ${r.statusCode}: ${JSON.stringify(cuerpo)}`);
      return cuerpo;
    };

    const materiales = (await llamar("GET", "/bloques/materiales")) as { id: string; code: string }[];
    const mat = (code: string) => {
      const m = materiales.find((x) => x.code === code);
      if (!m) throw new Error(`Falta el material «${code}». Corré antes: node dist/db/seed-bloques.js`);
      return m.id;
    };
    const tipos = (await llamar("GET", "/bloques/tipos")) as { id: string; code: string }[];
    const tipo = (code: string) => {
      const t = tipos.find((x) => x.code === code);
      if (!t) throw new Error(`Falta el tipo de bloque ${code}.`);
      return t.id;
    };

    // Precios de ejemplo (los de Titán cuando se armó el sistema).
    const precios: Record<string, number> = { cemento: 1_050, arena: 2_800, grava: 3_200, agua: 150 };
    for (const [code, centavos] of Object.entries(precios)) {
      await llamar("PATCH", `/bloques/materiales/${mat(code)}`, { purchasePriceCents: centavos });
    }
    console.log("· precios de cemento, arena, grava y agua");

    // Una compra recibida entera y otra recibida a medias.
    const prov = await llamar("POST", "/bloques/proveedores", { name: PROVEEDOR, notes: NOTA });
    const compra1 = await llamar("POST", "/bloques/compras", {
      supplierId: prov.id,
      lines: [
        { materialId: mat("cemento"), quantityMilli: 300_000 },
        { materialId: mat("arena"), quantityMilli: 60_000 },
        { materialId: mat("grava"), quantityMilli: 60_000 },
        { materialId: mat("agua"), quantityMilli: 2_000_000 },
      ],
    });
    await llamar("POST", `/bloques/compras/${compra1.id}/recepciones`, {
      lines: compra1.lines.map((l: { id: string; quantityMilli: number }) => ({ purchaseLineId: l.id, quantityMilli: l.quantityMilli })),
    });
    const compra2 = await llamar("POST", "/bloques/compras", {
      supplierId: prov.id,
      lines: [{ materialId: mat("cemento"), quantityMilli: 100_000 }],
    });
    await llamar("POST", `/bloques/compras/${compra2.id}/recepciones`, {
      lines: [{ purchaseLineId: compra2.lines[0].id, quantityMilli: 40_000 }],
    });
    console.log("· proveedor y dos compras (una completa, otra recibida a medias)");

    // Dos recetas.
    const renglones = (c: number, a: number, g: number, w: number) => [
      { materialId: mat("cemento"), quantityMilli: c },
      { materialId: mat("arena"), quantityMilli: a },
      { materialId: mat("grava"), quantityMilli: g },
      { materialId: mat("agua"), quantityMilli: w },
    ];
    const r15 = await llamar("POST", "/bloques/recetas", {
      code: "DEMO-B15", name: "Mezcla estándar bloque 15 (demo)", blockTypeId: tipo("B15"),
      expectedBlocksPerMix: 60, notes: NOTA, renglones: renglones(1_000, 4_000, 3_000, 20_000),
    });
    const r10 = await llamar("POST", "/bloques/recetas", {
      code: "DEMO-B10", name: "Mezcla bloque 10 (demo)", blockTypeId: tipo("B10"),
      expectedBlocksPerMix: 80, notes: NOTA, renglones: renglones(1_000, 4_500, 3_500, 22_000),
    });
    const id15 = (r15.receta ?? r15).id as string;
    const id10 = (r10.receta ?? r10).id as string;
    console.log("· dos recetas");

    const lote = async (recipeId: string, mixes: number, buenos: number, rotos: number, hace: number, extra: object = {}) =>
      (await llamar("POST", "/bloques/lotes", {
        recipeId, mixes, blocksGood: buenos, blocksBroken: rotos, producedAt: dias(hace), notes: NOTA, ...extra,
      })) as { id?: string; lote?: { id: string } };
    const idDe = (f: { id?: string; lote?: { id: string } }) => (f.lote?.id ?? f.id) as string;

    // Lotes en el tiempo, con una tarea de mantenimiento hecha a la mitad.
    const l1 = await lote(id15, 10, 470, 130, 30);
    const l2 = await lote(id15, 10, 540, 60, 21);
    const tareas = (await llamar("GET", "/bloques/mantenimiento")) as { tareas?: { id: string }[] } | { id: string }[];
    const lista = Array.isArray(tareas) ? tareas : tareas.tareas ?? [];
    if (lista[0]) await llamar("POST", `/bloques/mantenimiento/tareas/${lista[0].id}/hecha`, { notes: NOTA });
    const l3 = await lote(id10, 8, 600, 40, 10);
    console.log("· tres lotes y una tarea de mantenimiento hecha");

    // Ensayos: uno que cumple (y valida la receta) y uno flojo.
    await llamar("POST", `/bloques/lotes/${idDe(l1)}/ensayos`, {
      testedAt: dias(2), ageDays: 28, specimens: 3, strengthMpaMilli: 14_200, basis: "net", source: "plant", notes: NOTA,
    });
    await llamar("POST", `/bloques/lotes/${idDe(l3)}/ensayos`, {
      testedAt: dias(3), ageDays: 7, specimens: 3, strengthMpaMilli: 2_100, basis: "net", source: "plant", notes: `${NOTA}. Salió flojo.`,
    });
    await llamar("POST", `/bloques/recetas/${id15}/validar`, {}).catch(() => undefined);
    console.log("· dos ensayos (uno cumple, uno sale flojo)");

    // Dos órdenes: una a medio cumplir y otra sin empezar.
    const orden1 = await llamar("POST", "/ordenes", { customerName: CLIENTE, notes: NOTA, lines: [{ blockTypeId: tipo("B15"), quantity: 900 }] });
    await lote(id15, 6, 340, 20, 1, { productionOrderId: orden1.id ?? orden1.orden?.id });
    await llamar("POST", "/ordenes", { customerName: CLIENTE, notes: NOTA, lines: [{ blockTypeId: tipo("B10"), quantity: 400 }] });
    console.log("· dos órdenes (una a medio cumplir, otra sin empezar)");
  } catch (e) {
    // Si algo falla a la mitad no se deja un ejemplo a medias: se recoge lo que alcanzó a crearse.
    console.error("\nAlgo falló a la mitad; recogiendo lo que ya se había creado…");
    await app.close();
    await quitar().catch(() => undefined);
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, ses!.id));
    throw e;
  } finally {
    await app.close().catch(() => undefined);
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, ses!.id));
  }
}

async function main() {
  if (process.argv.includes("--quitar")) await quitar();
  else {
    await cargar();
    console.log("\nListo. Abrí Planta, Lotes, Órdenes, Mantenimiento, Almacén y el inventario del área comercial.");
    console.log("Para borrar todo esto: node dist/db/demo-planta.js --quitar");
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error("\nNo se pudo:", err instanceof Error ? err.message : err);
  await pool.end();
  process.exit(1);
});
