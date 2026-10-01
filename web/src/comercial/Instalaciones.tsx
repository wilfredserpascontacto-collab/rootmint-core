import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, number as numeroCotizacion, dia, numeroInstalacion, type Customer, type Instalacion, type Quote } from "./api";
import { useData, ErrorBox, Empty, Header, Field, Modal } from "./piezas";
import { LetreroGarantia, ChipGarantia, SeccionGarantias } from "./Garantias";

/** Texto sin tildes ni mayusculas: la misma regla que usa el servidor para buscar. */
const sinTildes = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ñ/g, "n");

const EYEBROW = "SERVICIO";

/**
 * La lista de instalaciones, para encontrar una con el telefono en la mano.
 *
 * Se trae entera y se filtra aqui: con cientos de instalaciones es instantaneo,
 * y mientras alguien teclea el nombre del cliente la tabla no parpadea. El
 * servidor tambien sabe buscar (`/instalaciones?q=`) para el dia que no quepa.
 */
export function Instalaciones() {
  const { data, error, reload } = useData<Instalacion[]>("/instalaciones");
  const [busca, setBusca] = useState("");
  const [entrega, setEntrega] = useState<"todas" | "entregada" | "pendiente">("todas");
  const [garantia, setGarantia] = useState<"todas" | "en_garantia" | "vencida" | "sin_garantia">("todas");
  const [creando, setCreando] = useState(false);
  const navigate = useNavigate();

  const q = sinTildes(busca.trim());
  const numero = /^(?:ins-?)?0*(\d{1,9})$/.exec(q);
  const filas = (data ?? []).filter((i) => {
    if (entrega === "entregada" && !i.deliveredAt) return false;
    if (entrega === "pendiente" && i.deliveredAt) return false;
    if (garantia === "en_garantia" && i.garantia?.estado !== "en_garantia") return false;
    if (garantia === "vencida" && i.garantia?.estado !== "vencida") return false;
    if (garantia === "sin_garantia" && !["sin_garantia", "sin_fecha"].includes(i.garantia?.estado ?? "")) return false;
    if (!q) return true;
    if (numero && i.number === Number(numero[1])) return true;
    return [i.label, i.address, i.description, i.customerName].some((t) => sinTildes(t).includes(q));
  });

  return (
    <>
      <Header
        eyebrow={EYEBROW}
        title="Instalaciones"
        subtitle="Lo que se dejó funcionando en cada lugar, y a quién pertenece."
        action={<button className="c-primary" onClick={() => setCreando(true)}>+ Nueva instalación</button>}
      />
      <div className="c-toolbar">
        <input
          aria-label="Buscar instalaciones"
          placeholder="Buscar por cliente, dirección, cómo le dicen o número…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <select aria-label="Entrega" value={entrega} onChange={(e) => setEntrega(e.target.value as typeof entrega)}>
          <option value="todas">Todas</option>
          <option value="entregada">Ya entregadas</option>
          <option value="pendiente">Sin fecha de entrega</option>
        </select>
        <select aria-label="Garantía" value={garantia} onChange={(e) => setGarantia(e.target.value as typeof garantia)}>
          <option value="todas">Cualquier garantía</option>
          <option value="en_garantia">En garantía</option>
          <option value="vencida">Garantía vencida</option>
          <option value="sin_garantia">Sin garantía registrada</option>
        </select>
        <span>{data ? `${filas.length} de ${data.length}` : ""}</span>
      </div>
      <ErrorBox message={error} />
      {!data && !error ? <p>Cargando instalaciones…</p> : null}
      {data && data.length === 0 ? (
        <div className="c-card">
          <Empty title="Todavía no hay instalaciones">
            Cada trabajo que se deja funcionando en una casa o un local es una instalación. Cárgala con su dirección y
            la fecha de entrega, y desde ahí cuelgan las garantías y el mantenimiento.
          </Empty>
        </div>
      ) : null}
      {data && data.length > 0 ? (
        <div className="c-card c-scroll">
          <table>
            <thead>
              <tr>
                <th>N°</th>
                <th>Instalación / cliente</th>
                <th>Dirección</th>
                <th>Qué se instaló</th>
                <th>Entrega</th>
                <th>Garantía</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((i) => (
                <tr key={i.id}>
                  <td><Link to={`/comercial/instalaciones/${i.id}`}>{numeroInstalacion(i.number)}</Link></td>
                  <td>
                    <Link to={`/comercial/instalaciones/${i.id}`}><strong>{i.label}</strong></Link>
                    <small>{i.customerName}</small>
                  </td>
                  <td>{i.address}</td>
                  <td>{i.description.length > 80 ? i.description.slice(0, 80) + "…" : i.description}</td>
                  <td>{i.deliveredAt ? dia(i.deliveredAt) : <span className="c-ficha-nota">sin fecha</span>}</td>
                  <td><ChipGarantia g={i.garantia} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filas.length === 0 ? <Empty title="Nada coincide">Prueba con otra palabra, o quita el filtro de entrega.</Empty> : null}
        </div>
      ) : null}
      {creando ? (
        <FormularioInstalacion
          alCerrar={() => setCreando(false)}
          alGuardar={(i, avisos) => {
            setCreando(false);
            reload();
            navigate(`/comercial/instalaciones/${i.id}`, { state: { avisos } });
          }}
        />
      ) : null}
    </>
  );
}

/** Una instalacion entera, con lo que se puede hacer con ella. */
export function FichaInstalacion() {
  const { id } = useParams();
  const { data, error, reload } = useData<Instalacion>("/instalaciones/" + id);
  const navigate = useNavigate();
  const recien = (useLocation().state as { avisos?: string[] } | null)?.avisos ?? [];
  const [avisos, setAvisos] = useState<string[]>(recien);
  const [editando, setEditando] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const [falla, setFalla] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function quitar() {
    if (ocupado) return;
    setOcupado(true);
    setFalla("");
    try {
      await api("/instalaciones/" + id, "DELETE");
      navigate("/comercial/instalaciones");
    } catch (e) {
      setFalla((e as Error).message);
      setOcupado(false);
    }
  }

  return (
    <>
      <Link className="c-back" to="/comercial/instalaciones">← Instalaciones</Link>
      <Header
        eyebrow={data ? `INSTALACIÓN ${numeroInstalacion(data.number)}` : EYEBROW}
        title={data?.label ?? "Instalación"}
        subtitle={data ? `De ${data.customerName}` : ""}
        action={data ? <button className="c-secondary" onClick={() => setEditando(true)}>Editar</button> : undefined}
      />
      <ErrorBox message={error} />
      {avisos.length > 0 ? (
        <ul className="c-avisos" role="status">
          {avisos.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      ) : null}
      {data?.garantia ? <LetreroGarantia g={data.garantia} /> : null}
      {data ? (
        <div className="c-detail-grid">
          <aside className="c-card c-pad">
            <h3>Dónde y de quién</h3>
            <p>{data.address}</p>
            <p><Link className="c-link" to={`/comercial/clientes/${data.customerId}`}>{data.customerName} →</Link></p>
            <hr />
            <h3>Origen</h3>
            {data.cotizacion ? (
              <p><Link className="c-link" to={`/comercial/cotizaciones/${data.cotizacion.id}`}>Salió de la cotización {numeroCotizacion(data.cotizacion.number)} →</Link></p>
            ) : (
              <p className="c-ficha-nota">No salió de una cotización.</p>
            )}
          </aside>
          <div className="c-expediente">
            <section className="c-card c-pad">
              <h2>Qué se instaló</h2>
              <p className="c-pre">{data.description}</p>
            </section>
            <SeccionGarantias instalacion={data} alCambiar={reload} mostrarAvisos={setAvisos} />
            <section className="c-card c-pad">
              <h2>Entrega</h2>
              {data.deliveredAt ? (
                <p><strong>Entregada el {dia(data.deliveredAt)}.</strong></p>
              ) : (
                <p className="c-ficha-nota">
                  Todavía no hay fecha de entrega. De esa fecha en adelante corre la garantía, así que conviene
                  anotarla apenas se entregue; mientras no esté, el sistema no puede decir hasta cuándo dura.
                </p>
              )}
            </section>
            {data.notes ? (
              <section className="c-card c-pad">
                <h2>Notas</h2>
                <p className="c-pre">{data.notes}</p>
              </section>
            ) : null}
            <section className="c-card c-pad">
              <h2>Quitar esta instalación</h2>
              <p className="c-ficha-nota">
                Para una instalación cargada por error. No se pierde del todo: queda en el registro de actividad.
              </p>
              {quitando ? (
                <div className="c-statusbar">
                  <button className="c-primary" disabled={ocupado} onClick={quitar}>{ocupado ? "Quitando…" : "Sí, quitarla"}</button>
                  <button className="c-secondary" disabled={ocupado} onClick={() => setQuitando(false)}>No</button>
                </div>
              ) : (
                <button className="c-secondary" onClick={() => setQuitando(true)}>Quitar…</button>
              )}
              <ErrorBox message={falla} />
            </section>
          </div>
        </div>
      ) : null}
      {editando && data ? (
        <FormularioInstalacion
          inicial={data}
          alCerrar={() => setEditando(false)}
          alGuardar={(_, a) => {
            setEditando(false);
            setAvisos(a);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Cargar o corregir una instalacion.
 *
 * Al elegir cliente, si la direccion todavia esta vacia se llena con la del
 * cliente: lo normal es que la instalacion este donde vive. Se puede
 * cambiarla —un cliente con tres casas tiene tres instalaciones y tres
 * direcciones—, y una direccion ya escrita nunca se pisa.
 */
function FormularioInstalacion({
  inicial,
  alCerrar,
  alGuardar,
}: {
  inicial?: Instalacion;
  alCerrar: () => void;
  alGuardar: (i: Instalacion, avisos: string[]) => void;
}) {
  const clientes = useData<Customer[]>("/customers");
  const [customerId, setCustomerId] = useState(inicial?.customerId ?? "");
  const [label, setLabel] = useState(inicial?.label ?? "");
  const [address, setAddress] = useState(inicial?.address ?? "");
  const [description, setDescription] = useState(inicial?.description ?? "");
  const [deliveredAt, setDeliveredAt] = useState(inicial?.deliveredAt ?? "");
  const [quoteId, setQuoteId] = useState(inicial?.quoteId ?? "");
  const [notes, setNotes] = useState(inicial?.notes ?? "");
  const [falla, setFalla] = useState("");
  const [ocupado, setOcupado] = useState(false);

  // Las cotizaciones de ESE cliente, por si esta instalacion salio de una.
  const cotizaciones = useData<Quote[]>(customerId ? "/quotes?customerId=" + customerId : "");

  // Si el cliente cambia, la cotizacion elegida ya no corresponde.
  useEffect(() => {
    if (quoteId && cotizaciones.data && !cotizaciones.data.some((c) => c.id === quoteId)) setQuoteId("");
  }, [cotizaciones.data, quoteId]);

  function elegirCliente(id: string) {
    setCustomerId(id);
    const c = clientes.data?.find((x) => x.id === id);
    if (c?.address && !address.trim()) setAddress(c.address);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setFalla("");
    try {
      const cuerpo = {
        customerId,
        quoteId: quoteId || null,
        label,
        address,
        description,
        deliveredAt: deliveredAt || null,
        notes: notes.trim() || null,
      };
      const r = inicial
        ? await api<Instalacion & { avisos: string[] }>("/instalaciones/" + inicial.id, "PATCH", cuerpo)
        : await api<Instalacion & { avisos: string[] }>("/instalaciones", "POST", cuerpo);
      alGuardar(r, r.avisos ?? []);
    } catch (err) {
      setFalla((err as Error).message);
      setOcupado(false);
    }
  }

  const ordenados = [...(clientes.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, "es"));

  return (
    <Modal title={inicial ? "Editar instalación" : "Nueva instalación"} close={alCerrar}>
      <form onSubmit={guardar}>
        <div className="c-form-grid">
          <Field label="Cliente" wide>
            <select value={customerId} onChange={(e) => elegirCliente(e.target.value)} required autoFocus={!inicial}>
              <option value="">Elegí a quién pertenece…</option>
              {ordenados.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Cómo le dice el cliente" wide>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="La casa de la playa, el taller…" required maxLength={120} />
          </Field>
          <Field label="Dirección" wide>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Dónde está instalado" required maxLength={400} />
          </Field>
          <Field label="Qué se instaló" wide>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} required maxLength={4000}
              placeholder="Tablero de 12 circuitos, acometida, tomacorrientes de la cocina…" />
          </Field>
          <Field label="Fecha de entrega">
            <input type="date" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} />
          </Field>
          {customerId && (cotizaciones.data?.length ?? 0) > 0 ? (
            <Field label="¿Salió de una cotización?">
              <select value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
                <option value="">No / no sé</option>
                {cotizaciones.data!.map((c) => <option key={c.id} value={c.id}>{numeroCotizacion(c.number)}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="Notas" wide>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={4000} />
          </Field>
        </div>
        <p className="c-ficha-nota">
          Deja la fecha de entrega vacía si todavía no se entrega. Vacía no es «hoy»: el sistema la tratará como
          «sin fecha», y no inventará un día.
        </p>
        <ErrorBox message={falla || clientes.error} />
        <div className="c-actions">
          <button type="button" onClick={alCerrar}>Cancelar</button>
          <button className="c-primary" disabled={ocupado}>{ocupado ? "Guardando…" : inicial ? "Guardar cambios" : "Guardar instalación"}</button>
        </div>
      </form>
    </Modal>
  );
}
