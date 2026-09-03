/**
 * Mantenimiento y limpieza de la planta, medidos por USO.
 *
 * La idea que gobierna el archivo: en una bloquera la limpieza no es aseo, es
 * control de calidad. El molde sucio saca bloques deformes; el vibrador
 * desajustado baja la compactacion y con ella la resistencia. Por eso las
 * tareas se disparan por cuanto trabajo hizo la maquina —cada N mezclas o
 * cada N lotes— y no por el dia de la semana: una semana floja ensucia menos
 * que una de mucha produccion.
 *
 * Y por eso el estado del mantenimiento se CONGELA en cada lote. Dentro de
 * seis meses, cuando alguien mire un lote que rindio 78%, tiene que poder ver
 * que el molde llevaba doce mezclas sin limpiarse.
 */

import { eq, isNull, sql, desc, and } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  batches,
  plantRoles,
  maintenanceTasks,
  maintenanceLogs,
} from "../db/schema-bloques.js";

export interface Contadores {
  mezclas: number;
  lotes: number;
}

/** Cuanto trabajo lleva la planta en total. Se calcula de los lotes, sin contador aparte. */
export async function contadores(): Promise<Contadores> {
  const [fila] = await db
    .select({
      mezclas: sql<number>`coalesce(sum(${batches.mixes}), 0)`,
      lotes: sql<number>`count(*)`,
    })
    .from(batches)
    .where(isNull(batches.deletedAt));

  return {
    mezclas: Number(fila?.mezclas ?? 0),
    lotes: Number(fila?.lotes ?? 0),
  };
}

export type EstadoTarea = "al dia" | "por vencer" | "vencida" | "nunca hecha";

export interface TareaConEstado {
  id: string;
  code: string;
  nombre: string;
  descripcion: string | null;
  esDeFabrica: boolean;
  puesto: { id: string; nombre: string } | null;
  /** El disparador, en la unidad que corresponda. */
  cada: number;
  unidad: "mezclas" | "lotes";
  /** Cuanto se lleva usado desde la ultima vez que se hizo. */
  desde: number;
  /** Lo que falta para que toque. Negativo = ya se paso. */
  faltan: number;
  estado: EstadoTarea;
  ultimaVez: { fecha: Date; puesto: string | null; notas: string | null } | null;
}

/**
 * Estado de cada tarea contra los contadores de la planta.
 *
 * "por vencer" avisa en el ultimo 20% del intervalo: una tarea que toca cada
 * 10 mezclas empieza a avisar a la octava. Sirve para que el operario la haga
 * en una pausa natural y no a media corrida.
 */
export async function tareasConEstado(cont?: Contadores): Promise<TareaConEstado[]> {
  const c = cont ?? (await contadores());

  const tareas = await db
    .select({
      id: maintenanceTasks.id,
      code: maintenanceTasks.code,
      name: maintenanceTasks.name,
      description: maintenanceTasks.description,
      everyMixes: maintenanceTasks.everyMixes,
      everyBatches: maintenanceTasks.everyBatches,
      isCustom: maintenanceTasks.isCustom,
      roleId: plantRoles.id,
      roleName: plantRoles.name,
    })
    .from(maintenanceTasks)
    .leftJoin(plantRoles, eq(maintenanceTasks.roleId, plantRoles.id))
    .where(and(isNull(maintenanceTasks.deletedAt), eq(maintenanceTasks.active, true)))
    .orderBy(maintenanceTasks.name);

  const salida: TareaConEstado[] = [];

  for (const t of tareas) {
    const porMezclas = t.everyMixes !== null && t.everyMixes > 0;
    const cada = porMezclas ? t.everyMixes! : (t.everyBatches ?? 0);
    if (cada <= 0) continue; // sin intervalo no hay nada que vencer

    const unidad: "mezclas" | "lotes" = porMezclas ? "mezclas" : "lotes";
    const acumulado = porMezclas ? c.mezclas : c.lotes;

    const [ultimo] = await db
      .select()
      .from(maintenanceLogs)
      .where(eq(maintenanceLogs.taskId, t.id))
      .orderBy(desc(maintenanceLogs.doneAt))
      .limit(1);

    const base = ultimo ? (porMezclas ? ultimo.atMixes : ultimo.atBatches) : 0;
    const desde = Math.max(0, acumulado - base);
    const faltan = cada - desde;

    /**
     * La urgencia manda sobre la novedad.
     *
     * "Nunca hecha" es informativo, pero si ademas ya toca, lo que hay que
     * decir es que toca. Al reves —dejar "nunca hecha" tapando un vencimiento—
     * una tarea que jamas se hizo nunca llegaria a avisar.
     */
    const avisoAnticipado = Math.max(1, Math.round(cada * 0.2));
    let estado: EstadoTarea;
    if (faltan <= 0) estado = "vencida";
    else if (faltan <= avisoAnticipado) estado = "por vencer";
    else if (!ultimo) estado = "nunca hecha";
    else estado = "al dia";

    salida.push({
      id: t.id,
      code: t.code,
      nombre: t.name,
      descripcion: t.description,
      esDeFabrica: !t.isCustom,
      puesto: t.roleId ? { id: t.roleId, nombre: t.roleName ?? "" } : null,
      cada,
      unidad,
      desde,
      faltan,
      estado,
      ultimaVez: ultimo
        ? { fecha: ultimo.doneAt, puesto: ultimo.roleName, notas: ultimo.notes }
        : null,
    });
  }

  // Lo vencido primero: es lo unico que exige una decision.
  const orden: Record<EstadoTarea, number> = {
    vencida: 0,
    "por vencer": 1,
    "nunca hecha": 2,
    "al dia": 3,
  };
  return salida.sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre));
}

/**
 * Lo que estaba VENCIDO en este instante, en la forma que se congela dentro
 * del lote. Se llama ANTES de insertar el lote nuevo: lo que importa es como
 * estaba la maquina cuando se corrio, no despues.
 */
export async function vencidasAhora() {
  const tareas = await tareasConEstado();
  return tareas
    .filter((t) => t.estado === "vencida")
    .map((t) => ({
      taskId: t.id,
      nombre: t.nombre,
      vencidaPor: Math.abs(t.faltan),
      unidad: t.unidad,
    }));
}
