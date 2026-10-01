import { z } from "zod";
import { esDia } from "./fechas.js";

/**
 * Un dia de calendario, escrito AAAA-MM-DD, que exista de verdad.
 *
 * El formato solo no alcanza: «2026-02-31» tiene la forma correcta y no es
 * ningun dia.
 */
export const dia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha tiene que ser un día, como 2026-03-15.")
  .refine(esDia, "Ese día no existe en el calendario.");

/** Un texto obligatorio, sin espacios de sobra, con tope de largo. */
export const texto = (nombre: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Falta ${nombre}.`)
    .max(max, `${nombre[0]!.toUpperCase()}${nombre.slice(1)} es demasiado largo (máximo ${max} letras).`);
