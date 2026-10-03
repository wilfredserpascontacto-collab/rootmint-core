import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, money, date, cents, numeroFactura, type Customer, type Item, type Factura } from "./api";
import { useData, ErrorBox, Field, Empty, Header } from "./piezas";
import { useModulos } from "../acceso/modulos";

/**
 * Pedidos: lo que un cliente compró y falta entregar.
 *
 * La cotización es una oferta; el pedido es el compromiso. Su gracia es que
 * aparta bloques del patio para el cliente, así que dos vendedores no le
 * prometen lo mismo a dos personas. Nada de lo que se ve acá es un saldo
 * guardado: lo facturado sale de las facturas y lo apartado se devuelve solo
 * si la factura se anula.
 */

export const numeroPedido = (n: number) => "PED-" + String(n).padStart(5, "0");

type Estado = "abierto" | "cumplido" | "cancelado";
const NOMBRE_ESTADO: Record<Estado, string> = { abierto: "Abierto", cumplido: "Cumplido", cancelado: "Cancelado" };
const CLASE_ESTADO: Record<Estado, string> = { abierto: "sent", cumplido: "accepted", cancelado: "rejected" };
const Insignia = ({ estado }: { estado: Estado }) => (
  <span className={"c-badge " + CLASE_ESTADO[estado]}>{NOMBRE_ESTADO[estado]}</span>
);

type PedidoFila = {
  id: string; number: number; customerName: string; estado: Estado; neededBy: string | null;
  createdAt: string; quoteId: string | null; renglones: number; pedido: number; pendiente: number; totalCents: number;
};
type Renglon = {
  id: string; catalogItemId: string | null; description: string; quantity: number; unitPriceCents: number;
  subtotalCents: number; facturado: number; pendiente: number; esProducible: boolean; blockTypeId: string | null;
  blockTypeName: string | null; reservado: number; porProducir: number; enPatio: number | null;
};
type Ficha = {
  id: string; number: number; customerId: string; customerName: string; quoteId: string | null; estado: Estado;
  status: "abierto" | "cancelado"; neededBy: string | null; deliveryAddress: string | null; notes: string | null;
  cancelReason: string | null; createdAt: string; lines: Renglon[]; totalCents: number; reservado: number; porProducir: number;
  invoices: { id: string; kind: string; number: number; status: string; totalCents: number; issueDate: string }[];
  productionOrders: { id: string; number: number; status: string }[];
  avisos?: string[];
};

const miles = (n: number) => n.toLocaleString("es-SV");

// --- La lista -----------------------------------------------------------------

