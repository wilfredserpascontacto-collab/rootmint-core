import { db } from "./db/client.js";
import { businessProfile } from "./db/schema.js";
import { modulosActivos } from "./modulos.js";

/**
 * Como se llama este sistema en la pantalla.
 *
 * Antes el nombre de Titan estaba escrito en la interfaz, asi que cualquier
 * otro cliente habria abierto el sistema y visto el nombre de otra empresa.
 * Ahora sale de, en este orden:
 *   1. ROOTMINT_BRAND: lo fija quien despliega (igual que los modulos).
 *   2. El nombre de la empresa en «Mi empresa».
 *   3. «RootMint», que es honesto: nadie ha dicho como se llama.
 */
export async function marcaDelDespliegue(): Promise<{ marca: string; subtitulo: string }> {
  let marca = (process.env.ROOTMINT_BRAND ?? "").trim();
  if (!marca) {
    const [fila] = await db.select({ name: businessProfile.name }).from(businessProfile).limit(1);
    marca = fila?.name?.trim() ?? "";
  }
  return {
    marca: marca || "RootMint",
    // Lo que hace el sistema, solo si de verdad lo hace este despliegue.
    subtitulo: modulosActivos().includes("bloques") ? "Bloques y construcción" : "",
  };
}
