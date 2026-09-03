import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import estaticos from "@fastify/static";
import { ZodError } from "zod";
import { usersRoutes } from "./routes/users.js";
import { customersRoutes } from "./routes/customers.js";
import { contactsRoutes } from "./routes/contacts.js";
import { catalogItemsRoutes } from "./routes/catalog-items.js";
import { quotesRoutes } from "./routes/quotes.js";
import { bloquesCatalogoRoutes } from "./routes/bloques-catalogo.js";
import { bloquesProduccionRoutes } from "./routes/bloques-produccion.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Datos inválidos", details: err.issues });
    }
    req.log.error(err);
    return reply.code(500).send({ error: "Error interno" });
  });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(usersRoutes);
  await app.register(customersRoutes);
  await app.register(contactsRoutes);
  await app.register(catalogItemsRoutes);
  await app.register(quotesRoutes);

  // Módulo de fabricación de bloques
  await app.register(bloquesCatalogoRoutes);
  await app.register(bloquesProduccionRoutes);

  /**
   * La interfaz compilada se sirve desde este mismo servidor.
   *
   * Un contenedor y un dominio: sin CORS que configurar, sin una URL de API
   * que se pueda quedar apuntando al lugar equivocado, y sin dos servicios
   * que puedan estar caidos por separado el dia de una demostracion.
   *
   * Si dist-web/ no existe (desarrollo con Vite aparte), el servidor arranca
   * igual y solo atiende la API.
   */
  const aqui = dirname(fileURLToPath(import.meta.url));
  const web = join(aqui, "..", "dist-web");
  if (existsSync(web)) {
    // wildcard true (el de fabrica): resuelve el archivo en cada peticion.
    // Con wildcard:false, @fastify/static registra UNA ruta por archivo al
    // arrancar, y cualquier asset compilado despues cae al handler de abajo y
    // devuelve index.html con MIME text/html. El navegador rechaza el modulo y
    // la pagina queda en blanco tras un redeploy. Ya paso una vez; no vuelve.
    await app.register(estaticos, { root: web });

    /**
     * La interfaz usa rutas con "#", asi que cualquier ruta desconocida
     * devuelve el index. Con dos excepciones que SI tienen que dar 404:
     * la API, y los assets — un .js que falta debe fallar como .js, nunca
     * disfrazarse de HTML.
     */
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? "";
      const esApi = url.startsWith("/bloques") || url.startsWith("/health");
      const esAsset = url.startsWith("/assets/") || /\.[a-z0-9]{2,5}(\?|$)/i.test(url);
      if (esApi || esAsset) {
        return reply.code(404).send({ error: "No encontrado" });
      }
      return reply.type("text/html").sendFile("index.html");
    });
  } else {
    app.log.warn("dist-web no existe: solo se atiende la API");
  }

  return app;
}
