import { useState } from "react";
import { api } from "../api";
import { useApi } from "../usar";
import { Campo, Cargando, Fallo, IconoAviso, IconoInfo } from "../comp/piezas";

/**
 * Quién entra al sistema, y con qué permiso.
 *
 * El login se puso antes que esta pantalla, y durante un rato el sistema
 * quedó en una posición incómoda: la puerta cerrada y ninguna forma de dar
 * llaves sin pedírselo a quien tiene la base en la mano. Esto lo resuelve.
 *
 * Es solo para dueñas. El servidor ya lo exige por su cuenta —esta pantalla
 * no es la que protege nada—, pero se esconde del menú para no ofrecerle a un
 * empleado una puerta que le va a dar 403.
 */

type Rol = "owner" | "staff" | "viewer";

type Cuenta = {
  id: string;
  name: string;
  email: string;
  role: Rol;
  active: boolean;
  tienePin: boolean;
  trabadaHasta: string | null;
  deletedAt: string | null;
};

const ROLES: { id: Rol; nombre: string; explica: string }[] = [
  { id: "owner", nombre: "Dueña", explica: "Ve y hace todo, incluidas las cuentas, el crédito y los precios acordados." },
  { id: "staff", nombre: "Empleado", explica: "Trabaja en el día a día, pero no toca crédito, precios acordados ni cuentas." },
  { id: "viewer", nombre: "Solo lectura", explica: "Ve todo y no cambia nada. Sirve para el contador." },
];

const nombreRol = (r: Rol) => ROLES.find((x) => x.id === r)?.nombre ?? r;