export function Pedidos() {
  const [ver, setVer] = useState<"abiertos" | "todos">("abiertos");
  const d = useData<PedidoFila[]>("/pedidos?estado=" + ver);
  const filas = d.data ?? [];
  return (
    <>
      <Header
        title="Pedidos"
        subtitle="Lo que los clientes compraron y falta entregar, con los bloques que ya se les apartaron."
        action={<Link className="c-primary" to="/comercial/pedidos/nuevo">Nuevo pedido</Link>}
      />
      <ErrorBox message={d.error} />
      <div className="c-statusbar" style={{ marginBottom: 12 }}>
        <button className={ver === "abiertos" ? "c-primary" : ""} onClick={() => setVer("abiertos")}>Abiertos</button>
        <button className={ver === "todos" ? "c-primary" : ""} onClick={() => setVer("todos")}>Todos</button>
      </div>
      <section className="c-card">
        {filas.length > 0 && (
          <div className="c-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pedido</th><th>Cliente</th><th>Estado</th><th>Para el</th>
                  <th className="c-num">Pendiente</th><th className="c-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((p) => (
                  <tr key={p.id}>
                    <td><Link to={"/comercial/pedidos/" + p.id}><strong>{numeroPedido(p.number)}</strong></Link></td>
                    <td>{p.customerName}</td>
                    <td><Insignia estado={p.estado} /></td>
                    <td>{p.neededBy ? date(p.neededBy) : "—"}</td>
                    <td className="c-num">{p.estado === "cancelado" ? "—" : miles(p.pendiente) + " de " + miles(p.pedido)}</td>
                    <td className="c-num">{money(p.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d.data && filas.length === 0 && (
          <Empty title={ver === "abiertos" ? "No hay pedidos abiertos" : "Todavía no hay pedidos"}>
            Un pedido nace de una cotización (botón «Crear pedido») o se arma desde cero con «Nuevo pedido».
          </Empty>
        )}
      </section>
    </>
  );
}

// --- Un pedido nuevo, sin cotización -------------------------------------------

type RenglonNuevo = { catalogItemId: string; quantity: string };

export function PedidoNuevo() {
  const navigate = useNavigate();
  const clientes = useData<Customer[]>("/customers");
  const items = useData<Item[]>("/catalog-items");
  const [clienteId, setClienteId] = useState("");
  const [paraEl, setParaEl] = useState("");
  const [direccion, setDireccion] = useState("");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<RenglonNuevo[]>([{ catalogItemId: "", quantity: "" }]);
  const [busy, setBusy] = useState(false);
  const [falla, setFalla] = useState("");

  const productos = (items.data ?? []).filter((i) => (i as Item & { active?: boolean }).active !== false);
  const cambiar = (i: number, parte: Partial<RenglonNuevo>) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...parte } : l)));
  const completos = lineas.filter((l) => l.catalogItemId && Number(l.quantity) > 0);
  const total = completos.reduce(
    (a, l) => a + Math.round(Number(l.quantity)) * (productos.find((p) => p.id === l.catalogItemId)?.unitPriceCents ?? 0), 0);
  const listo = clienteId !== "" && completos.length > 0 && completos.length === lineas.length;

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!listo || busy) return;
    setBusy(true); setFalla("");
    try {
      const r = await api<{ id: string; avisos: string[] }>("/pedidos", "POST", {
        customerId: clienteId,
        ...(paraEl ? { neededBy: new Date(paraEl + "T12:00:00-06:00").toISOString() } : {}),
        ...(direccion.trim() ? { deliveryAddress: direccion.trim() } : {}),
        ...(notas.trim() ? { notes: notas.trim() } : {}),
        lines: lineas.map((l) => ({ catalogItemId: l.catalogItemId, quantity: Math.round(Number(l.quantity)) })),
      });
      navigate("/comercial/pedidos/" + r.id, { state: { avisos: r.avisos } });
    } catch (err) { setFalla((err as Error).message); setBusy(false); }
  }

  return (
    <>
      <Link className="c-back" to="/comercial/pedidos">← Pedidos</Link>
      <Header title="Nuevo pedido" subtitle="Al crearlo se aparta del patio lo que haya libre de cada bloque." />
      <form className="c-card c-pad" onSubmit={crear}>
        <div className="c-form-grid">
          <Field label="Cliente">
            <select aria-label="Cliente" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <option value="">Elegí uno…</option>
              {(clientes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Lo necesita para el (opcional)">
            <input aria-label="Para el" type="date" value={paraEl} onChange={(e) => setParaEl(e.target.value)} />
          </Field>
          <Field label="Dirección de entrega (opcional)" wide>
            <input aria-label="Dirección de entrega" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
          </Field>
        </div>
        <div className="c-scroll" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Producto</th><th className="c-num">Cantidad</th><th /></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select aria-label={"Producto " + (i + 1)} value={l.catalogItemId} onChange={(e) => cambiar(i, { catalogItemId: e.target.value })}>
                      <option value="">Elegí un producto…</option>
                      {productos.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.unitPriceCents)}</option>)}
                    </select>
                  </td>
                  <td className="c-num">
                    <input aria-label={"Cantidad " + (i + 1)} inputMode="numeric" style={{ width: 110 }} value={l.quantity} onChange={(e) => cambiar(i, { quantity: e.target.value })} />
                  </td>
                  <td>{lineas.length > 1 && <button type="button" className="c-link" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>Quitar</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total sin impuestos</td><td className="c-num">{money(total)}</td><td /></tr></tfoot>
          </table>
        </div>
        <Field label="Notas (opcional)" wide>
          <textarea aria-label="Notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
        </Field>
        <div className="c-statusbar" style={{ marginTop: 12 }}>
          <button type="button" onClick={() => setLineas((ls) => [...ls, { catalogItemId: "", quantity: "" }])}>Agregar otro producto</button>
          <button className="c-primary" disabled={!listo || busy}>Crear pedido</button>
        </div>
        <ErrorBox message={falla} />
      </form>
    </>
  );
}

// --- La ficha -------------------------------------------------------------------

