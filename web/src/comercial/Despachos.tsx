import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, date, money, numeroFactura, type Customer, type Item } from "./api";
import { useData, ErrorBox, Field, Empty, Header } from "./piezas";
import { numeroPedido } from "./Pedidos";

/**
 * Despachos: el papel que firma quien recibe los bloques.
 *
 * Existe porque facturar y entregar son dos actos distintos. Se factura el
 * lunes y el camión sale el miércoles, o sale en tres viajes, y mientras el
 * sistema descontaba el patio al facturar, en esos días el patio decía que no
 * había bloques que estaban ahí, apilados, a la vista de todos.
 *
 * La firma y las fotos no son adorno. Cuando el cliente llama diciendo que
 * llegaron 180 y no 200, o que llegaron quebrados, lo único que queda en pie es
 * la firma de quien recibió y la foto del camión cargado.
 */

export const numeroDespacho = (n: number) => "DES-" + String(n).padStart(5, "0");

type Fila = {
  id: string; number: number; customerName: string; status: "entregado" | "anulado";
  deliveredAt: string; receivedByName: string; driverName: string | null; vehiclePlate: string | null;
  invoiceId: string | null; salesOrderId: string | null; facturaNumero: number | null;
  facturaTipo: "ccf" | "final" | null; pedidoNumero: number | null; annulReason: string | null;
  tieneFirma: boolean; bloques: number; fotos: number;
};
type Renglon = {
  id: string; catalogItemId: string | null; blockTypeId: string | null;
  invoiceLineId: string | null; description: string; quantity: number;
};
type Foto = { id: string; dataUrl: string; caption: string | null };
type Ficha = {
  id: string; number: number; customerId: string; customerName: string;
  status: "entregado" | "anulado"; deliveredAt: string;
  receivedByName: string; receivedByDocument: string | null; address: string | null;
  driverName: string | null; vehiclePlate: string | null; notes: string | null;
  signature: string | null; annulReason: string | null; annulledAt: string | null;
  renglones: Renglon[]; fotos: Foto[];
  factura: { id: string; number: number; kind: "ccf" | "final"; status: string } | null;
  pedido: { id: string; number: number; status: string } | null;
};
type PorDespachar = {
  factura: { id: string; number: number; kind: "ccf" | "final"; status: string; customerId: string; salesOrderId: string | null };
  renglones: { id: string; description: string; quantity: number; entregado: number; falta: number; blockTypeId: string | null }[];
  faltaAlgo: boolean;
};

const miles = (n: number) => n.toLocaleString("es-SV");
const Insignia = ({ estado }: { estado: "entregado" | "anulado" }) => (
  <span className={"c-badge " + (estado === "anulado" ? "rejected" : "accepted")}>
    {estado === "anulado" ? "Anulado" : "Entregado"}
  </span>
);

// --- La lista -----------------------------------------------------------------

