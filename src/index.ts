import "dotenv/config";
import { buildServer } from "./server.js";
import { pool } from "./db/client.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.ROOTMINT_LOCAL === "1" ? "127.0.0.1" : process.env.HOST ?? "0.0.0.0";

const app = await buildServer();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => { await app.close(); await pool.end(); process.exit(0); });
}

app
  .listen({ port, host })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
