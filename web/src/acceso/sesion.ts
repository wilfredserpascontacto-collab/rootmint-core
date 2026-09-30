import { useCallback, useEffect, useState } from "react";

export type Rol = "owner" | "staff" | "viewer";
export type Persona = {
  id: string;
  name: string;
  email: string;
  role: Rol;
  /** Que piezas tiene este despliegue: el menu se arma con esto. */
  modulos: string[];
  /** Como se llama el sistema en pantalla (ver src/marca.ts). */
  marca: string;
  subtitulo: string;
};

export const NOMBRE_ROL: Record<Rol, string> = {
  owner: "Dueña",
  staff: "Empleado",
  viewer: "Solo lectura",
};

/**
 * Cuando el servidor contesta 401, la pantalla tiene que volver a la entrada.
 *
 * Pasa aunque nadie haya tocado "Salir": la sesión pudo revocarse desde otro
 * aparato, o la cuenta pudo desactivarse. Sin esto, la persona se queda
 * mirando una pantalla que ya no puede guardar nada y cada intento falla con
 * un error que no explica que en realidad hay que volver a entrar.
 */
export const SIN_SESION = "rootmint:sin-sesion";
export function avisarSinSesion() {
  window.dispatchEvent(new Event(SIN_SESION));
}

async function pedir<T>(ruta: string, cuerpo?: unknown, metodo = "POST"): Promise<T> {
  const r = await fetch(ruta, {
    method: metodo,
    headers: cuerpo === undefined ? undefined : { "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const datos = await r.json().catch(() => null);
  if (!r.ok) {
    const detalle = datos?.details?.[0]?.message;
    throw new Error(detalle ?? datos?.error ?? "No se pudo conectar. Probá de nuevo.");
  }
  return datos as T;
}

export const entrar = (email: string, password: string) =>
  pedir<{ ok: true }>("/auth/entrar", { email, password });

export const entrarConPin = (userId: string, pin: string) =>
  pedir<{ ok: true }>("/auth/pin", { userId, pin });

export const salir = () => pedir<{ ok: true }>("/auth/salir");

export const gentePlanta = () => pedir<{ id: string; name: string }[]>("/auth/planta", undefined, "GET");

export const hayAlguien = () =>
  pedir<{ hayAlguien: boolean; planta: boolean; marca: string; subtitulo: string }>("/auth/hay-alguien", undefined, "GET");

export const crearPrimeraDuena = (name: string, email: string, password: string) =>
  pedir<Persona>("/auth/primera-duena", { name, email, password });

type Estado =
  | { fase: "mirando" }
  | { fase: "adentro"; persona: Persona }
  | { fase: "afuera" };

export function useSesion() {
  const [estado, setEstado] = useState<Estado>({ fase: "mirando" });

  const revisar = useCallback(async () => {
    try {
      const r = await fetch("/auth/me");
      if (!r.ok) return setEstado({ fase: "afuera" });
      setEstado({ fase: "adentro", persona: (await r.json()) as Persona });
    } catch {
      // Sin red no se puede saber. Se prefiere mostrar la entrada antes que
      // una pantalla vacía sin explicación.
      setEstado({ fase: "afuera" });
    }
  }, []);

  useEffect(() => {
    void revisar();
    const alCaerse = () => setEstado({ fase: "afuera" });
    window.addEventListener(SIN_SESION, alCaerse);
    return () => window.removeEventListener(SIN_SESION, alCaerse);
  }, [revisar]);

  return { estado, revisar };
}
