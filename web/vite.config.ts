import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * La interfaz se compila dentro de dist-web/ y la sirve el mismo Fastify que
 * atiende la API. Un solo contenedor, un solo dominio: en la demo no hay CORS
 * que configurar ni dos servicios que puedan estar caidos por separado.
 */
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../dist-web", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/bloques": "http://localhost:3000", "/health": "http://localhost:3000" },
  },
});
