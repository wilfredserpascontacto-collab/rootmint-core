import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

async function main() {
  await migrate(db, { migrationsFolder: "drizzle" });
  await pool.end();
  console.log("Migraciones aplicadas.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
