import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./estilos.css";

/**
 * HashRouter a propósito: sirve la interfaz desde cualquier ruta estática sin
 * que el servidor tenga que reescribir URLs. Una cosa menos que se puede
 * romper en un despliegue.
 */
createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
