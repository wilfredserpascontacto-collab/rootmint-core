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
import { bloquesMantenimientoRoutes } from "./routes/bloques-mantenimiento.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  /**
   * Los nombres de las columnas únicas, en castellano.
   *
   * Postgres avisa de un duplicado con el nombre de la restricción, que no le
   * dice nada a nadie. Sin traducir, poner dos veces "Arena" en el catálogo
   * termina en un "Error interno" en pantalla: el usuario no se entera de que
   * el problema es un nombre repetido, y lo que hizo mal —que tiene arreglo
   * inmediato— parece una falla del sistema.
   */
  const DUPLICADOS: Record<string, string> = {
    materials_code_unique: "Ya hay un material con ese nombre en el catálogo.",
    recipes_code_unique: "Ya hay una receta con ese nombre.",
    block_types_code_unique: "Ya hay un tipo de bloque con ese código.",
    batches_number_unique: "Ya existe un lote con ese número.",
    plant_roles_code_unique: "Ya hay un puesto con ese nombre.",
    maintenance_tasks_code_unique: "Ya hay una tarea con ese nombre.",
    users_email_unique: "Ya hay un usuario con ese correo.",
  };

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Datos inválidos", details: err.issues });
    }

    const pg = err as { code?: string; constraint?: string };

    if (pg.code === "23505") {
      return reply.code(409).send({
        error: DUPLICADOS[pg.constraint ?? ""] ?? "Ese registro ya existe.",
      });
    }

    /**
     * Llave foránea rota. Significa dos cosas OPUESTAS según qué se estaba
     * haciendo, y decir la equivocada manda a buscar el problema al revés:
     * al borrar, que algo todavía lo usa; al guardar, que apunta a algo que
     * no existe.
     */
    if (pg.code === "23503") {
      return reply.code(409).send({
        error:
          req.method === "DELETE"
            ? "No se puede quitar: todavía hay algo que lo usa."
            : "Apunta a algo que ya no existe. Recargue la página y vuelva a intentarlo.",
      });
    }

    /** Un id que ni siquiera tiene forma de id (22P02: texto que no convierte). */
    if (pg.code === "22P02") {
      return reply.code(400).send({ error: "Ese identificador no tiene forma válida." });
    }

    /** Un número que no cabe en la columna. Pasa con un cero de más al teclear. */
    if (pg.code === "22003") {
      return reply.code(400).send({ error: "Ese número es demasiado grande." });
    }

    /**
     * Fastify ya trae su propio 4xx para varias cosas —cuerpo que no es JSON,
     * método no permitido, cuerpo demasiado grande—. Sin esto, todas caían al
     * 500 de abajo y un JSON mal formado se veía igual que un servidor roto.
     */
    const propio = err as { statusCode?: number; message?: string };
    if (typeof propio.statusCode === "number" && propio.statusCode >= 400 && propio.statusCode < 500) {
      return reply.code(propio.statusCode).send({ error: propio.message ?? "Petición inválida" });
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
  await app.register(bloquesMantenimientoRoutes);

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
