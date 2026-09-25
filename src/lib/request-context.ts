import type { FastifyRequest } from "fastify";

/**
 * Quién hace la petición.
 *
 * Sale de la sesión, que la guarda resolvió a partir de la cookie antes de
 * que ninguna ruta corriera. Hasta la versión anterior salía del encabezado
 * `x-user-id`, que el propio llamador se escribía: bastaba con poner el id de
 * otra persona para que el registro de actividad dijera que había sido ella.
 * Ese encabezado ya no se mira, y a propósito: si se aceptara "por si acaso",
 * seguiría siendo una puerta abierta con un cartel que pide no entrar.
 *
 * Devuelve null sólo donde la sesión no es obligatoria (las rutas de entrada,
 * el chequeo de salud). En todo lo demás la guarda ya cortó antes.
 */
export function getUserId(req: FastifyRequest): string | null {
  return req.quien?.id ?? null;
}

/** El nivel de quien pide, para las reglas que no caben en la guarda general. */
export function getRol(req: FastifyRequest): "owner" | "staff" | "viewer" | null {
  return req.quien?.role ?? null;
}
