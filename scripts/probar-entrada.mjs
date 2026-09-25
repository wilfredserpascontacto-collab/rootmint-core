/**
 * Recorre la entrada en un navegador de verdad: pantalla de acceso, primera
 * dueña, recarga, área comercial, PIN de planta.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-prueba PORT=4340 node dist/index.js &
 *   node scripts/probar-entrada.mjs
 *
 * Necesita una base vacía: la primera prueba es justamente que no hay nadie.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? "http://127.0.0.1:4340";
let fallos = 0;
const ok = (b, t, extra = "") => { console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`); if (!b) fallos++; };

const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 1200, height: 800 } });
const pag = await ctx.newPage();
const errores = [];
pag.on("pageerror", (e) => errores.push(String(e).slice(0, 160)));

await pag.goto(BASE, { waitUntil: "networkidle" });
await pag.waitForTimeout(900);

console.log("\n=== sin sesión no se ve nada del sistema ===");
const texto = await pag.locator("body").innerText();
ok(/GRUPO TITÁN/i.test(texto), "aparece la pantalla de entrada");
ok(!/Lotes|Recetas|Mantenimiento/i.test(texto), "y NO se ve el menú del sistema", texto.replace(/\n+/g, " | ").slice(0, 120));

console.log("\n=== la primera dueña ===");
ok(/No hay ninguna cuenta todavía/i.test(texto), "ofrece crear la primera cuenta");
await pag.getByLabel("Nombre").fill("Amada");
await pag.getByLabel("Correo").fill("amada@bloquestitan.com");
await pag.getByLabel("Contraseña").fill("unaClaveLarga1");
await pag.getByRole("button", { name: /Crear la cuenta/i }).click();
await pag.waitForTimeout(2500);
const dentro = await pag.locator("body").innerText();
ok(/Lotes/i.test(dentro), "entra al sistema");
ok(/Amada/.test(dentro) && /Dueña/.test(dentro), "y arriba dice quién está adentro");

console.log("\n=== la sesión aguanta la recarga ===");
await pag.reload({ waitUntil: "networkidle" });
await pag.waitForTimeout(1500);
ok(/Lotes/i.test(await pag.locator("body").innerText()), "sigue adentro tras recargar");

console.log("\n=== el área comercial también está detrás de la puerta ===");
await pag.goto(BASE + "/comercial", { waitUntil: "networkidle" });
await pag.waitForTimeout(1800);
const com = await pag.locator("body").innerText();
ok(/comercial/i.test(com), "abre el área comercial");
ok(/Amada/.test(com), "y también muestra quién está adentro");

console.log("\n=== crear a alguien de planta con PIN ===");
const alta = await pag.evaluate(async () => {
  const r = await fetch("/users", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Nelson Ramírez", email: "nelson@bloquestitan.com", password: "claveDeNelson1", role: "staff", pin: "5382" }) });
  return { estado: r.status, cuerpo: await r.json() };
});
ok(alta.estado === 201, "se crea el operario", `estado ${alta.estado}`);

console.log("\n=== salir y entrar por la puerta de la planta ===");
await pag.goto(BASE, { waitUntil: "networkidle" });
await pag.waitForTimeout(1200);
await pag.getByRole("button", { name: "Salir" }).click();
await pag.waitForTimeout(1500);
ok(/GRUPO TITÁN/i.test(await pag.locator("body").innerText()), "vuelve a la entrada");

await pag.getByRole("tab", { name: "Planta" }).click();
await pag.waitForTimeout(1200);
ok(await pag.getByRole("button", { name: /Nelson/ }).isVisible(), "la tablet muestra el nombre");
await pag.getByRole("button", { name: /Nelson/ }).click();
await pag.waitForTimeout(600);

// PIN equivocado primero.
for (const d of ["9", "9", "9", "9"]) await pag.getByRole("button", { name: d, exact: true }).click();
await pag.waitForTimeout(1600);
ok(/no coincide/i.test(await pag.locator("body").innerText()), "PIN equivocado avisa y no entra");

for (const d of ["5", "3", "8", "2"]) await pag.getByRole("button", { name: d, exact: true }).click();
await pag.waitForTimeout(2500);
const planta = await pag.locator("body").innerText();
ok(/Lotes/i.test(planta), "con el PIN correcto entra");
ok(/Nelson/.test(planta) && /Empleado/.test(planta), "y entra como empleado", planta.split("\n").find((l) => /Nelson/.test(l)));

console.log(errores.length ? `\n  errores en consola: ${errores.join(" | ")}` : "\n  sin errores en consola");
console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
await nav.close();
process.exit(fallos ? 1 : 0);
