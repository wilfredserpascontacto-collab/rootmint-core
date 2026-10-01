/**
 * Las cuentas de fechas y de garantia, sin base de datos ni servidor.
 *
 * Se corre con `npm run prueba:garantia`. Son las cuentas donde un error no
 * da una excepcion sino un plazo equivocado: por eso se prueban en los
 * bordes —fin de mes, año bisiesto, el ultimo dia, la medianoche de El
 * Salvador— y no con un caso comodo.
 */
import assert from "node:assert/strict";
import { sumarMeses, sumarDias, diasEntre, hoyEnElSalvador, esDia, limitesDelMes } from "../lib/fechas.js";
import { estadoDeUna, resumenDeInstalacion, faltanTextos } from "./garantia.js";

let n = 0;
const es = (real: unknown, esperado: unknown, que: string) => {
  assert.deepEqual(real, esperado, que);
  n++;
};

// --- sumar meses -------------------------------------------------------------
es(sumarMeses("2026-03-15", 12), "2027-03-15", "un año: el mismo día");
es(sumarMeses("2026-03-15", 6), "2026-09-15", "seis meses: el mismo día");
es(sumarMeses("2026-08-31", 6), "2027-02-28", "31 de agosto + 6 = 28 de febrero, no 3 de marzo");
es(sumarMeses("2026-01-31", 1), "2026-02-28", "31 de enero + 1 = 28 de febrero");
es(sumarMeses("2024-01-31", 1), "2024-02-29", "en bisiesto cae el 29");
es(sumarMeses("2024-02-29", 12), "2025-02-28", "29 de febrero + 1 año = 28 de febrero");
es(sumarMeses("2024-02-29", 48), "2028-02-29", "y a los 4 años vuelve el 29");
es(sumarMeses("2026-11-30", 3), "2027-02-28", "cruza el año");
es(sumarMeses("2026-12-15", 1), "2027-01-15", "diciembre + 1");
es(sumarMeses("2026-03-15", 0), "2026-03-15", "cero meses no mueve nada");
es(sumarMeses("2026-03-15", 24), "2028-03-15", "dos años");

// --- días --------------------------------------------------------------------
es(sumarDias("2026-02-28", 1), "2026-03-01", "28 de febrero + 1");
es(sumarDias("2024-02-28", 1), "2024-02-29", "y en bisiesto es 29");
es(sumarDias("2026-12-31", 1), "2027-01-01", "fin de año");
es(diasEntre("2026-03-15", "2026-03-15"), 0, "mismo día: 0");
es(diasEntre("2026-03-15", "2026-03-16"), 1, "un día");
es(diasEntre("2026-03-15", "2027-03-15"), 365, "un año común");
es(diasEntre("2026-03-16", "2026-03-15"), -1, "negativo hacia atrás");
es(limitesDelMes("2026-02-10"), { desde: "2026-02-01", hasta: "2026-02-28" }, "límites de febrero");
es(limitesDelMes("2024-02-10"), { desde: "2024-02-01", hasta: "2024-02-29" }, "y de febrero bisiesto");

// --- validar días -------------------------------------------------------------
es(esDia("2026-02-28"), true, "28 de febrero existe");
es(esDia("2026-02-29"), false, "29 de febrero de 2026 no");
es(esDia("2026-13-01"), false, "mes 13 no");
es(esDia("15/03/2026"), false, "formato equivocado no");

// --- hoy en El Salvador ---------------------------------------------------------
// 01:00 UTC del 1 de octubre son las 7 de la noche del 30 de septiembre allá.
es(hoyEnElSalvador(Date.UTC(2026, 9, 1, 1, 0)), "2026-09-30", "a la 1 UTC todavía es ayer en El Salvador");
es(hoyEnElSalvador(Date.UTC(2026, 9, 1, 6, 0)), "2026-10-01", "a las 6 UTC ya es hoy");
es(hoyEnElSalvador(Date.UTC(2026, 9, 1, 5, 59)), "2026-09-30", "un minuto antes todavía es ayer");

