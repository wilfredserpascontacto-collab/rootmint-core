import { useEffect, useState } from "react";
import {
  crearPrimeraDuena,
  entrar,
  entrarConPin,
  gentePlanta,
  hayAlguien,
} from "./sesion";
import "./acceso.css";

/**
 * La pantalla de entrada.
 *
 * Tiene dos puertas porque hay dos situaciones distintas. En Miami se entra
 * desde un teléfono propio, con correo y contraseña. En la planta hay una
 * tablet que pasa de mano en mano: ahí se toca el nombre y se marca un PIN.
 * Obligar a la planta a teclear un correo largo con las manos llenas de
 * mezcla es la forma más segura de que todos terminen usando la sesión del
 * primero que la abrió, que es justo lo contrario de lo que esto busca.
 */
export default function Acceso({ alEntrar }: { alEntrar: () => void }) {
  const [puerta, setPuerta] = useState<"oficina" | "planta">("oficina");
  const [vacio, setVacio] = useState<boolean | null>(null);
  // Mientras no se sepa, no se muestra nada de Titan ni de nadie: el nombre
  // llega del servidor con la misma respuesta que dice si hay dueña.
  const [marca, setMarca] = useState({ marca: "", subtitulo: "", planta: true });

  useEffect(() => {
    void hayAlguien()
      .then((r) => {
        setVacio(!r.hayAlguien);
        setMarca({ marca: r.marca, subtitulo: r.subtitulo, planta: r.planta });
        if (r.marca) document.title = r.marca;
      })
      .catch(() => setVacio(false));
  }, []);

  return (
    <div className="acceso">
      <div className="acceso-caja">
        <div className="acceso-marca">
          <span className="acceso-logo">▥</span>
          <div>
            <div className="acceso-titulo">{marca.marca}</div>
            {marca.subtitulo ? <div className="acceso-sub">{marca.subtitulo}</div> : null}
          </div>
        </div>

        {vacio === null ? (
          <p className="acceso-espera">Un momento…</p>
        ) : vacio ? (
          <PrimeraDuena alEntrar={alEntrar} />
        ) : (
          <>
            {/* La puerta de la planta solo existe si este sistema tiene planta. */}
            {marca.planta ? <div className="acceso-puertas" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={puerta === "oficina"}
                className={puerta === "oficina" ? "activa" : ""}
                onClick={() => setPuerta("oficina")}
              >
                Oficina
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={puerta === "planta"}
                className={puerta === "planta" ? "activa" : ""}
                onClick={() => setPuerta("planta")}
              >
                Planta
              </button>
            </div> : null}
            {puerta === "oficina" || !marca.planta ? <Oficina alEntrar={alEntrar} /> : <Planta alEntrar={alEntrar} />}
          </>
        )}
      </div>
      <p className="acceso-pie">Tecnología de RootMint</p>
    </div>
  );
}

function Oficina({ alEntrar }: { alEntrar: () => void }) {
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [yendo, setYendo] = useState(false);

  async function mandar(e: React.FormEvent) {
    e.preventDefault();
    if (yendo) return;
    setYendo(true);
    setError(null);
    try {
      await entrar(email.trim(), clave);
      alEntrar();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setClave("");
    } finally {
      setYendo(false);
    }
  }

  return (
    <form onSubmit={mandar} className="acceso-forma">
      <label className="lbl">
        Correo
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
      </label>
      <label className="lbl">
        Contraseña
        <input
          type="password"
          autoComplete="current-password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          required
        />
      </label>
      {error && <p className="acceso-error">{error}</p>}
      <button type="submit" className="boton acceso-boton" disabled={yendo}>
        {yendo ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

function Planta({ alEntrar }: { alEntrar: () => void }) {
  const [gente, setGente] = useState<{ id: string; name: string }[] | null>(null);
  const [quien, setQuien] = useState<{ id: string; name: string } | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [yendo, setYendo] = useState(false);

  useEffect(() => {
    void gentePlanta()
      .then(setGente)
      .catch(() => setGente([]));
  }, []);

  async function probar(marcado: string) {
    if (!quien || yendo) return;
    setYendo(true);
    setError(null);
    try {
      await entrarConPin(quien.id, marcado);
      alEntrar();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPin("");
    } finally {
      setYendo(false);
    }
  }

  function marcar(d: string) {
    if (yendo) return;
    const nuevo = (pin + d).slice(0, 8);
    setPin(nuevo);
    setError(null);
    // Cuatro dígitos es el PIN más corto que se permite: se prueba solo, sin
    // pedir además que toquen un botón de confirmar.
    if (nuevo.length === 4) void probar(nuevo);
  }

  if (gente === null) return <p className="acceso-espera">Un momento…</p>;

  if (gente.length === 0) {
    return (
      <p className="acceso-nota">
        Todavía no hay nadie con PIN de planta. Una dueña los da de alta desde Ajustes, en Cuentas.
      </p>
    );
  }

  if (!quien) {
    return (
      <div className="acceso-gente">
        <p className="acceso-nota">¿Quién sos?</p>
        {gente.map((p) => (
          <button key={p.id} type="button" className="acceso-persona" onClick={() => setQuien(p)}>
            {p.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="acceso-pin">
      <button type="button" className="acceso-volver" onClick={() => { setQuien(null); setPin(""); setError(null); }}>
        ‹ No soy {quien.name.split(" ")[0]}
      </button>
      <p className="acceso-nota">Marcá tu PIN</p>
      <div className="acceso-puntos" aria-label={`${pin.length} dígitos marcados`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < pin.length ? "lleno" : ""} />
        ))}
      </div>
      {error && <p className="acceso-error">{error}</p>}
      <div className="acceso-teclado">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" onClick={() => marcar(d)} disabled={yendo}>
            {d}
          </button>
        ))}
        <button type="button" className="acceso-tenue" onClick={() => setPin("")} disabled={yendo}>
          Borrar
        </button>
        <button type="button" onClick={() => marcar("0")} disabled={yendo}>
          0
        </button>
        <button
          type="button"
          className="acceso-tenue"
          onClick={() => void probar(pin)}
          disabled={yendo || pin.length < 4}
        >
          Entrar
        </button>
      </div>
    </div>
  );
}

/**
 * Sólo aparece mientras no existe ninguna cuenta, y desaparece para siempre
 * en cuanto se crea la primera. Es la única forma de entrar la primera vez
 * sin dejar una contraseña escrita en el código o en una variable.
 */
function PrimeraDuena({ alEntrar }: { alEntrar: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [yendo, setYendo] = useState(false);

  async function mandar(e: React.FormEvent) {
    e.preventDefault();
    if (yendo) return;
    setYendo(true);
    setError(null);
    try {
      await crearPrimeraDuena(name.trim(), email.trim(), clave);
      alEntrar();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setYendo(false);
    }
  }

  return (
    <form onSubmit={mandar} className="acceso-forma">
      <p className="acceso-nota">
        No hay ninguna cuenta todavía. Creá la primera: va a ser dueña, y desde ella se crean
        todas las demás.
      </p>
      <label className="lbl">
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </label>
      <label className="lbl">
        Correo
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="lbl">
        Contraseña
        <input
          type="password"
          autoComplete="new-password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          required
          minLength={8}
        />
        <span className="acceso-ayuda">Al menos 8 caracteres.</span>
      </label>
      {error && <p className="acceso-error">{error}</p>}
      <button type="submit" className="boton acceso-boton" disabled={yendo}>
        {yendo ? "Creando…" : "Crear la cuenta y entrar"}
      </button>
    </form>
  );
}
