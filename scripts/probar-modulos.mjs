/**
 * El interruptor de módulos, y la puerta que lo acompaña.
 *
 * Se corre contra DOS servidores levantados aparte:
 *   BASE       → con todos los módulos (lo que corre Titán hoy)
 *   BASE_SOLO  → con ROOTMINT_MODULES=comercial
 *
 * Lo que se busca no es que el menú cambie: es que lo apagado NO EXISTA en el
 * servidor, y que ninguna ruta —de un módulo encendido o no— conteste sin
 * sesión. «/ordenes» estuvo abierta en producción por quedar fuera de una
 * lista; esta prueba recorre todas las rutas conocidas para que no vuelva.
 */
import { spawnSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://127.0.0.1:4601";
const SOLO = process.env.BASE_SOLO ?? "http://127.0.0.1:4602";
let fallas = 0;
const ok = (b, t, extra = "") => {
  if (!b) fallas++;
  console.log(`  ${b ? "✓" : "✗"} ${t}${!b && extra ? "  — " + extra : ""}`);
};

async function entrarComo(base) {
  const r = await fetch(base + "/auth/primera-duena", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Dueña", email: "duena@prueba.sv", password: "unaClaveLarga1" }),
  });
  let set = r.headers.get("set-cookie");
  if (!set) {
    // Ya habia dueña (la prueba se corrio antes contra esta base): se entra.
    const e = await fetch(base + "/auth/entrar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "duena@prueba.sv", password: "unaClaveLarga1" }),
    });
    set = e.headers.get("set-cookie");
  }
  return set ? set.split(";")[0] : "";
}
const pedir = (base, ruta, galleta, metodo = "GET", cuerpo) =>
  fetch(base + ruta, {
    method: metodo,
    headers: { ...(cuerpo ? { "content-type": "application/json" } : {}), ...(galleta ? { cookie: galleta } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });

// Una ruta de cada prefijo, con el método que las cierra o las abre.
const POR_MODULO = {
  comercial: ["/customers", "/contacts", "/catalog-items", "/quotes", "/invoices", "/customer-prices", "/customer-notes"],
  bloques: ["/bloques/tipos", "/inventario", "/ordenes", "/quotes/x/que-producir", "/catalog-items/x/tipo-bloque"],
};
const BASE_SIEMPRE = ["/users", "/business-profile", "/auth/me"];

console.log("\n─── 1 · TODOS LOS MÓDULOS: NADA CONTESTA SIN SESIÓN ───");
for (const ruta of [...POR_MODULO.comercial, ...POR_MODULO.bloques, ...BASE_SIEMPRE]) {
  // POST solo donde la ruta lo admite; en las demas un 404 no dice nada.
  const posts = ["/customers", "/contacts", "/catalog-items", "/quotes", "/invoices", "/ordenes", "/users"];
  for (const metodo of posts.includes(ruta) ? ["GET", "POST"] : ["GET"]) {
    // Esta ruta solo existe como PATCH: con GET daria 404 aunque estuviera abierta.
    const m = ruta.endsWith("/tipo-bloque") ? "PATCH" : metodo;
    const r = await pedir(BASE, ruta, "", m, m === "GET" ? undefined : {});
    ok(r.status === 401, `${m} ${ruta} sin sesión → 401`, `dio ${r.status}`);
  }
}
const salud = await pedir(BASE, "/health", "");
ok(salud.status === 200, "/health sigue abierta (el despliegue la usa)");
const portada = await pedir(BASE, "/", "");
ok(portada.status !== 401, "y la interfaz se sirve sin sesión (es la pantalla de entrada)", `dio ${portada.status}`);

console.log("\n─── 2 · TODOS LOS MÓDULOS: LA PERSONA SABE QUÉ HAY ───");
const g1 = await entrarComo(BASE);
ok(Boolean(g1), "se crea la primera dueña");
const me1 = await (await pedir(BASE, "/auth/me", g1)).json();
ok(Array.isArray(me1.modulos) && me1.modulos.includes("comercial") && me1.modulos.includes("bloques"),
   "/auth/me dice que están comercial y bloques", JSON.stringify(me1.modulos));
for (const ruta of ["/ordenes", "/inventario", "/bloques/tipos", "/customers"]) {
  const r = await pedir(BASE, ruta, g1);
  ok(r.status === 200, `con sesión, GET ${ruta} → 200`, `dio ${r.status}`);
}

console.log("\n─── 3 · SOLO COMERCIAL: LA FÁBRICA NO EXISTE ───");
const g2 = await entrarComo(SOLO);
ok(Boolean(g2), "se crea la primera dueña");
const me2 = await (await pedir(SOLO, "/auth/me", g2)).json();
ok(JSON.stringify(me2.modulos) === JSON.stringify(["comercial"]), "/auth/me dice que solo hay comercial", JSON.stringify(me2.modulos));
for (const ruta of POR_MODULO.bloques) {
  for (const metodo of ["GET", "POST", "PATCH"]) {
    const r = await pedir(SOLO, ruta, g2, metodo, metodo === "GET" ? undefined : {});
    const tipo = r.headers.get("content-type") ?? "";
    ok(r.status === 404 && tipo.includes("json"), `${metodo} ${ruta} con sesión de dueña → 404 JSON (no existe)`, `dio ${r.status} ${tipo}`);
  }
}
for (const ruta of POR_MODULO.comercial) {
  const r = await pedir(SOLO, ruta, g2);
  ok(r.status === 200, `lo comercial sigue andando: GET ${ruta} → 200`, `dio ${r.status}`);
}
const perfil = await pedir(SOLO, "/business-profile", g2);
ok(perfil.status === 200, "y los datos de la empresa también");

console.log("\n─── 4 · UN NOMBRE MAL ESCRITO DETIENE EL ARRANQUE ───");
const arranque = spawnSync("npx", ["tsx", "src/index.ts"], {
  encoding: "utf8",
  cwd: process.cwd(),
  timeout: 60000,
  env: { ...process.env, ROOTMINT_LOCAL: "1", ROOTMINT_LOCAL_DATA: "/tmp/pg-mod-malo", PORT: "4609", ROOTMINT_MODULES: "comerical" },
});
const salida = (arranque.stdout ?? "") + (arranque.stderr ?? "");
ok(arranque.status !== 0 && /comerical/.test(salida) && /comercial, bloques/.test(salida),
   "«comerical» no arranca, dice cuál fue y cuáles valen", `estado ${arranque.status}: ${salida.slice(0, 300)}`);

console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo bien.");
process.exit(fallas ? 1 : 0);
