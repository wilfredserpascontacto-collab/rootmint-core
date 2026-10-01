import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  api, dia, numeroInstalacion, hoySV, sumarDiasDia, sumarMesesDia, diasEntreDias, plural,
  type Garantia, type Instalacion, type ResumenGarantia,
} from "./api";
import { useData, ErrorBox, Empty, Header, Field, Modal } from "./piezas";

/**
 * La pregunta del dia: ¿esta instalacion esta en garantia, y hasta cuando?
 *
 * Es lo primero que se ve de una instalacion, grande, porque es lo que hay que
 * contestar con el cliente al telefono. Todo viene calculado del servidor.
 */
export function LetreroGarantia({ g }: { g: ResumenGarantia }) {
  let clase = "nada", titulo = "", detalle = "";
  if (g.estado === "en_garantia" && g.hasta) {
    const n = g.diasRestantes ?? 0;
    clase = n <= 30 ? "pronto" : "si";
    titulo = `EN GARANTÍA hasta el ${dia(g.hasta)}`;
    detalle = n === 0 ? "Vence hoy: es el último día." : `Quedan ${plural(n, "día", "días")}.`;
  } else if (g.estado === "vencida" && g.vencioEl) {
    clase = "no";
    titulo = `GARANTÍA VENCIDA el ${dia(g.vencioEl)}`;
    detalle = `Hace ${plural(g.haceDias ?? 0, "día", "días")}.`;
  } else if (g.estado === "futura" && g.empiezaEl) {
    clase = "nada";
    titulo = `La garantía empieza el ${dia(g.empiezaEl)}`;
    detalle = "Todavía no corre.";
  } else if (g.estado === "sin_fecha") {
    clase = "nada";
    titulo = "NO SE PUEDE SABER: falta la fecha de entrega";
    detalle = "No hay fecha de entrega ni garantía cargada. Anota la fecha en «Editar» y da la garantía abajo.";
  } else {
    clase = "no";
    titulo = "SIN GARANTÍA REGISTRADA";
    detalle = "Si se le prometió una, falta darla abajo.";
  }
  return (
    <div className={"c-letrero " + clase} role="status" aria-label="Estado de la garantía">
      <strong>{titulo}</strong>
      <span>{detalle}</span>
    </div>
  );
}

const ETIQUETA: Record<Garantia["estado"], string> = { vigente: "Vigente", vencida: "Vencida", futura: "Aún no empieza", anulada: "Anulada" };

export function ChipGarantia({ g }: { g: ResumenGarantia | undefined }) {
  if (!g) return null;
  if (g.estado === "en_garantia" && g.hasta) {
    const n = g.diasRestantes ?? 0;
    return <span className={"c-chip " + (n <= 30 ? "pronto" : "si")}>En garantía · hasta {dia(g.hasta)}</span>;
  }
  if (g.estado === "vencida") return <span className="c-chip no">Vencida{g.vencioEl ? " · " + dia(g.vencioEl) : ""}</span>;
  if (g.estado === "futura") return <span className="c-chip nada">Empieza {g.empiezaEl ? dia(g.empiezaEl) : ""}</span>;
  if (g.estado === "sin_fecha") return <span className="c-chip nada">No se sabe</span>;
  return <span className="c-chip no">Sin garantía</span>;
}

