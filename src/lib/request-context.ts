import type { FastifyRequest } from "fastify";

/**
 * Quién hace la petición. Hasta que exista una capa de autenticación real,
 * el llamador se identifica con el header `x-user-id` (el id de un registro
 * en `users`). Sin header, las acciones quedan registradas con userId null
 * en activity_log en vez de fallar — útil en desarrollo/seed, pero cualquier
 * cliente real de la API debe mandarlo.
 */
export function getUserId(req: FastifyRequest): string | null {
  const header = req.headers["x-user-id"];
  if (typeof header === "string" && header.length > 0) return header;
  return null;
}