export function FichaPedido() {
  const { id } = useParams();
  const navigate = useNavigate();
  const llegaron = (useLocation().state as { avisos?: string[] } | null)?.avisos ?? [];
  const planta = useModulos().tiene("bloques");
  const d = useData<Ficha>("/pedidos/" + id);
  const [avisos, setAvisos] = useState<string[]>(llegaron);
  const [busy, setBusy] = useState(false);
  const [falla, setFalla] = useState("");
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  // Evita mandar dos veces la misma orden a la planta desde esta pantalla.
  const [enviado, setEnviado] = useState(false);

  async function accion(ruta: string, cuerpo?: unknown) {
    if (busy) return;
    setBusy(true); setFalla(""); setAvisos([]);
    try {
      const r = await api<Ficha>("/pedidos/" + id + ruta, "POST", cuerpo ?? {});
      setAvisos(r.avisos ?? []);
      setCancelando(false); setMotivo("");
      d.reload();
    } catch (e) { setFalla((e as Error).message); } finally { setBusy(false); }
  }

  async function facturar() {
    if (busy) return;
    setBusy(true); setFalla("");
    try {
      const f = await api<Factura>("/invoices", "POST", { salesOrderId: id });
      navigate("/comercial/facturas/" + f.id, { state: { avisos: f.avisos } });
    } catch (e) { setFalla((e as Error).message); setBusy(false); }
  }

  async function mandarAProducir(p: Ficha) {
    if (busy) return;
    setBusy(true); setFalla(""); setAvisos([]);
    try {
      const lines = p.lines.filter((l) => l.blockTypeId && l.porProducir > 0)
        .map((l) => ({ blockTypeId: l.blockTypeId as string, quantity: l.porProducir }));
      const o = await api<{ id: string; number: number }>("/ordenes", "POST", {
        customerName: p.customerName,
        ...(p.neededBy ? { neededBy: p.neededBy } : {}),
        notes: "Para el pedido " + numeroPedido(p.number),
        lines,
      });
      setAvisos([`Se le mandó a la planta la orden N° ${o.number} con lo que falta de este pedido. Cuando se produzca, tocá «Apartar lo que haya libre».`]);
      setEnviado(true);
      d.reload();
    } catch (e) { setFalla((e as Error).message); } finally { setBusy(false); }
  }

  const p = d.data;
  if (!p) return <><ErrorBox message={d.error} />{!d.error && <p>Cargando pedido…</p>}</>;

  const abierto = p.estado === "abierto";
  const faltaProducir = p.lines.some((l) => l.porProducir > 0);
  const hayApartable = p.lines.some((l) => l.esProducible && l.pendiente > l.reservado);
  const hayApartado = p.lines.some((l) => l.reservado > 0);
  const hayPendiente = p.lines.some((l) => l.pendiente > 0);

  return (
    <>
      <Link className="c-back" to="/comercial/pedidos">← Pedidos</Link>
      <Header
        title={numeroPedido(p.number)}
        subtitle={p.customerName + (p.neededBy ? " · lo necesita para el " + date(p.neededBy) : "")}
      />
      <div className="c-statusbar">
        <Insignia estado={p.estado} />
        {p.quoteId && <Link className="c-link" to={"/comercial/cotizaciones/" + p.quoteId}>Ver la cotización</Link>}
        {abierto && hayPendiente && <button className="c-primary" disabled={busy} onClick={facturar}>Facturar lo pendiente</button>}
        {abierto && hayApartable && <button disabled={busy} onClick={() => accion("/reservar")}>Apartar lo que haya libre</button>}
        {abierto && hayApartado && <button disabled={busy} onClick={() => accion("/liberar")}>Soltar lo apartado</button>}
        {abierto && planta && faltaProducir && <button disabled={busy || enviado} onClick={() => mandarAProducir(p)}>Mandar a producir lo que falta</button>}
        {abierto && !cancelando && <button disabled={busy} onClick={() => setCancelando(true)}>Cancelar pedido</button>}
        {cancelando && (
          <span className="c-confirmar">
            Motivo:{" "}
            <input aria-label="Motivo de la cancelación" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <button disabled={busy || motivo.trim().length < 3} onClick={() => accion("/cancelar", { reason: motivo.trim() })}>Sí, cancelar</button>
            <button disabled={busy} onClick={() => setCancelando(false)}>No</button>
          </span>
        )}
      </div>
      <ErrorBox message={falla || d.error} />
      {avisos.length > 0 && <ul className="c-avisos" role="status">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
      {p.estado === "cancelado" && <p className="c-ficha-nota">Cancelado: {p.cancelReason}</p>}

      <section className="c-card" style={{ marginTop: 12 }}>
        <div className="c-scroll">
          <table>
            <thead>
              <tr>
                <th>Producto</th><th className="c-num">Pedido</th><th className="c-num">Facturado</th>
                <th className="c-num">Pendiente</th>
                {planta && <><th className="c-num">Apartado</th><th className="c-num">Falta producir</th></>}
                <th className="c-num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}{planta && !l.esProducible && <small style={{ display: "block" }}>no se fabrica: servicio o sin enlazar</small>}</td>
                  <td className="c-num">{miles(l.quantity)}</td>
                  <td className="c-num">{miles(l.facturado)}</td>
                  <td className="c-num"><strong>{l.pendiente === 0 ? "—" : miles(l.pendiente)}</strong></td>
                  {planta && (
                    <>
                      <td className="c-num">{l.esProducible ? miles(l.reservado) : "—"}</td>
                      <td className="c-num">{l.esProducible && l.porProducir > 0 ? <strong>{miles(l.porProducir)}</strong> : "—"}</td>
                    </>
                  )}
                  <td className="c-num">{money(l.subtotalCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={planta ? 6 : 4}>Total sin impuestos</td><td className="c-num">{money(p.totalCents)}</td></tr></tfoot>
          </table>
        </div>
      </section>

      {p.notes && <p className="c-ficha-nota">{p.notes}</p>}
      {p.deliveryAddress && <p className="c-ficha-nota">Entrega en: {p.deliveryAddress}</p>}

      {p.invoices.length > 0 && (
        <section className="c-card c-pad" style={{ marginTop: 12 }}>
          <h3>Facturas de este pedido</h3>
          {p.invoices.map((f) => (
            <p key={f.id} className="c-ficha-nota">
              <Link to={"/comercial/facturas/" + f.id}><strong>{numeroFactura(f.kind, f.number)}</strong></Link>
              {" · "}{date(f.issueDate)} · {money(f.totalCents)}{f.status === "annulled" ? " · anulada" : ""}
            </p>
          ))}
        </section>
      )}
      {p.productionOrders.length > 0 && (
        <p className="c-ficha-nota">
          Órdenes en la planta: {p.productionOrders.map((o, i) => (
            <span key={o.id}>{i > 0 && ", "}<Link to={"/ordenes/" + o.id}>N° {o.number}</Link></span>
          ))}.
        </p>
      )}
      <p className="c-ficha-nota">
        Apartar no mueve bloques: solo los reserva. Los bloques salen del patio cuando se factura, y si la factura se
        anula, la reserva vuelve sola.
      </p>
    </>
  );
}

// --- El botón de la cotización ----------------------------------------------------

/** En la ficha de una cotización: crear su pedido, o ir al que ya tiene. */
export function PedidoDeCotizacion({ quoteId }: { quoteId: string }) {
  const navigate = useNavigate();
  const d = useData<PedidoFila[]>("/pedidos?estado=todos");
  const [busy, setBusy] = useState(false);
  const [falla, setFalla] = useState("");

  const propios = (d.data ?? []).filter((p) => p.quoteId === quoteId && p.estado !== "cancelado");
  const vivo = propios.find((p) => p.estado === "abierto");
  const hecho = propios.find((p) => p.estado === "cumplido");

  async function crear() {
    if (busy) return;
    setBusy(true); setFalla("");
    try {
      const r = await api<{ id: string; avisos: string[] }>("/pedidos/desde-cotizacion", "POST", { quoteId });
      navigate("/comercial/pedidos/" + r.id, { state: { avisos: r.avisos } });
    } catch (e) { setFalla((e as Error).message); setBusy(false); }
  }

  if (!d.data) return <ErrorBox message={d.error} />;
  return (
    <div className="c-statusbar" style={{ marginTop: 10 }}>
      {vivo
        ? <Link className="c-link" to={"/comercial/pedidos/" + vivo.id}>Pedido {numeroPedido(vivo.number)} abierto →</Link>
        : hecho
          ? <Link className="c-link" to={"/comercial/pedidos/" + hecho.id}>Pedido {numeroPedido(hecho.number)} cumplido →</Link>
          : <button disabled={busy} onClick={crear}>Crear pedido (aparta del patio)</button>}
      <ErrorBox message={falla} />
    </div>
  );
}
