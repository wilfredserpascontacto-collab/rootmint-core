import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  api, money, date, cents, numeroFactura, METODO_COBRO, ESTADO_FACTURA,
  type Factura, type CobrosDeFactura, type EstadoCuenta, type PorCobrar, type Cobro,
} from "./api";
import { useData, ErrorBox, Field, Empty, Header } from "./piezas";

/**
 * Cobros: donde la factura deja de ser deuda.
 *
 * Tres pantallas con la misma idea: el saldo nunca se escribe, siempre se
 * calcula de lo facturado menos lo cobrado. Lo que se anota es el cobro, y un
 * cobro equivocado se anula con su motivo en vez de borrarse.
 */

/** El día de hoy en El Salvador, como lo da un campo de fecha (AAAA-MM-DD). */
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/El_Salvador" }).format(new Date());

/** Un día elegido en el campo de fecha, a mediodía de El Salvador (UTC−6, sin horario de verano). */
const aInstante = (dia: string) => new Date(dia + "T12:00:00-06:00").toISOString();

const claseEstado: Record<string, string> = {
  pagada: "accepted", vencida: "rejected", parcial: "prospect", pendiente: "sent", anulada: "",
};
const EstadoBadge = ({ estado }: { estado: string }) => (
  <span className={"c-badge " + (claseEstado[estado] ?? "")}>{ESTADO_FACTURA[estado] ?? estado}</span>
);