export function Despachos() {
  const [ver, setVer] = useState<"entregado" | "todos">("entregado");
  const d = useData<Fila[]>("/despachos" + (ver === "todos" ? "" : "?estado=entregado"));
  const filas = d.data ?? [];
  return (
    <>
      <Header
        title="Despachos"
        subtitle="Lo que salió por la puerta, quién lo recibió y con qué firma."
        action={<Link className="c-primary" to="/comercial/despachos/nuevo">Nuevo despacho</Link>}
      />
      <ErrorBox message={d.error} />
      <div className="c-statusbar" style={{ marginBottom: 12 }}>
        <button className={ver === "entregado" ? "c-primary" : ""} onClick={() => setVer("entregado")}>Entregados</button>
        <button className={ver === "todos" ? "c-primary" : ""} onClick={() => setVer("todos")}>Todos</button>
      </div>
      <section className="c-card">
        {filas.length > 0 && (
          <div className="c-scroll">
            <table>
              <thead>
                <tr>
                  <th>Despacho</th><th>Cliente</th><th>Recibió</th><th>Fecha</th>
                  <th className="c-num">Bloques</th><th>Respaldo</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} style={f.status === "anulado" ? { opacity: 0.55 } : undefined}>
                    <td>
                      <Link to={"/comercial/despachos/" + f.id}><strong>{numeroDespacho(f.number)}</strong></Link>
                      {f.facturaNumero !== null && f.facturaTipo && (
                        <small>{numeroFactura(f.facturaTipo, f.facturaNumero)}</small>
                      )}
                      {f.facturaNumero === null && f.pedidoNumero !== null && (
                        <small>{numeroPedido(f.pedidoNumero)}</small>
                      )}
                    </td>
                    <td>{f.customerName}</td>
                    <td>
                      {f.receivedByName}
                      {f.vehiclePlate && <small>{f.driverName ? f.driverName + " · " : ""}{f.vehiclePlate}</small>}
                    </td>
                    <td>{date(f.deliveredAt)}</td>
                    <td className="c-num"><strong>{miles(f.bloques)}</strong></td>
                    <td>
                      {f.status === "anulado" ? (
                        <Insignia estado="anulado" />
                      ) : f.tieneFirma || f.fotos > 0 ? (
                        <span className="c-badge accepted">
                          {f.tieneFirma ? "Firmado" : ""}{f.tieneFirma && f.fotos > 0 ? " · " : ""}
                          {f.fotos > 0 ? `${f.fotos} foto${f.fotos === 1 ? "" : "s"}` : ""}
                        </span>
                      ) : (
                        <span className="c-badge rejected">Sin firma</span>
                      )}
                    </td>
                    <td><Link className="c-link" to={"/comercial/despachos/" + f.id}>Ver →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d.data && filas.length === 0 && (
          <Empty title={ver === "todos" ? "Todavía no se ha despachado nada" : "Nada entregado"}>
            Un despacho es el papel que firma quien recibe los bloques. Mientras no exista, los
            bloques facturados siguen contados en el patio, que es donde están.
          </Empty>
        )}
      </section>
    </>
  );
}

// --- La firma con el dedo ------------------------------------------------------

/**
 * Un cuadro para firmar con el dedo.
 *
 * Se dibuja en un canvas y sale como imagen. Lo importante acá es `touchAction:
 * none`: sin eso, el dedo que intenta firmar arrastra la página entera y la
 * firma queda en dos rayas sueltas.
 */
function Firma({ valor, cambiar }: { valor: string | null; cambiar: (v: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const trazando = useRef(false);
  const hubo = useRef(false);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // El canvas se dibuja en píxeles reales del teléfono: si no, la firma sale
    // con los bordes dentados en cualquier pantalla moderna.
    const escala = window.devicePixelRatio || 1;
    const ancho = c.clientWidth;
    c.width = ancho * escala;
    c.height = 180 * escala;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(escala, escala);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
  }, []);

  const punto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const empezar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    // El trazo arranca ANTES de pedir la captura del puntero. Pedirla primero
    // parecia mas prolijo y era el error: cuando el navegador la rechaza tira
    // una excepcion, y el `trazando = true` de la linea siguiente no llegaba a
    // correr. El dedo se movia por el cuadro y no pintaba nada, sin un solo
    // mensaje. La captura es una comodidad —seguir dibujando si el dedo se sale
    // del cuadro—, no un requisito para firmar.
    trazando.current = true;
    const p = punto(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // Un punto visible aunque solo toquen: una firma de un solo toque es rara,
    // pero que no pinte nada parece que el cuadro esta roto.
    ctx.lineTo(p.x + 0.1, p.y);
    ctx.stroke();
    hubo.current = true;
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura se firma igual; solo deja de seguir el dedo fuera del cuadro.
    }
  };
  const seguir = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!trazando.current) return;
    e.preventDefault();
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const p = punto(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hubo.current = true;
  };
  const soltar = () => {
    if (!trazando.current) return;
    trazando.current = false;
    if (hubo.current && ref.current) cambiar(ref.current.toDataURL("image/png"));
  };
  /** Salirse del cuadro corta el trazo, pero NO borra lo ya firmado. */
  const borrar = () => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    hubo.current = false;
    cambiar(null);
  };

  return (
    <div>
      <canvas
        ref={ref}
        onPointerDown={empezar}
        onPointerMove={seguir}
        onPointerUp={soltar}
        onPointerLeave={soltar}
        onPointerCancel={soltar}
        aria-label="Firma de quien recibe"
        style={{
          width: "100%", height: 180, border: "1px dashed var(--c-borde, #bbb)",
          borderRadius: 8, background: "#fff", touchAction: "none", display: "block", cursor: "crosshair",
        }}
      />
      <div className="c-statusbar" style={{ marginTop: 6 }}>
        <button type="button" onClick={borrar}>Borrar la firma</button>
        <span>{valor ? "Firmado." : "Que firme con el dedo acá arriba."}</span>
      </div>
    </div>
  );
}

