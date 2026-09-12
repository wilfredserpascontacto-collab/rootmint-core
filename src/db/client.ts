import "dotenv/config";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
const local = process.env.ROOTMINT_LOCAL === "1";
if (local && (process.env.NODE_ENV === "production" || connectionString)) {
  throw new Error("La base local no se puede combinar con producción o DATABASE_URL.");
}
if (!connectionString && !local) {
  throw new Error("DATABASE_URL no está definido");
}

async function connect() {
  if (!local) {
    const pool = new Pool({ connectionString });
    return { db: drizzle(pool, { schema }), pool };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: embedded } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const pg = new PGlite(process.env.ROOTMINT_LOCAL_DATA ?? ".local-data");
  const db = embedded(pg, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  // Development-only adapter: routes use the common PostgreSQL query builder.
  // Keep production on node-postgres; integration tests exercise this adapter.
  return { db: db as unknown as NodePgDatabase<typeof schema>, pool: { end: () => pg.close() } };
}
export const { db, pool } = await connect();