// --- estado de una garantía -------------------------------------------------------
const g = (startsAt: string, endsAt: string, annulledAt: unknown = null) => ({ startsAt, endsAt, annulledAt });
es(estadoDeUna(g("2026-03-15", "2026-09-15"), "2026-09-15"), "vigente", "el último día todavía está en garantía");
es(estadoDeUna(g("2026-03-15", "2026-09-15"), "2026-09-16"), "vencida", "al día siguiente venció");
es(estadoDeUna(g("2026-03-15", "2026-09-15"), "2026-03-15"), "vigente", "el primer día ya cubre");
es(estadoDeUna(g("2026-03-15", "2026-09-15"), "2026-03-14"), "futura", "el día antes todavía no empieza");
es(estadoDeUna(g("2026-03-15", "2026-09-15", new Date()), "2026-05-01"), "anulada", "anulada gana a las fechas");

// --- resumen de una instalación ------------------------------------------------------
const HOY = "2026-06-01";
let r = resumenDeInstalacion("2026-03-15", [g("2026-03-15", "2026-09-15")], HOY);
es([r.estado, r.hasta, r.diasRestantes], ["en_garantia", "2026-09-15", 106], "en garantía: hasta cuándo y cuántos días");

r = resumenDeInstalacion("2026-03-15", [g("2026-03-15", "2026-06-01")], HOY);
es([r.estado, r.diasRestantes], ["en_garantia", 0], "el último día: vence hoy (0 días), sigue en garantía");

r = resumenDeInstalacion("2026-03-15", [g("2026-03-15", "2026-05-31")], HOY);
es([r.estado, r.vencioEl, r.haceDias], ["vencida", "2026-05-31", 1], "venció ayer");

r = resumenDeInstalacion("2026-03-15", [], HOY);
es(r.estado, "sin_garantia", "entregada y sin garantía cargada: sin garantía");

r = resumenDeInstalacion(null, [], HOY);
es(r.estado, "sin_fecha", "sin fecha de entrega y sin garantía: NO SE SABE (no «sin garantía»)");

r = resumenDeInstalacion(null, [g("2026-03-15", "2026-09-15")], HOY);
es(r.estado, "en_garantia", "con una garantía cargada se sabe aunque falte la fecha de entrega");

r = resumenDeInstalacion("2026-03-15", [g("2026-03-15", "2026-09-15", new Date())], HOY);
es(r.estado, "sin_garantia", "una anulada no cuenta");

r = resumenDeInstalacion("2026-09-01", [g("2026-09-01", "2027-03-01")], HOY);
es([r.estado, r.empiezaEl], ["futura", "2026-09-01"], "una que todavía no empieza");

// Extensión pegada a la garantía del trabajo: la cobertura es continua.
r = resumenDeInstalacion("2026-03-15", [g("2026-03-15", "2026-09-15"), g("2026-09-16", "2027-03-15")], HOY);
es([r.estado, r.hasta, r.diasRestantes], ["en_garantia", "2027-03-15", 287], "dos tramos pegados: cuenta hasta el final del segundo");

// Con un hueco de un día NO es continua.
r = resumenDeInstalacion("2026-03-15", [g("2026-03-15", "2026-09-15"), g("2026-09-17", "2027-03-15")], HOY);
es([r.estado, r.hasta], ["en_garantia", "2026-09-15"], "con un día de hueco, el primer tramo termina donde termina");

// Vencida la primera, la segunda todavía no empieza: hoy NO está cubierta.
r = resumenDeInstalacion("2026-01-01", [g("2026-01-01", "2026-03-01"), g("2026-09-01", "2027-03-01")], HOY);
es([r.estado, r.vencioEl], ["vencida", "2026-03-01"], "vencida y otra por empezar: hoy no está cubierta");

// Se junta aunque lleguen desordenadas, y una contenida dentro de otra no la acorta.
r = resumenDeInstalacion("2026-03-15", [g("2026-03-20", "2026-04-01"), g("2026-03-15", "2026-12-31")], HOY);
es([r.estado, r.hasta], ["en_garantia", "2026-12-31"], "una contenida en otra no acorta el tramo");

// --- el certificado ---------------------------------------------------------------------
es(faltanTextos({ conditions: "a", customerDuties: "b", howToClaim: "c", issuedBy: "d" }), [], "completo: no falta nada");
es(faltanTextos({ conditions: "", customerDuties: "  ", howToClaim: "c", issuedBy: null }).length, 3, "vacío, en blanco y nulo cuentan como faltantes");

console.log(`${n} comprobaciones, todas bien.`);