// --- Las fotos -----------------------------------------------------------------

/**
 * Achica la foto antes de mandarla.
 *
 * Un teléfono de hoy saca fotos de cuatro megas. Mandarlas tal cual por la
 * señal de una obra es esperar un minuto por foto para que al final falle. A
 * 1200 píxeles de lado se ve perfectamente que el camión iba cargado, y pesa
 * unos cientos de kilobytes.
 */
function achicar(archivo: File): Promise<string> {
  return new Promise((listo, falla) => {
    const lector = new FileReader();
    lector.onerror = () => falla(new Error("No se pudo leer la foto."));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => falla(new Error("Ese archivo no es una foto."));
      img.onload = () => {
        const lado = 1200;
        const escala = Math.min(1, lado / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        const ctx = c.getContext("2d");
        if (!ctx) return falla(new Error("No se pudo preparar la foto."));
        ctx.drawImage(img, 0, 0, c.width, c.height);
        listo(c.toDataURL("image/jpeg", 0.72));
      };
      img.src = String(lector.result);
    };
    lector.readAsDataURL(archivo);
  });
}

const TOPE_FOTOS = 6;

function Fotos({ fotos, cambiar }: { fotos: string[]; cambiar: (f: string[]) => void }) {
  const [falla, setFalla] = useState("");
  async function agregar(lista: FileList | null) {
    if (!lista?.length) return;
    setFalla("");
    const libres = TOPE_FOTOS - fotos.length;
    if (libres <= 0) return setFalla(`No más de ${TOPE_FOTOS} fotos por despacho.`);
    try {
      const nuevas = await Promise.all([...lista].slice(0, libres).map(achicar));
      cambiar([...fotos, ...nuevas]);
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div>
      <div className="c-statusbar" style={{ flexWrap: "wrap" }}>
        <label className="c-primary" style={{ cursor: "pointer" }}>
          Agregar fotos
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            style={{ display: "none" }}
            aria-label="Fotos de la carga"
            onChange={(e) => { void agregar(e.target.files); e.target.value = ""; }}
          />
        </label>
        <span>{fotos.length === 0 ? "El camión cargado, la guía, lo que haga falta." : `${fotos.length} de ${TOPE_FOTOS}.`}</span>
      </div>
      <ErrorBox message={falla} />
      {fotos.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {fotos.map((f, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={f} alt={`Foto ${i + 1}`} style={{ width: 92, height: 92, objectFit: "cover", borderRadius: 8 }} />
              <button
                type="button"
                aria-label={`Quitar la foto ${i + 1}`}
                onClick={() => cambiar(fotos.filter((_, j) => j !== i))}
                style={{
                  position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: "50%",
                  border: "none", background: "#b00", color: "#fff", cursor: "pointer", lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Despachar -----------------------------------------------------------------

type RenglonForm = { clave: string; etiqueta: string; falta: number | null; cantidad: string; invoiceLineId?: string; catalogItemId?: string };

export function DespachoNuevo() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const facturaId = params.get("factura") ?? "";
  const clienteParam = params.get("cliente") ?? "";

  const pend = useData<PorDespachar>(facturaId ? `/invoices/${facturaId}/por-despachar` : "");
  const clientes = useData<Customer[]>(facturaId ? "" : "/customers");
  const items = useData<Item[]>(facturaId ? "" : "/catalog-items");

  const [clienteId, setClienteId] = useState(clienteParam);
  const [recibe, setRecibe] = useState("");
  const [documento, setDocumento] = useState("");
  const [direccion, setDireccion] = useState("");
  const [chofer, setChofer] = useState("");
  const [placa, setPlaca] = useState("");
  const [notas, setNotas] = useState("");
  const [firma, setFirma] = useState<string | null>(null);
  const [fotos, setFotos] = useState<string[]>([]);
  const [renglones, setRenglones] = useState<RenglonForm[]>([]);
  const [busy, setBusy] = useState(false);
  const [falla, setFalla] = useState("");

  // Lo que falta de la factura entra solo, ya con la cantidad puesta: el caso
  // común es «sale todo lo que falta», y no hay que teclear nada.
  useEffect(() => {
    if (!pend.data) return;
    setRenglones(
      pend.data.renglones
        .filter((r) => r.falta > 0)
        .map((r) => ({
          clave: r.id,
          etiqueta: r.description,
          falta: r.falta,
          cantidad: String(r.falta),
          invoiceLineId: r.id,
        })),
    );
  }, [pend.data]);

  // Sin factura se arma a mano, producto por producto.
  const sueltos = items.data ?? [];
  function agregarSuelto(catalogItemId: string) {
    const it = sueltos.find((i) => i.id === catalogItemId);
    if (!it) return;
    setRenglones((r) => [
      ...r,
      { clave: it.id + ":" + r.length, etiqueta: it.name, falta: null, cantidad: "", catalogItemId: it.id },
    ]);
  }

  const total = renglones.reduce((a, r) => a + (Number(r.cantidad) || 0), 0);
  const hayCantidades = renglones.some((r) => Number(r.cantidad) > 0);
  const sobrepasa = renglones.some((r) => r.falta !== null && Number(r.cantidad) > r.falta);
  const listo = recibe.trim().length >= 2 && hayCantidades && !sobrepasa;

  async function entregar(e: FormEvent) {
    e.preventDefault();
    if (!listo || busy) return;
    setBusy(true);
    setFalla("");
    try {
      const creado = await api<{ id: string }>("/despachos", "POST", {
        ...(facturaId ? { invoiceId: facturaId } : { customerId: clienteId }),
        receivedByName: recibe.trim(),
        ...(documento.trim() ? { receivedByDocument: documento.trim() } : {}),
        ...(direccion.trim() ? { address: direccion.trim() } : {}),
        ...(chofer.trim() ? { driverName: chofer.trim() } : {}),
        ...(placa.trim() ? { vehiclePlate: placa.trim() } : {}),
        ...(notas.trim() ? { notes: notas.trim() } : {}),
        ...(firma ? { signature: firma } : {}),
        ...(fotos.length ? { fotos: fotos.map((dataUrl) => ({ dataUrl })) } : {}),
        lines: renglones
          .filter((r) => Number(r.cantidad) > 0)
          .map((r) => ({
            ...(r.invoiceLineId ? { invoiceLineId: r.invoiceLineId } : {}),
            ...(r.catalogItemId ? { catalogItemId: r.catalogItemId } : {}),
            quantity: Number(r.cantidad),
          })),
      });
      navigate("/comercial/despachos/" + creado.id, { replace: true });
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const f = pend.data?.factura;

  return (
    <form onSubmit={entregar}>
      <Link className="c-back" to={facturaId ? "/comercial/facturas/" + facturaId : "/comercial/despachos"}>
        ← {facturaId ? "Volver a la factura" : "Despachos"}
      </Link>
      <Header
        title="Nuevo despacho"
        subtitle={
          f
            ? `Lo que sale hoy contra ${numeroFactura(f.kind, f.number)}. Lo que quede se despacha en otro viaje.`
            : "Lo que sale por la puerta, con la firma de quien lo recibe."
        }
      />
      <ErrorBox message={falla || pend.error || clientes.error || items.error} />

      {!facturaId && (
        <section className="c-card c-pad">
          <Field label="Cliente">
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} aria-label="Cliente">
              <option value="">— elegí el cliente —</option>
              {(clientes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Qué sale">
            <select value="" aria-label="Agregar producto" onChange={(e) => { agregarSuelto(e.target.value); e.target.value = ""; }}>
              <option value="">— agregar un producto —</option>
              {sueltos.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </Field>
        </section>
      )}

      <section className="c-card c-pad">
        <h2>Lo que sale</h2>
        {renglones.length === 0 ? (
          <Empty title="Nada por despachar">
            {facturaId
              ? "Esta factura ya se entregó completa. Si hace falta entregar más, hace falta otra factura."
              : "Elegí arriba qué productos salen en este viaje."}
          </Empty>
        ) : (
          <div className="c-scroll">
            <table>
              <thead>
                <tr><th>Producto</th><th className="c-num">Falta</th><th className="c-num">Sale hoy</th><th></th></tr>
              </thead>
              <tbody>
                {renglones.map((r, i) => {
                  const n = Number(r.cantidad) || 0;
                  const demas = r.falta !== null && n > r.falta;
                  return (
                    <tr key={r.clave}>
                      <td>{r.etiqueta}</td>
                      <td className="c-num">{r.falta === null ? "—" : miles(r.falta)}</td>
                      <td className="c-num">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={r.cantidad}
                          aria-label={"Cantidad " + (i + 1)}
                          style={{ width: 110, textAlign: "right", ...(demas ? { borderColor: "#b00" } : {}) }}
                          onChange={(e) =>
                            setRenglones((lista) => lista.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))
                          }
                        />
                        {demas && <small style={{ color: "#b00" }}>De eso solo faltan {miles(r.falta!)}</small>}
                      </td>
                      <td>
                        {r.falta === null && (
                          <button type="button" onClick={() => setRenglones((l) => l.filter((_, j) => j !== i))}>Quitar</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && <p className="c-pre" style={{ marginTop: 8 }}><strong>{miles(total)}</strong> en total.</p>}
      </section>

      <section className="c-card c-pad">
        <h2>Quién recibe</h2>
        <div className="c-form-grid">
          <Field label="Nombre de quien recibe">
            <input value={recibe} onChange={(e) => setRecibe(e.target.value)} placeholder="Maura, la maestra de obra" aria-label="Nombre de quien recibe" />
          </Field>
          <Field label="Su documento (opcional)">
            <input value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="DUI" aria-label="Documento de quien recibe" />
          </Field>
          <Field label="Dónde se entregó" wide>
            <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Lotificación El Níspero, lote 12" aria-label="Dirección de entrega" />
          </Field>
          <Field label="Quién lo llevó">
            <input value={chofer} onChange={(e) => setChofer(e.target.value)} placeholder="Chepe" aria-label="Chofer" />
          </Field>
          <Field label="Placa">
            <input value={placa} onChange={(e) => setPlaca(e.target.value)} placeholder="P 123-456" aria-label="Placa" />
          </Field>
          <Field label="Notas" wide>
            <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Se descargó en la esquina, no entró el camión." aria-label="Notas" />
          </Field>
        </div>
      </section>

      <section className="c-card c-pad">
        <h2>Firma</h2>
        <Firma valor={firma} cambiar={setFirma} />
      </section>

      <section className="c-card c-pad">
        <h2>Fotos</h2>
        <Fotos fotos={fotos} cambiar={setFotos} />
      </section>

      <div className="c-statusbar" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <button type="submit" className="c-primary" disabled={!listo || busy}>
          {busy ? "Guardando…" : "Registrar la entrega"}
        </button>
        {!firma && hayCantidades && (
          <span>Sin firma queda igual, pero después no hay con qué responderle a un reclamo.</span>
        )}
        {sobrepasa && <span style={{ color: "#b00" }}>Hay un renglón donde sale más de lo que falta.</span>}
      </div>
    </form>
  );
}

// --- La ficha ------------------------------------------------------------------

export function FichaDespacho() {
  const { id } = useParams();
  const d = useData<Ficha>("/despachos/" + id);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [falla, setFalla] = useState("");
  const [viendo, setViendo] = useState<string | null>(null);

  const x = d.data;

  async function anular() {
    if (motivo.trim().length < 3 || busy) return;
    setBusy(true);
    setFalla("");
    try {
      await api(`/despachos/${id}/anular`, "POST", { reason: motivo.trim() });
      setAnulando(false);
      setMotivo("");
      d.reload();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!x) return <><Link className="c-back" to="/comercial/despachos">← Despachos</Link><ErrorBox message={d.error} /></>;

  const total = x.renglones.reduce((a, r) => a + r.quantity, 0);

  return (
    <>
      <div className="c-no-print">
        <Link className="c-back" to="/comercial/despachos">← Despachos</Link>
        <Header
          title={numeroDespacho(x.number)}
          subtitle={`Entregado a ${x.customerName} el ${date(x.deliveredAt)}.`}
          action={<button className="c-primary" onClick={() => window.print()}>Imprimir / guardar PDF</button>}
        />
        <div className="c-statusbar" style={{ flexWrap: "wrap" }}>
          <Insignia estado={x.status} />
          {x.factura && (
            <Link className="c-link" to={"/comercial/facturas/" + x.factura.id}>
              {numeroFactura(x.factura.kind, x.factura.number)} →
            </Link>
          )}
          {x.pedido && (
            <Link className="c-link" to={"/comercial/pedidos/" + x.pedido.id}>{numeroPedido(x.pedido.number)} →</Link>
          )}
          {x.status === "entregado" &&
            (anulando ? (
              <span className="c-confirmar">
                <input
                  aria-label="Motivo de la anulación"
                  placeholder="¿Por qué se anula?"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
                <button disabled={busy || motivo.trim().length < 3} onClick={anular}>Anular</button>
                <button disabled={busy} onClick={() => { setAnulando(false); setMotivo(""); }}>No</button>
              </span>
            ) : (
              <button onClick={() => setAnulando(true)}>Anular</button>
            ))}
        </div>
        <ErrorBox message={falla || d.error} />
        {x.status === "anulado" && (
          <div className="c-error" role="alert">
            <strong>Anulado.</strong> {x.annulReason} · Los bloques volvieron al patio y el número no se reusa.
          </div>
        )}
      </div>

      <section className="c-card c-pad">
        <h2>Lo que salió</h2>
        <div className="c-scroll">
          <table>
            <thead><tr><th>Producto</th><th className="c-num">Cantidad</th></tr></thead>
            <tbody>
              {x.renglones.map((r) => (
                <tr key={r.id}>
                  <td>{r.description}{!r.blockTypeId && <small>No mueve el patio</small>}</td>
                  <td className="c-num"><strong>{miles(r.quantity)}</strong></td>
                </tr>
              ))}
              <tr><td><strong>Total</strong></td><td className="c-num"><strong>{miles(total)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="c-card c-pad">
        <h2>Quién recibió</h2>
        <p><strong>{x.receivedByName}</strong>{x.receivedByDocument ? ` · ${x.receivedByDocument}` : ""}</p>
        {x.address && <p>{x.address}</p>}
        {(x.driverName || x.vehiclePlate) && (
          <p>Lo llevó {x.driverName || "—"}{x.vehiclePlate ? ` · ${x.vehiclePlate}` : ""}</p>
        )}
        {x.notes && <p className="c-pre">{x.notes}</p>}
        {x.signature ? (
          <>
            <h3 style={{ marginTop: 18 }}>Firma</h3>
            <img src={x.signature} alt="Firma de quien recibió" style={{ maxWidth: 360, width: "100%", background: "#fff", borderRadius: 8 }} />
          </>
        ) : (
          <p className="c-ficha-nota">
            Este despacho quedó sin firma. Si el cliente reclama que llegaron menos, no hay con qué responderle.
          </p>
        )}
      </section>

      {x.fotos.length > 0 && (
        <section className="c-card c-pad">
          <h2>Fotos</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {x.fotos.map((f) => (
              <figure key={f.id} style={{ margin: 0 }}>
                <img
                  src={f.dataUrl}
                  alt={f.caption ?? "Foto de la entrega"}
                  onClick={() => setViendo(f.dataUrl)}
                  style={{ width: 150, height: 150, objectFit: "cover", borderRadius: 8, cursor: "zoom-in" }}
                />
                {f.caption && <figcaption className="c-pre">{f.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </section>
      )}

      {viendo && (
        <div
          className="c-overlay"
          onClick={() => setViendo(null)}
          role="dialog"
          aria-label="Foto de la entrega"
          style={{ cursor: "zoom-out" }}
        >
          <img src={viendo} alt="Foto de la entrega" style={{ maxWidth: "92vw", maxHeight: "88vh", borderRadius: 8 }} />
        </div>
      )}
    </>
  );
}

/**
 * El botón de despachar que vive en la ficha de la factura.
 *
 * Dice de una sola mirada si falta entregar algo y cuánto, porque es la
 * pregunta que se hace quien abre una factura vieja: «¿esto ya salió?».
 */
export function Despachar({ facturaId }: { facturaId: string }) {
  const d = useData<PorDespachar>(`/invoices/${facturaId}/por-despachar`);
  const entregas = useData<Fila[]>(`/despachos?invoiceId=${facturaId}`);
  const vivos = (entregas.data ?? []).filter((x) => x.status === "entregado");
  if (!d.data) return null;
  const falta = d.data.renglones.reduce((a, r) => a + Math.max(0, r.falta), 0);
  return (
    <>
      {vivos.map((x) => (
        <Link key={x.id} className="c-link" to={"/comercial/despachos/" + x.id}>
          {numeroDespacho(x.number)} →
        </Link>
      ))}
      {falta > 0 ? (
        <Link className="c-primary" to={"/comercial/despachos/nuevo?factura=" + facturaId}>
          {vivos.length ? `Despachar lo que falta (${miles(falta)})` : `Despachar (${miles(falta)})`}
        </Link>
      ) : (
        <span className="c-badge accepted">Entregado</span>
      )}
    </>
  );
}
