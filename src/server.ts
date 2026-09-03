import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { usersRoutes } from "./routes/users.js";
import { customersRoutes } from "./routes/customers.js";
import { contactsRoutes } from "./routes/contacts.js";
import { catalogItemsRoutes } from "./routes/catalog-items.js";
import { quotesRoutes } from "./routes/quotes.js";

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

  return app;
}
