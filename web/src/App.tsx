import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Comercial from "./comercial/Comercial";
import Lotes from "./pantallas/Lotes";
import FichaLote from "./pantallas/FichaLote";
import Planta from "./pantallas/Planta";
import Ordenes, { FichaOrden } from "./pantallas/Ordenes";
import Recetas from "./pantallas/Recetas";
import Receta from "./pantallas/Receta";
import Mantenimiento from "./pantallas/Mantenimiento";
import Ajustes from "./pantallas/Ajustes";
import Catalogo from "./pantallas/Catalogo";
import Cuentas from "./pantallas/Cuentas";
import Telemetria from "./comp/Telemetria";
import Acceso from "./acceso/Acceso";
import { NOMBRE_ROL, salir, useSesion } from "./acceso/sesion";
import { ProveedorModulos } from "./acceso/modulos";

export default function App() {
  const location = useLocation();
  const { estado, revisar } = useSesion();

  // El titulo de la pestaña es el nombre de este sistema, no el de un cliente.
  const marca = estado.fase === "adentro" ? estado.persona.marca : "";
  useEffect(() => {
    if (marca) document.title = marca;
  }, [marca]);

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

  const p = estado.persona;
  const planta = p.modulos.includes("bloques");
  const comercial = p.modulos.includes("comercial");

  if (comercial && location.pathname.startsWith("/comercial")) {
    return (
      <ProveedorModulos persona={p}>
        <Routes><Route path="/comercial/*" element={<Comercial quien={quien} />} /></Routes>
      </ProveedorModulos>
    );
  }

  /**
   * Un despliegue sin planta no tiene ninguna de estas pantallas: lo unico que
   * queda fuera de lo comercial son las cuentas. Todo lo demas vuelve al
   * inicio en vez de mostrar «Esa pantalla no existe» en algo que el cliente
   * nunca compro.
   */
  if (!planta && location.pathname !== "/cuentas") {
    return <Navigate to={comercial ? "/comercial" : "/cuentas"} replace />;
  }

  return (
    <ProveedorModulos persona={p}>
    <div className="app">
      <header className="barra">
        <div className="fila" style={{ gap: 16, alignItems: "baseline" }}>
          <NavLink to={planta ? "/lotes" : "/comercial"} className="marca">{p.marca.toUpperCase()}</NavLink>
          {planta ? (
            <span className="cond" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ambar)" }}>
              Control de producción
            </span>
          ) : null}
        </div>
        <nav className="nav">
          {comercial ? <NavLink to="/comercial">Comercial</NavLink> : null}
          {planta ? <>
          <NavLink to="/lotes" className={({ isActive }) => (isActive ? "activo" : "")}>Lotes</NavLink>
          <NavLink to="/ordenes" className={({ isActive }) => (isActive ? "activo" : "")}>Órdenes</NavLink>
          <NavLink to="/planta" className={({ isActive }) => (isActive ? "activo" : "")}>Planta</NavLink>
          <NavLink to="/recetas" className={({ isActive }) => (isActive ? "activo" : "")}>Recetas</NavLink>
          <NavLink to="/mantenimiento" className={({ isActive }) => (isActive ? "activo" : "")}>Mantenimiento</NavLink>
          <NavLink to="/catalogo" className={({ isActive }) => (isActive ? "activo" : "")}>Catálogo</NavLink>
          <NavLink to="/ajustes" className={({ isActive }) => (isActive ? "activo" : "")}>Ajustes</NavLink>
          </> : null}
          {estado.persona.role === "owner" && (
            <NavLink to="/cuentas" className={({ isActive }) => (isActive ? "activo" : "")}>Cuentas</NavLink>
          )}
        </nav>
        {quien}
      </header>

      <Routes>
        {planta ? <>
        <Route path="/" element={<Navigate to="/lotes" replace />} />
        <Route path="/lotes" element={<Lotes />} />
        <Route path="/lotes/:id" element={<FichaLote />} />
        <Route path="/ordenes" element={<Ordenes />} />
        <Route path="/ordenes/:id" element={<FichaOrden />} />
        <Route path="/planta" element={<Planta />} />
        <Route path="/recetas" element={<Recetas />} />
        <Route path="/recetas/:id" element={<Receta />} />
        <Route path="/mantenimiento" element={<Mantenimiento />} />
        <Route path="/catalogo" element={<Catalogo />} />
        <Route path="/ajustes" element={<Ajustes />} />
        </> : null}
        <Route path="/cuentas" element={<Cuentas yo={estado.persona} />} />
        <Route path="*" element={<div className="vacio">Esa pantalla no existe.</div>} />
      </Routes>

      {planta ? <Telemetria /> : null}
    </div>
    </ProveedorModulos>
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