/** La seccion de la ficha: cada garantia con su plazo, y las acciones. */
export function SeccionGarantias({
  instalacion, alCambiar, mostrarAvisos,
}: { instalacion: Instalacion; alCambiar: () => void; mostrarAvisos: (a: string[]) => void }) {
  const [formulario, setFormulario] = useState<{ editar?: Garantia } | null>(null);
  const [anulando, setAnulando] = useState<Garantia | null>(null);
  const lista = instalacion.garantias ?? [];
  return (
    <section className="c-card c-pad">
      <div className="c-section-head">
        <h2>Garantías</h2>
        <button className="c-primary" onClick={() => setFormulario({})}>+ Dar garantía</button>
      </div>
      {lista.length === 0 ? (
        <p className="c-ficha-nota">Todavía no hay ninguna garantía cargada para esta instalación.</p>
      ) : (
        <ul className="c-garantias">
          {lista.map((g) => (
            <li key={g.id} className={g.estado === "anulada" ? "anulada" : ""}>
              <div>
                <span className={"c-chip " + (g.estado === "vigente" ? "si" : g.estado === "anulada" ? "nada" : g.estado === "futura" ? "nada" : "no")}>{ETIQUETA[g.estado]}</span>
                <strong> Del {dia(g.startsAt)} al {dia(g.endsAt)}</strong>
                <small>
                  {g.estado === "vigente" && g.diasRestantes !== null
                    ? (g.diasRestantes === 0 ? "Vence hoy. " : `Quedan ${plural(g.diasRestantes, "día", "días")}. `)
                    : ""}
                  {g.origin === "extension" ? "Extensión vendida. " : "Garantía del trabajo. "}
                  {g.estado === "anulada" ? `Anulada: ${g.annulReason}` : g.faltanTextos.length ? `Al certificado le falta: ${g.faltanTextos.join("; ")}.` : "Certificado completo."}
                </small>
              </div>
              {g.estado !== "anulada" ? (
                <div className="c-fila-acciones">
                  <button className="c-link" onClick={() => setFormulario({ editar: g })}>Editar</button>
                  <button className="c-link" onClick={() => setAnulando(g)}>Anular</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {formulario ? (
        <FormularioGarantia
          instalacion={instalacion}
          inicial={formulario.editar}
          alCerrar={() => setFormulario(null)}
          alGuardar={(avisos) => { setFormulario(null); mostrarAvisos(avisos); alCambiar(); }}
        />
      ) : null}
      {anulando ? (
        <AnularGarantia
          g={anulando}
          alCerrar={() => setAnulando(null)}
          alAnular={() => { setAnulando(null); mostrarAvisos([]); alCambiar(); }}
        />
      ) : null}
    </section>
  );
}

const DURACIONES: [string, number][] = [["6 meses", 6], ["1 año", 12], ["2 años", 24]];

/**
 * Dar o corregir una garantia. La duracion es libre (a unos clientes se les da
 * 6 meses y a otros un año): se elige con un toque, se escribe en meses, o se
 * pone la fecha exacta. Cualquiera de las tres recalcula a las otras, y debajo
 * siempre se lee la fecha en que vence.
 */
function FormularioGarantia({
  instalacion, inicial, alCerrar, alGuardar,
}: { instalacion: Instalacion; inicial?: Garantia; alCerrar: () => void; alGuardar: (avisos: string[]) => void }) {
  const plantilla = useData<Pick<Garantia, "conditions" | "customerDuties" | "howToClaim" | "issuedBy">>(inicial ? "" : "/garantias/plantilla");
  const [startsAt, setStartsAt] = useState(inicial?.startsAt ?? instalacion.deliveredAt ?? "");
  const [meses, setMeses] = useState(inicial ? "" : "6");
  const [endsAt, setEndsAt] = useState(inicial?.endsAt ?? "");
  const [txt, setTxt] = useState({
    conditions: inicial?.conditions ?? "", customerDuties: inicial?.customerDuties ?? "",
    howToClaim: inicial?.howToClaim ?? "", issuedBy: inicial?.issuedBy ?? "",
  });
  const [falla, setFalla] = useState("");
  const [ocupado, setOcupado] = useState(false);

  // Una garantia nueva arranca con los textos de la ultima emitida; se pueden cambiar.
  useEffect(() => {
    if (!inicial && plantilla.data) setTxt((t) => (t.conditions || t.customerDuties || t.howToClaim || t.issuedBy ? t : { ...plantilla.data! }));
  }, [plantilla.data, inicial]);

  const mesesNum = /^\d+$/.test(meses) ? Number(meses) : null;
  const finCalculado = startsAt && mesesNum && mesesNum >= 1 && mesesNum <= 240 ? sumarMesesDia(startsAt, mesesNum) : "";
  // Lo que manda es lo ultimo que se toco: si hay meses, el fin sale de ellos.
  const fin = meses ? finCalculado : endsAt;
  const hoy = hoySV();
  const vence = fin
    ? fin < hoy
      ? `Vence el ${dia(fin)}: ya está vencida.`
      : `Vence el ${dia(fin)} (${diasEntreDias(hoy, fin) === 0 ? "hoy" : "dentro de " + plural(diasEntreDias(hoy, fin), "día", "días")}).`
    : "";
  const faltan = [txt.conditions, txt.customerDuties, txt.howToClaim, txt.issuedBy].filter((t) => !t.trim()).length;

  function elegirMeses(n: number) { setMeses(String(n)); setEndsAt(""); }
  function escribirFin(v: string) { setEndsAt(v); setMeses(""); }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    if (!startsAt) { setFalla("Falta la fecha desde la que corre. La instalación no tiene fecha de entrega: escribila aquí."); return; }
    if (!fin) { setFalla("Elegí la duración o escribí la fecha en que vence."); return; }
    setOcupado(true); setFalla("");
    try {
      const duracion = meses ? { months: mesesNum } : { endsAt };
      if (meses && mesesNum === null) throw new Error("Los meses tienen que ser un número entero, como 6 o 12.");
      const cuerpo = { startsAt, ...duracion, ...txt };
      const r = inicial
        ? await api<Garantia & { avisos: string[] }>("/garantias/" + inicial.id, "PATCH", cuerpo)
        : await api<Garantia & { avisos: string[] }>(`/instalaciones/${instalacion.id}/garantias`, "POST", cuerpo);
      alGuardar(r.avisos ?? []);
    } catch (err) { setFalla((err as Error).message); setOcupado(false); }
  }

  return (
    <Modal title={inicial ? "Editar garantía" : "Dar garantía"} close={alCerrar}>
      <form onSubmit={guardar}>
        <div className="c-form-grid">
          <Field label="Corre desde">
            <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </Field>
          <Field label="Duración en meses">
            <input inputMode="numeric" value={meses} onChange={(e) => { setMeses(e.target.value.trim()); setEndsAt(""); }} placeholder="6, 12, 18…" />
          </Field>
          <div className="c-field wide">
            <span>Atajos</span>
            <div className="c-atajos">
              {DURACIONES.map(([t, n]) => (
                <button type="button" key={n} className={meses === String(n) ? "activo" : ""} onClick={() => elegirMeses(n)}>{t}</button>
              ))}
            </div>
          </div>
          <Field label="O la fecha exacta en que vence (último día cubierto)" wide>
            <input type="date" value={fin} onChange={(e) => escribirFin(e.target.value)} />
          </Field>
        </div>
        {vence ? <p className="c-vence" role="status">{vence}</p> : null}
        <details className="c-textos" open={Boolean(inicial) || faltan < 4}>
          <summary>Textos del certificado (Art. 33 de la Ley de Protección al Consumidor){faltan ? ` · faltan ${faltan} de 4` : ""}</summary>
          <div className="c-form-grid">
            <Field label="Condiciones, formas y plazos de la garantía" wide>
              <textarea rows={3} value={txt.conditions} onChange={(e) => setTxt({ ...txt, conditions: e.target.value })} maxLength={4000} />
            </Field>
            <Field label="Qué tiene que hacer el cliente para conservarla" wide>
              <textarea rows={3} value={txt.customerDuties} onChange={(e) => setTxt({ ...txt, customerDuties: e.target.value })} maxLength={4000} />
            </Field>
            <Field label="Cómo se hace valer (a quién llamar, dónde)" wide>
              <textarea rows={3} value={txt.howToClaim} onChange={(e) => setTxt({ ...txt, howToClaim: e.target.value })} maxLength={4000} />
            </Field>
            <Field label="Quién la otorga" wide>
              <input value={txt.issuedBy} onChange={(e) => setTxt({ ...txt, issuedBy: e.target.value })} maxLength={4000} />
            </Field>
          </div>
        </details>
        {faltan ? <p className="c-ficha-nota">Se puede guardar sin los textos; pero sin los cuatro, el certificado queda incompleto.</p> : null}
        <ErrorBox message={falla} />
        <div className="c-actions">
          <button type="button" onClick={alCerrar}>Cancelar</button>
          <button className="c-primary" disabled={ocupado}>{ocupado ? "Guardando…" : inicial ? "Guardar cambios" : "Dar garantía"}</button>
        </div>
      </form>
    </Modal>
  );
}

function AnularGarantia({ g, alCerrar, alAnular }: { g: Garantia; alCerrar: () => void; alAnular: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [falla, setFalla] = useState("");
  const [ocupado, setOcupado] = useState(false);
  async function anular(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true); setFalla("");
    try { await api("/garantias/" + g.id + "/anular", "POST", { reason: motivo }); alAnular(); }
    catch (err) { setFalla((err as Error).message); setOcupado(false); }
  }
  return (
    <Modal title="Anular garantía" close={alCerrar}>
      <form onSubmit={anular}>
        <p className="c-ficha-nota">La garantía del {dia(g.startsAt)} al {dia(g.endsAt)} dejará de contar. No se borra: queda en la ficha, marcada como anulada, con el motivo.</p>
        <Field label="Motivo" wide>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} autoFocus placeholder="Se cargó dos veces, el cliente la rechazó…" />
        </Field>
        <ErrorBox message={falla} />
        <div className="c-actions">
          <button type="button" onClick={alCerrar}>No anular</button>
          <button className="c-primary" disabled={ocupado}>{ocupado ? "Anulando…" : "Anular garantía"}</button>
        </div>
      </form>
    </Modal>
  );
}

type Periodo = "mes" | "30" | "60" | "siguiente" | "vencidas";

/** Quien tiene la garantia por vencer: la lista para llamar antes de que se acabe. */
export function GarantiasQueVencen() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const hoy = hoySV();
  const [y, m] = hoy.split("-").map(Number);
  const primero = `${y}-${String(m).padStart(2, "0")}-01`;
  const siguiente = sumarMesesDia(primero, 1);
  const rango = {
    mes: [primero, sumarDiasDia(siguiente, -1)],
    "30": [hoy, sumarDiasDia(hoy, 30)],
    "60": [hoy, sumarDiasDia(hoy, 60)],
    siguiente: [siguiente, sumarDiasDia(sumarMesesDia(siguiente, 1), -1)],
    vencidas: [sumarDiasDia(hoy, -90), sumarDiasDia(hoy, -1)],
  }[periodo];
  const { data, error } = useData<Garantia[]>(`/garantias?desde=${rango[0]}&hasta=${rango[1]}`);
  return (
    <>
      <Header eyebrow="SERVICIO" title="Garantías que vencen" subtitle="A quién avisarle antes de que se le acabe, y a quién ya se le acabó." />
      <div className="c-toolbar">
        <select aria-label="Periodo" value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
          <option value="mes">Este mes</option>
          <option value="30">Próximos 30 días</option>
          <option value="60">Próximos 60 días</option>
          <option value="siguiente">El mes que viene</option>
          <option value="vencidas">Vencidas en los últimos 90 días</option>
        </select>
        <span>{data ? plural(data.length, "garantía", "garantías") : ""} · del {dia(rango[0]!)} al {dia(rango[1]!)}</span>
      </div>
      <ErrorBox message={error} />
      {!data && !error ? <p>Cargando…</p> : null}
      {data && data.length === 0 ? <div className="c-card"><Empty title="Ninguna en este periodo">No hay garantías que venzan entre esas fechas.</Empty></div> : null}
      {data && data.length > 0 ? (
        <div className="c-card c-scroll">
          <table>
            <thead><tr><th>Vence</th><th>Instalación / cliente</th><th>Dirección</th><th>Estado</th></tr></thead>
            <tbody>
              {data.map((g) => (
                <tr key={g.id}>
                  <td><strong>{dia(g.endsAt)}</strong></td>
                  <td>
                    <Link to={`/comercial/instalaciones/${g.instalacion!.id}`}><strong>{g.instalacion!.label}</strong></Link>
                    <small>{numeroInstalacion(g.instalacion!.number)} · {g.customer!.name}</small>
                  </td>
                  <td>{g.instalacion!.address}</td>
                  <td>
                    <span className={"c-chip " + (g.estado === "vigente" ? (g.diasRestantes! <= 30 ? "pronto" : "si") : g.estado === "vencida" ? "no" : "nada")}>
                      {g.estado === "vigente" ? (g.diasRestantes === 0 ? "Vence hoy" : `Quedan ${plural(g.diasRestantes!, "día", "días")}`) : ETIQUETA[g.estado]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
