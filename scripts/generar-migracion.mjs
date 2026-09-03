/**
 * Genera una migracion de Drizzle.
 *
 * Existe por un choque entre dos herramientas del mismo proyecto:
 * TypeScript con moduleResolution NodeNext EXIGE la extension .js en los
 * imports relativos, y el bundler de drizzle-kit 0.28 no la resuelve y falla
 * con "Cannot find module './schema.js'".
 *
 * Este script quita la extension solo mientras dura la generacion y la
 * devuelve al terminar, pase lo que pase. Correr `drizzle-kit generate` a
 * mano falla; usar `npm run db:generate`, que llama a esto.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ARCHIVOS = ["src/db/schema-bloques.ts"];
const originales = new Map();

for (const f of ARCHIVOS) {
  const texto = readFileSync(f, "utf8");
  originales.set(f, texto);
  writeFileSync(f, texto.replace(/from "\.\/schema\.js"/g, 'from "./schema"'));
}

try {
  const args = process.argv.slice(2);
  const r = spawnSync("npx", ["drizzle-kit", "generate", ...args], { stdio: "inherit" });
  process.exitCode = r.status ?? 1;
} finally {
  for (const [f, texto] of originales) writeFileSync(f, texto);
  console.log("\n(extensiones .js restauradas)");
}