/** Los cobros de una factura y el formulario para anotar uno nuevo. Va en la pantalla de la factura. */
export function CobrosFactura({ factura }: { factura: Factura }) {
  const d = useData<CobrosDeFactura>("/invoices/" + factura.id + "/pagos");
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [dia, setDia] = useState(hoy());
  const [referencia, setReferencia] = useState("");
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [falla, setFalla] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  async function cobrar(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setFalla(""); setAvisos([]);
    try {
      const centavos = cents(monto);
      if (centavos <= 0) throw new Error("Escribí cuánto pagó el cliente.");
      const r = await api<Cobro & { avisos?: string[] }>("/invoices/" + factura.id + "/pagos", "POST", {
        amountCents: centavos,
        method: metodo,
        ...(dia && dia !== hoy() ? { paidOn: aInstante(dia) } : {}),
        ...(referencia.trim() ? { reference: referencia.trim() } : {}),
        ...(nota.trim() ? { note: nota.trim() } : {}),
      });
      setAvisos(r.avisos ?? []);
      setMonto(""); setReferencia(""); setNota(""); setDia(hoy());
      d.reload();
    } catch (err) { setFalla((err as Error).message); } finally { setBusy(false); }
  }

  async function anular(id: string) {
    if (busy) return;
    setBusy(true); setFalla(""); setAvisos([]);
    try {
      const r = await api<Cobro & { avisos?: string[] }>("/pagos/" + id + "/anular", "POST", { reason: motivo });
      setAvisos(r.avisos ?? []); setAnulando(null); setMotivo("");
      d.reload();
    } catch (err) { setFalla((err as Error).message); } finally { setBusy(false); }
  }

  const x = d.data;
  const saldo = x?.saldoCents ?? 0;
  const pagada = x !== undefined && saldo <= 0;

  return (
    <section className="c-card c-pad c-cobros" aria-label="Cobros de la factura">
      <div className="c-section-head"><h2>Cobros</h2>{x && <span>{x.pagos.filter(p => !p.annulledAt).length} {x.pagos.filter(p => !p.annulledAt).length === 1 ? "cobro" : "cobros"}</span>}</div>
      <ErrorBox message={d.error} />
      {x && (
        <>
          <div className="c-resumen">
            <div><span>Total de la factura</span><strong>{money(x.totalCents)}</strong></div>
            <div><span>Cobrado</span><strong>{money(x.cobradoCents)}</strong></div>
            <div className={pagada ? "c-ok" : "c-debe"}>
              <span>{saldo < 0 ? "A favor del cliente" : pagada ? "Saldo" : "Falta cobrar"}</span>
              <strong>{pagada && saldo === 0 ? "Pagada" : money(Math.abs(saldo))}</strong>
            </div>
          </div>

          {x.pagos.length > 0 && (
            <div className="c-scroll">
              <table>
                <thead><tr><th>Fecha</th><th>Cómo pagó</th><th>Referencia</th><th className="c-num">Monto</th><th></th></tr></thead>
                <tbody>
                  {x.pagos.map(p => (
                    <tr key={p.id} className={p.annulledAt ? "c-cobro-anulado" : undefined}>
                      <td className="c-nw">{date(p.paidOn)}</td>
                      <td>{METODO_COBRO[p.method] ?? p.method}{p.note && <small>{p.note}</small>}</td>
                      <td>{p.reference || "—"}</td>
                      <td className="c-num"><strong>{money(p.amountCents)}</strong></td>
                      <td>
                        {p.annulledAt
                          ? <span>Anulado: {p.annulReason}</span>
                          : anulando === p.id
                            ? <span className="c-confirmar">
                                <input aria-label="Motivo de la anulación del cobro" placeholder="¿Por qué se anula?" value={motivo} onChange={e => setMotivo(e.target.value)} />
                                <button type="button" disabled={busy || motivo.trim().length < 3} onClick={() => anular(p.id)}>Anular</button>
                                <button type="button" disabled={busy} onClick={() => { setAnulando(null); setMotivo(""); }}>No</button>
                              </span>
                            : <button type="button" className="c-link" disabled={busy} onClick={() => { setAnulando(p.id); setMotivo(""); }}>Anular cobro</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form className="c-cobro-form" onSubmit={cobrar}>
            <Field label="Monto cobrado (USD)"><input inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" required /></Field>
            <Field label="Fecha"><input type="date" value={dia} max={hoy()} onChange={e => setDia(e.target.value)} required /></Field>
            <Field label="Cómo pagó">
              <select value={metodo} onChange={e => setMetodo(e.target.value)}>
                {Object.entries(METODO_COBRO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="N° de cheque o transferencia"><input value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Opcional" maxLength={120} /></Field>
            <div className="wide2"><Field label="Nota"><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Opcional" maxLength={500} /></Field></div>
            <div className="c-fila-botones">
              <button className="c-primary" disabled={busy || !monto.trim()}>{busy ? "Guardando…" : "Anotar cobro"}</button>
              {saldo > 0 && <button type="button" disabled={busy} onClick={() => setMonto((saldo / 100).toFixed(2))}>Cobrar el saldo completo ({money(saldo)})</button>}
            </div>
          </form>
          <ErrorBox message={falla} />
          {avisos.length > 0 && <ul className="c-avisos" role="status">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </>
      )}
    </section>
  );
}

/** Todo lo que se le ha facturado a un cliente, lo que pagó y lo que debe. Va en su expediente. */
export function EstadoCuentaCliente({ clienteId }: { clienteId: string }) {
  const e = useData<EstadoCuenta>("/customers/" + clienteId + "/estado-cuenta");
  const x = e.data;
  const vivos = x?.pagos.filter(p => !p.annulledAt) ?? [];

  return (
    <section className="c-card c-pad" aria-label="Estado de cuenta">
      <div className="c-section-head"><h2>Estado de cuenta</h2>{x && <span>{x.facturas.filter(f => f.status === "issued").length} facturas</span>}</div>
      <ErrorBox message={e.error} />
      {x && (
        <>
          <div className="c-resumen">
            <div><span>Facturado</span><strong>{money(x.totales.facturadoCents)}</strong></div>
            <div><span>Cobrado</span><strong>{money(x.totales.cobradoCents)}</strong></div>
            <div className={x.totales.saldoCents > 0 ? "c-debe" : "c-ok"}>
              <span>{x.totales.saldoCents < 0 ? "A favor del cliente" : "Debe"}</span>
              <strong>{money(Math.abs(x.totales.saldoCents))}</strong>
            </div>
          </div>
          {x.avisos.length > 0 && <ul className="c-avisos" role="status">{x.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}

          {x.facturas.length === 0
            ? <Empty title="Todavía no se le ha facturado nada">Cuando se le emita una factura, aparecerá acá con lo que vaya pagando.</Empty>
            : (
              <div className="c-scroll">
                <table>
                  <thead><tr><th>Factura</th><th>Fecha</th><th>Vence</th><th className="c-num">Total</th><th className="c-num">Cobrado</th><th className="c-num">Saldo</th><th>Estado</th></tr></thead>
                  <tbody>
                    {x.facturas.map(f => (
                      <tr key={f.id} style={f.status === "annulled" ? { opacity: .55 } : undefined}>
                        <td className="c-nw"><Link to={"/comercial/facturas/" + f.id}><strong>{numeroFactura(f.kind, f.number)}</strong></Link></td>
                        <td className="c-nw">{date(f.issueDate)}</td>
                        <td className="c-nw">{f.dueDate ? date(f.dueDate) : "—"}{f.diasVencida !== null && <small className="c-rojo">hace {f.diasVencida} {f.diasVencida === 1 ? "día" : "días"}</small>}</td>
                        <td className="c-num">{money(f.totalCents)}</td>
                        <td className="c-num">{money(f.cobradoCents)}</td>
                        <td className="c-num"><strong>{money(f.saldoCents)}</strong></td>
                        <td><EstadoBadge estado={f.estado} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          {vivos.length > 0 && (
            <>
              <h3 style={{ marginTop: 24 }}>Lo que ha pagado</h3>
              <div className="c-scroll">
                <table>
                  <thead><tr><th>Fecha</th><th>Factura</th><th>Cómo pagó</th><th className="c-num">Monto</th></tr></thead>
                  <tbody>
                    {vivos.map(p => (
                      <tr key={p.id}>
                        <td className="c-nw">{date(p.paidOn)}</td>
                        <td className="c-nw">{p.invoiceKind && p.invoiceNumber !== null ? numeroFactura(p.invoiceKind, p.invoiceNumber) : "—"}</td>
                        <td>{METODO_COBRO[p.method] ?? p.method}{p.reference && <small>{p.reference}</small>}</td>
                        <td className="c-num">{money(p.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Quién debe: los clientes con saldo, del que más debe al que menos. */
export function PorCobrarPantalla() {
  const d = useData<PorCobrar>("/cobros/por-cobrar");
  const x = d.data;
  return (
    <>
      <Header title="Por cobrar" subtitle="Quién debe, cuánto, y desde cuándo. Lo que ya se pagó no aparece." />
      <ErrorBox message={d.error} />
      {x && (
        <>
          <div className="c-resumen">
            <div className={x.totales.saldoCents > 0 ? "c-debe" : "c-ok"}><span>Total por cobrar</span><strong>{money(x.totales.saldoCents)}</strong></div>
            <div className={x.totales.vencidoCents > 0 ? "c-venc" : "c-ok"}><span>De eso, vencido</span><strong>{money(x.totales.vencidoCents)}</strong></div>
            <div><span>Clientes con saldo</span><strong>{x.clientes.length}</strong></div>
          </div>
          <section className="c-card c-pad">
            {x.clientes.length === 0
              ? <Empty title="Nadie debe nada">Todo lo facturado está cobrado. Cuando se emita una factura y quede sin pagar, el cliente aparecerá acá.</Empty>
              : (
                <div className="c-scroll">
                  <table>
                    <thead><tr><th>Cliente</th><th className="c-num">Debe</th><th className="c-num">Vencido</th><th>Facturas</th><th>La más vieja</th><th></th></tr></thead>
                    <tbody>
                      {x.clientes.map(c => (
                        <tr key={c.customerId}>
                          <td><Link to={"/comercial/clientes/" + c.customerId}><strong>{c.name}</strong></Link>{c.phone && <small>{c.phone}</small>}</td>
                          <td className="c-num"><strong>{money(c.saldoCents)}</strong>{c.pasaDelTope && <small className="c-rojo">Pasa de su tope ({money(c.creditLimitCents ?? 0)})</small>}</td>
                          <td className={"c-num" + (c.vencidoCents > 0 ? " c-rojo" : "")}>{c.vencidoCents > 0 ? money(c.vencidoCents) : "—"}</td>
                          <td>{c.facturasPendientes}</td>
                          <td>{c.diasDesdeLaMasVieja === null ? "—" : c.diasDesdeLaMasVieja === 0 ? "de hoy" : `hace ${c.diasDesdeLaMasVieja} ${c.diasDesdeLaMasVieja === 1 ? "día" : "días"}`}</td>
                          <td><Link className="c-link" to={"/comercial/clientes/" + c.customerId}>Estado de cuenta →</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
        </>
      )}
    </>
  );
}
