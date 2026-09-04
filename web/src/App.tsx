import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import Lotes from "./pantallas/Lotes";
import FichaLote from "./pantallas/FichaLote";
import Planta from "./pantallas/Planta";
import Recetas from "./pantallas/Recetas";
import Receta from "./pantallas/Receta";
import Mantenimiento from "./pantallas/Mantenimiento";
import Ajustes from "./pantallas/Ajustes";
import Catalogo from "./pantallas/Catalogo";
import Telemetria from "./comp/Telemetria";

export default function App() {
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
          <NavLink to="/lotes" className={({ isActive }) => (isActive ? "activo" : "")}>Lotes</NavLink>
          <NavLink to="/planta" className={({ isActive }) => (isActive ? "activo" : "")}>Planta</NavLink>
          <NavLink to="/recetas" className={({ isActive }) => (isActive ? "activo" : "")}>Recetas</NavLink>
          <NavLink to="/mantenimiento" className={({ isActive }) => (isActive ? "activo" : "")}>Mantenimiento</NavLink>
          <NavLink to="/catalogo" className={({ isActive }) => (isActive ? "activo" : "")}>Catálogo</NavLink>
          <NavLink to="/ajustes" className={({ isActive }) => (isActive ? "activo" : "")}>Ajustes</NavLink>
        </nav>
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