export default function Cuentas({ yo }: { yo: { id: string; role: Rol } }) {
  const { dato, error, cargando, recargar } = useApi<Cuenta[]>("/users?includeInactive=true");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  if (yo.role !== "owner") {
    return (
      <main className="lienzo">
        <h1 className="titulo">Cuentas</h1>
        <div className="aviso neutro">
          <IconoInfo color="var(--apagado)" />
          <span>Las cuentas las administra una dueña. Pedile a ella que te dé o te cambie el acceso.</span>
        </div>
      </main>
    );
  }

  if (cargando) return <main className="lienzo"><Cargando que="las cuentas" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;

  const cuentas = (dato ?? []).filter((c) => !c.deletedAt);
  const duenasActivas = cuentas.filter((c) => c.role === "owner" && c.active).length;

  async function guardar(promesa: Promise<unknown>, mensaje: string) {
    try {
      await promesa;
      setAviso(mensaje);
      setAbierta(null);
      setCreando(false);
      recargar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="lienzo">
      <div className="fila" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <h1 className="titulo" style={{ marginBottom: 0 }}>Cuentas</h1>
        <button type="button" className="boton" onClick={() => { setCreando(true); setAbierta(null); }}>
          Crear una cuenta
        </button>
      </div>

      <p style={{ color: "var(--apagado)", maxWidth: "62ch", marginTop: 10 }}>
        Quien trabaja en la planta entra tocando su nombre y marcando un PIN; para eso hay que
        darle uno acá. Quien trabaja desde la oficina entra con su correo y su contraseña.
      </p>

      {aviso && (
        <div className="aviso neutro" style={{ marginTop: 14 }}>
          <IconoInfo color="var(--apagado)" />
          <span>{aviso}</span>
        </div>
      )}

      {creando && (
        <Formulario
          titulo="Cuenta nueva"
          onCancelar={() => setCreando(false)}
          onGuardar={(cuerpo) => guardar(api.post("/users", cuerpo), `Cuenta de ${cuerpo.name} creada.`)}
        />
      )}

      <div className="tarjeta envoltura-tabla" style={{ marginTop: 16 }}>
        <table className="tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Permiso</th>
              <th>Entra por</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cuentas.map((c) => {
              const trabada = c.trabadaHasta && new Date(c.trabadaHasta) > new Date();
              return (
                <tr key={c.id} style={c.active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.id === yo.id && <span className="insignia" style={{ marginLeft: 8 }}>vos</span>}
                    {!c.active && <div className="mono" style={{ fontSize: 12, color: "var(--apagado)" }}>desactivada</div>}
                    {trabada && (
                      <div style={{ fontSize: 12, color: "var(--ambar)", display: "flex", gap: 5, alignItems: "center", marginTop: 3 }}>
                        <IconoAviso color="var(--ambar)" size={13} /> trabada por intentos fallidos
                      </div>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 13 }}>{c.email}</td>
                  <td>{nombreRol(c.role)}</td>
                  <td>{c.tienePin ? "Correo o PIN" : "Correo"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {trabada && (
                      <button
                        type="button"
                        className="boton hueco"
                        style={{ marginRight: 6 }}
                        onClick={() => guardar(api.patch(`/users/${c.id}`, { destrabar: true }), `${c.name} puede volver a entrar.`)}
                      >
                        Destrabar
                      </button>
                    )}
                    <button type="button" className="boton hueco" onClick={() => { setAbierta(abierta === c.id ? null : c.id); setCreando(false); }}>
                      {abierta === c.id ? "Cerrar" : "Cambiar"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {abierta && (() => {
        const c = cuentas.find((x) => x.id === abierta);
        if (!c) return null;
        const ultimaDuena = c.role === "owner" && c.active && duenasActivas === 1;
        return (
          <Formulario
            titulo={`Cambiar a ${c.name}`}
            cuenta={c}
            esYo={c.id === yo.id}
            ultimaDuena={ultimaDuena}
            onCancelar={() => setAbierta(null)}
            onGuardar={(cuerpo) => guardar(api.patch(`/users/${c.id}`, cuerpo), `Cuenta de ${c.name} actualizada.`)}
          />
        );
      })()}
    </main>
  );
}

type Cuerpo = {
  name: string;
  email: string;
  role: Rol;
  password?: string;
  pin?: string | null;
  active?: boolean;
};

function Formulario({
  titulo,
  cuenta,
  esYo,
  ultimaDuena,
  onGuardar,
  onCancelar,
}: {
  titulo: string;
  cuenta?: Cuenta;
  esYo?: boolean;
  ultimaDuena?: boolean;
  onGuardar: (cuerpo: Cuerpo) => void;
  onCancelar: () => void;
}) {
  const [name, setName] = useState(cuenta?.name ?? "");
  const [email, setEmail] = useState(cuenta?.email ?? "");
  const [role, setRole] = useState<Rol>(cuenta?.role ?? "staff");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [quitarPin, setQuitarPin] = useState(false);
  const [active, setActive] = useState(cuenta?.active ?? true);

  const editando = Boolean(cuenta);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const cuerpo: Cuerpo = { name: name.trim(), email: email.trim(), role };
    if (password) cuerpo.password = password;
    if (quitarPin) cuerpo.pin = null;
    else if (pin) cuerpo.pin = pin;
    if (editando) cuerpo.active = active;
    onGuardar(cuerpo);
  }

  return (
    <form className="tarjeta pila" style={{ gap: 14, marginTop: 16, maxWidth: 520 }} onSubmit={enviar}>
      <strong>{titulo}</strong>

      <Campo etiqueta="Nombre">
        <input className="entrada" aria-label="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
      </Campo>

      <Campo etiqueta="Correo" ayuda="Es el usuario con el que entra. El sistema no le manda ningún correo.">
        <input className="entrada" aria-label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Campo>

      <Campo etiqueta="Permiso" ayuda={ROLES.find((r) => r.id === role)?.explica}>
        <select
          className="entrada"
          aria-label="Permiso"
          value={role}
          onChange={(e) => setRole(e.target.value as Rol)}
          disabled={ultimaDuena}
        >
          {ROLES.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
      </Campo>

      {ultimaDuena && (
        <div className="aviso neutro">
          <IconoAviso color="var(--ambar)" />
          <span>
            Es la única dueña activa. Si le quitás el permiso no va a quedar nadie que pueda
            administrar las cuentas: nombrá antes a otra.
          </span>
        </div>
      )}

      <Campo
        etiqueta={editando ? "Contraseña nueva" : "Contraseña"}
        ayuda={
          editando
            ? "Dejala vacía para no cambiarla. Al menos 8 caracteres."
            : "Al menos 8 caracteres. Se la vas a tener que decir vos; el sistema no la manda."
        }
      >
        <input
          className="entrada"
          aria-label={editando ? "Contraseña nueva" : "Contraseña"}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={!editando}
          minLength={8}
        />
      </Campo>

      <Campo
        etiqueta="PIN de planta"
        ayuda="De 4 a 8 dígitos. Solo quien lo tiene aparece en la lista de la tablet de la planta. Dejalo vacío para no tocarlo."
      >
        <input
          className="entrada"
          aria-label="PIN de planta"
          inputMode="numeric"
          pattern="\d*"
          value={pin}
          onChange={(e) => { setPin(e.target.value); setQuitarPin(false); }}
          disabled={quitarPin}
          placeholder={cuenta?.tienePin ? "tiene PIN puesto" : "sin PIN"}
        />
      </Campo>

      {cuenta?.tienePin && (
        <label className="fila" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" aria-label="Quitarle el PIN" checked={quitarPin} onChange={(e) => setQuitarPin(e.target.checked)} />
          <span>Quitarle el PIN (deja de aparecer en la tablet de la planta)</span>
        </label>
      )}

      {editando && !esYo && (
        <label className="fila" style={{ gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            aria-label="Desactivar la cuenta"
            checked={!active}
            disabled={ultimaDuena}
            onChange={(e) => setActive(!e.target.checked)}
          />
          <span>Desactivar la cuenta (no entra más, y no se borra nada de lo que hizo)</span>
        </label>
      )}

      {editando && esYo && (
        <div className="aviso neutro">
          <IconoInfo color="var(--apagado)" />
          <span>Es tu propia cuenta: no te podés desactivar vos misma.</span>
        </div>
      )}

      <div className="fila" style={{ gap: 8 }}>
        <button type="submit" className="boton">Guardar</button>
        <button type="button" className="boton hueco" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
