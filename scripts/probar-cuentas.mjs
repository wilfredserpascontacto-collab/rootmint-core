/**
 * Recorre la pantalla de cuentas en un navegador: crear, PIN, destrabar,
 * quitar PIN, desactivar, y que una cuenta desactivada ya no entre.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-prueba PORT=4370 node dist/index.js &
 *   node scripts/probar-cuentas.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? "http://127.0.0.1:4370";
let fallos = 0;
const ok = (b, t, extra = "") => { console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`); if (!b) fallos++; };

const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 } });
const pag = await ctx.newPage();
const errores = [];
pag.on("pageerror", (e) => errores.push(String(e).slice(0, 160)));
pag.on("console", (m) => { if (m.type() === "error") errores.push("consola: " + m.text().slice(0, 140)); });

await pag.goto(BASE, { waitUntil: "networkidle" });
await pag.waitForTimeout(900);
await pag.getByLabel("Nombre").fill("Amada");
await pag.getByLabel("Correo").fill("amada@bloquestitan.com");
await pag.getByLabel("Contraseña").fill("unaClaveLarga1");
await pag.getByRole("button", { name: /Crear la cuenta/i }).click();
await pag.waitForTimeout(2500);

console.log("\n=== la dueña ve Cuentas ===");
ok(await pag.getByRole("link", { name: "Cuentas" }).isVisible(), "el enlace aparece en el menú");
await pag.getByRole("link", { name: "Cuentas" }).click();
await pag.waitForTimeout(1500);
const t = await pag.locator("body").innerText();
ok(/Amada/.test(t) && /Dueña/.test(t), "se ve su propia cuenta");
ok(/vos/i.test(t), "y está marcada como suya");

console.log("\n=== crear a alguien de planta ===");
await pag.getByRole("button", { name: /Crear una cuenta/i }).click();
await pag.waitForTimeout(600);
await pag.getByLabel("Nombre").fill("Nelson Ramírez");
await pag.getByLabel("Correo").fill("nelson@bloquestitan.com");
await pag.getByLabel("Contraseña", { exact: false }).first().fill("claveDeNelson1");
await pag.getByLabel(/PIN de planta/i).fill("5382");
await pag.getByRole("button", { name: "Guardar" }).click();
await pag.waitForTimeout(2000);
const t2 = await pag.locator("body").innerText();
ok(/Nelson Ramírez/.test(t2), "aparece en la lista");
ok(/Correo o PIN/.test(t2), "y dice que entra por correo o PIN");

console.log("\n=== un PIN obvio se rechaza, con mensaje ===");
await pag.getByRole("button", { name: /Crear una cuenta/i }).click();
await pag.waitForTimeout(600);
await pag.getByLabel("Nombre").fill("Prueba");
await pag.getByLabel("Correo").fill("prueba@bloquestitan.com");
await pag.getByLabel("Contraseña", { exact: false }).first().fill("claveCualquiera1");
await pag.getByLabel(/PIN de planta/i).fill("1234");
await pag.getByRole("button", { name: "Guardar" }).click();
await pag.waitForTimeout(1800);
ok(/adivina cualquiera/i.test(await pag.locator("body").innerText()), "avisa que ese PIN no sirve");
await pag.getByRole("button", { name: "Cancelar" }).click();
await pag.waitForTimeout(500);

console.log("\n=== la última dueña está protegida ===");
await pag.getByRole("row", { name: /Amada/ }).getByRole("button", { name: "Cambiar" }).click();
await pag.waitForTimeout(800);
const t3 = await pag.locator("body").innerText();
ok(/única dueña activa/i.test(t3), "avisa que es la única dueña");
ok(await pag.getByLabel("Permiso").isDisabled(), "y no deja cambiarle el permiso");
ok(/no te podés desactivar/i.test(t3), "dice que no puede desactivarse a sí misma");
await pag.getByRole("button", { name: "Cancelar" }).click();
await pag.waitForTimeout(500);

console.log("\n=== quitarle el PIN a Nelson ===");
await pag.getByRole("row", { name: /Nelson/ }).getByRole("button", { name: "Cambiar" }).click();
await pag.waitForTimeout(800);
await pag.getByLabel(/Quitarle el PIN/i).check();
await pag.getByRole("button", { name: "Guardar" }).click();
await pag.waitForTimeout(2000);
const fila = await pag.getByRole("row", { name: /Nelson/ }).innerText();
ok(!/Correo o PIN/.test(fila), "ya no entra por PIN", fila.replace(/\n/g, " · "));

console.log("\n=== desactivar a Nelson ===");
await pag.getByRole("row", { name: /Nelson/ }).getByRole("button", { name: "Cambiar" }).click();
await pag.waitForTimeout(800);
await pag.getByLabel(/Desactivar la cuenta/i).check();
await pag.getByRole("button", { name: "Guardar" }).click();
await pag.waitForTimeout(2000);
ok(/desactivada/.test(await pag.getByRole("row", { name: /Nelson/ }).innerText()), "queda desactivada");

const entra = await pag.evaluate(async () => {
  const r = await fetch("/auth/entrar", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nelson@bloquestitan.com", password: "claveDeNelson1" }) });
  return r.status;
});
ok(entra === 401, "y desactivada ya no puede entrar", `dio ${entra}`);

console.log(errores.length ? `\n  errores en consola: ${errores.join(" | ")}` : "\n  sin errores en consola");
console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
await nav.close();
process.exit(fallos ? 1 : 0);
