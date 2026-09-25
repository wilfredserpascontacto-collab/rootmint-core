import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Comercial from "./comercial/Comercial";
import Lotes from "./pantallas/Lotes";
import FichaLote from "./pantallas/FichaLote";
import Planta from "./pantallas/Planta";
import Recetas from "./pantallas/Recetas";
import Receta from "./pantallas/Receta";
import Mantenimiento from "./pantallas/Mantenimiento";
import Ajustes from "./pantallas/Ajustes";
import Catalogo from "./pantallas/Catalogo";
import Telemetria from "./comp/Telemetria";
import Acceso from "./acceso/Acceso";
import { NOMBRE_ROL, salir, useSesion } from "./acceso/sesion";

export default function App() {
  const location = useLocation();
  const { estado, revisar } = useSesion();

  /**
   * Nada se pinta antes de saber quién está adentro.
   *
   * Ni siquiera un esqueleto de la aplicación: si se mostrara la pantalla y
   * los datos llegaran después, cada recarga daría un parpadeo con la forma
   * del sistema para quien no tiene por qué verla. Se espera, y se espera
   * poco: es una sola pregunta al servidor.
   */
  if (estado.fase === "mirando") return <div className="cargando">Un momento…</div>;
  if (estado.fase === "afuera") return <Acceso alEntrar={() => void revisar()} />;

  const quien = <Quien persona={estado.persona} alSalir={() => void revisar()} />;

  if (location.pathname.startsWith("/comercial")) {
    return <Routes><Route path="/comercial/*" element={<Comercial quien={quien} />} /></Routes>;
  }
  return (
    <div className="app">
      <header className="barra">
        <div className="fila" style={{ gap: 16, alignItems: "baseline" }}>
          <NavLink to="/lotes" className="marca">BLOQUESTITÁN</NavLink>
          <span className="cond" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ambar)" }}>
            Control de producción
          </span>
        </div>
        <nav className="nav">
          <NavLink to="/comercial">Comercial</NavLink>
          <NavLink to="/lotes" className={({ isActive }) => (isActive ? "activo" : "")}>Lotes</NavLink>
          <NavLink to="/planta" className={({ isActive }) => (isActive ? "activo" : "")}>Planta</NavLink>
          <NavLink to="/recetas" className={({ isActive }) => (isActive ? "activo" : "")}>Recetas</NavLink>
          <NavLink to="/mantenimiento" className={({ isActive }) => (isActive ? "activo" : "")}>Mantenimiento</NavLink>
          <NavLink to="/catalogo" className={({ isActive }) => (isActive ? "activo" : "")}>Catálogo</NavLink>
          <NavLink to="/ajustes" className={({ isActive }) => (isActive ? "activo" : "")}>Ajustes</NavLink>
        </nav>
        {quien}
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/lotes" replace />} />
        <Route path="/lotes" element={<Lotes />} />
        <Route path="/lotes/:id" element={<FichaLote />} />
        <Route path="/planta" element={<Planta />} />
        <Route path="/recetas" element={<Recetas />} />
        <Route path="/recetas/:id" element={<Receta />} />
        <Route path="/mantenimiento" element={<Mantenimiento />} />
        <Route path="/catalogo" element={<Catalogo />} />
        <Route path="/ajustes" element={<Ajustes />} />
        <Route path="*" element={<div className="vacio">Esa pantalla no existe.</div>} />
      </Routes>

      <Telemetria />
    </div>
  );
}

/** Quién está adentro y cómo salir. Va arriba a la derecha, en toda pantalla. */
function Quien({
  persona,
  alSalir,
}: {
  persona: { name: string; role: "owner" | "staff" | "viewer" };
  alSalir: () => void;
}) {
  return (
    <div className="quien">
      <span>
        <strong>{persona.name}</strong> · {NOMBRE_ROL[persona.role]}
      </span>
      <button
        type="button"
        onClick={async () => {
          await salir().catch(() => {});
          alSalir();
        }}
      >
        Salir
      </button>
    </div>
  );
}
