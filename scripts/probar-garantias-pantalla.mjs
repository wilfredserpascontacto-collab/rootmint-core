/**
 * Garantias, por las pantallas que usaria la oficina.
 *
 * Servidor: ROOTMINT_MODULES=comercial,servicio, base vacia, ya compilado
 * (npm run web:build). Se hace lo que se haria con el cliente al telefono:
 * ¿esta en garantia?, darle 6 meses a uno y un año a otro, corregirla,
 * anularla, ver cuales vencen este mes.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4812";
let fallas = 0;
const ok = (b, t, extra = "") => {
  if (!b) fallas++;
  console.log(`  ${b ? "✓" : "✗"} ${t}${!b && extra ? "  — " + extra : ""}`);
};
const nav = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await nav.newContext({ viewport: { width: 1280, height: 1000 } });
const pag = await ctx.newPage();
const malos = [];
pag.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|\/auth\/me|fonts\./.test(r.url())) malos.push(`${r.status()} ${r.url().replace(BASE, "")}`);
});
pag.on("pageerror", (e) => malos.push("JS: " + e.message));
const texto = () => pag.locator("body").innerText();
const FOTOS = process.env.FOTOS ?? "";
const foto = async (n) => { if (FOTOS) await pag.screenshot({ path: `${FOTOS}/gar-${n}.png`, fullPage: true }); };

const hoy = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const mas = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const mesesMas = (dia, n) => {
  const [y, m, d] = dia.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n; const ty = Math.floor(idx / 12), tm = (idx % 12) + 1;
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, new Date(Date.UTC(ty, tm, 0)).getUTCDate())).padStart(2, "0")}`;
};
const fmt = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Intl.DateTimeFormat("es-SV", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, dd))); };

console.log("\n=== entrar ===");
await pag.goto(BASE, { waitUntil: "domcontentloaded" });
await pag.waitForTimeout(1200);
if (/ninguna cuenta todav/i.test(await texto())) {
  await pag.getByLabel(/nombre/i).first().fill("Francisco");
  await pag.getByLabel(/correo/i).first().fill("f@fenix.sv");
  const claves = pag.locator('input[type="password"]');
  for (let i = 0; i < (await claves.count()); i++) await claves.nth(i).fill("unaClaveLarga1");
  await pag.getByRole("button", { name: /crear/i }).first().click();
  await pag.waitForTimeout(1500);
}
const post = async (r, data) => (await (await pag.request.post(BASE + r, { data })).json());
const perez = await post("/customers", { name: "María Pérez", type: "person", stage: "customer", address: "Los Pinos" });
const lopez = await post("/customers", { name: "Taller López", type: "person", stage: "customer", address: "Escalón" });
const entregada = mesesMas(hoy, -2);
const iA = await post("/instalaciones", { customerId: perez.id, label: "Casa de la playa", address: "Km 40", description: "Tablero", deliveredAt: entregada });
const iB = await post("/instalaciones", { customerId: lopez.id, label: "El taller", address: "Escalón 5", description: "Trifásico" });

console.log("\n=== la pregunta del día, antes de cargar nada ===");
await pag.goto(`${BASE}/#/comercial/instalaciones/${iA.id}`);
await pag.waitForTimeout(900);
ok(/SIN GARANTÍA REGISTRADA/.test(await texto()), "entregada y sin garantía: el letrero dice «sin garantía registrada»");
await pag.goto(`${BASE}/#/comercial/instalaciones/${iB.id}`);
await pag.waitForTimeout(900);
ok(/NO SE PUEDE SABER/.test(await texto()), "sin fecha de entrega: dice «no se puede saber», no inventa");

console.log("\n=== dar 6 meses ===");
await pag.goto(`${BASE}/#/comercial/instalaciones/${iA.id}`);
await pag.waitForTimeout(700);
await pag.getByRole("button", { name: /dar garantía/i }).first().click();
await pag.waitForTimeout(500);
const m = pag.getByRole("dialog");
ok((await m.locator('input[type="date"]').first().inputValue()) === entregada, "corre desde la entrega, sin teclearlo");
await m.getByRole("button", { name: "6 meses" }).click();
await pag.waitForTimeout(200);
const fin6 = mesesMas(entregada, 6);
ok(new RegExp("Vence el " + fmt(fin6).replace(/[.]/g, "\\.")).test(await m.innerText()), "debajo se lee la fecha en que vence", (await m.innerText()).slice(-400));
ok((await m.locator('input[type="date"]').nth(1).inputValue()) === fin6, "y el campo de fecha exacta se llena solo");
await m.getByRole("button", { name: "1 año" }).click();
ok((await m.locator('input[type="date"]').nth(1).inputValue()) === mesesMas(entregada, 12), "con «1 año» se recalcula");
await m.getByPlaceholder("6, 12, 18…").fill("18");
ok((await m.locator('input[type="date"]').nth(1).inputValue()) === mesesMas(entregada, 18), "con 18 meses escritos también");
await m.locator('input[type="date"]').nth(1).fill(mas(hoy, 45));
ok((await m.getByPlaceholder("6, 12, 18…").inputValue()) === "", "poniendo la fecha exacta se limpian los meses");
await foto("1-formulario");
await m.getByRole("button", { name: "6 meses" }).click();
await m.getByRole("button", { name: /^dar garantía$/i }).click();
await pag.waitForTimeout(1000);
let t = await texto();
ok(/Vigente/.test(t) && new RegExp("Del " + fmt(entregada).replace(/[.]/g, "\\.")).test(t), "la garantía aparece en la ficha, vigente");
ok(/EN GARANTÍA hasta el/.test(t), "y el letrero grande dice EN GARANTÍA hasta la fecha");
ok(/Quedan \d+ días?/.test(t), "con los días que quedan");
ok(/le falta/i.test(t), "avisa que al certificado le faltan textos");
await foto("2-en-garantia");

console.log("\n=== editarla: de 6 meses a 1 año ===");
await pag.getByRole("button", { name: "Editar", exact: true }).nth(0).click().catch(() => {});
await pag.waitForTimeout(300);
// El primer «Editar» es el de la instalación; el de la garantía está en su fila.
if (await pag.getByRole("dialog").count()) await pag.keyboard.press("Escape");
await pag.locator(".c-garantias").getByRole("button", { name: "Editar" }).click();
await pag.waitForTimeout(500);
const e = pag.getByRole("dialog");
ok(/Editar garantía/.test(await e.innerText()), "abre el formulario de edición");
await e.getByRole("button", { name: "1 año" }).click();
await e.locator("textarea").nth(0).fill("Cubre defectos de instalación.");
await e.locator("textarea").nth(1).fill("Dar acceso al técnico.");
await e.locator("textarea").nth(2).fill("Llamar a la oficina.");
await e.locator('input:not([type="date"])').last().fill("Grupo Phonix");
await e.getByRole("button", { name: /guardar cambios/i }).click();
await pag.waitForTimeout(1000);
t = await texto();
ok(t.includes(fmt(mesesMas(entregada, 12))), "la garantía ahora termina a los 12 meses", t.slice(0, 600));
ok(/Certificado completo/.test(t), "con los cuatro textos, el certificado queda completo");
await foto("3-editada");

console.log("\n=== darla a otro cliente por 6 meses y esta vencida ===");
const iC = await post("/instalaciones", { customerId: lopez.id, label: "Bodega", address: "Soyapango", description: "Luces", deliveredAt: mesesMas(hoy, -8) });
await pag.goto(`${BASE}/#/comercial/instalaciones/${iC.id}`);
await pag.waitForTimeout(700);
await pag.getByRole("button", { name: /dar garantía/i }).first().click();
await pag.waitForTimeout(500);
const m2 = pag.getByRole("dialog");
ok(/Phonix/.test(await m2.locator("input:not([type='date'])").last().inputValue().catch(() => "")) || (await m2.locator("input").evaluateAll((x) => x.map((i) => i.value)).then((v) => v.some((s) => /Phonix/.test(s)))),
   "la garantía nueva trae los textos de la última emitida");
await m2.getByRole("button", { name: "6 meses" }).click();
ok(/ya está vencida/.test(await m2.innerText()), "avisa en el formulario que esa fecha ya pasó");
await m2.getByRole("button", { name: /^dar garantía$/i }).click();
await pag.waitForTimeout(1000);
t = await texto();
ok(/GARANTÍA VENCIDA el/.test(t) && /Hace \d+ días?/.test(t), "el letrero dice VENCIDA, y hace cuántos días");
ok(/ya está vencida/i.test(t), "y la ficha muestra el aviso");
await foto("4-vencida");

console.log("\n=== anular ===");
await pag.locator(".c-garantias").getByRole("button", { name: "Anular" }).click();
await pag.waitForTimeout(400);
const a = pag.getByRole("dialog");
await a.getByPlaceholder(/cargó dos veces/i).fill("Se le dio por error");
await a.getByRole("button", { name: /^anular garantía$/i }).click();
await pag.waitForTimeout(1000);
t = await texto();
ok(/Anulada: Se le dio por error/.test(t), "queda en la ficha, anulada, con su motivo");
ok(/SIN GARANTÍA REGISTRADA/.test(t), "y la instalación vuelve a «sin garantía»");

console.log("\n=== la lista: columna y filtro ===");
await pag.goto(`${BASE}/#/comercial/instalaciones`);
await pag.waitForTimeout(900);
t = await texto();
ok(/GARANTÍA/i.test(t) && /En garantía · hasta/.test(t), "la lista tiene su columna «Garantía» con el estado");
await pag.getByLabel("Garantía", { exact: true }).selectOption("en_garantia");
await pag.waitForTimeout(300);
ok(/1 de 3/.test(await texto()), "el filtro «en garantía» deja solo la que lo está");
await pag.getByLabel("Garantía", { exact: true }).selectOption("sin_garantia");
await pag.waitForTimeout(300);
ok(/2 de 3/.test(await texto()), "y «sin garantía registrada» deja las otras dos");
await foto("5-lista");

console.log("\n=== las que vencen ===");
const iD = await post("/instalaciones", { customerId: perez.id, label: "Vence pronto", address: "Centro", description: "Cableado", deliveredAt: mesesMas(hoy, -5) });
await post(`/instalaciones/${iD.id}/garantias`, { startsAt: mas(hoy, -100), endsAt: mas(hoy, 10) });
await pag.goto(`${BASE}/#/comercial`);
await pag.waitForTimeout(500);
await pag.getByRole("link", { name: /^◈?\s*Garantías$/ }).first().click();
await pag.waitForTimeout(500);
await pag.getByLabel("Periodo").selectOption("30");
await pag.waitForTimeout(900);
t = await texto();
ok(/Vence pronto/.test(t) && /Quedan 10 días/.test(t), "«próximos 30 días» muestra la que vence en 10, con los días que quedan", t.slice(0, 500));
ok(!/Casa de la playa/.test(t), "y no la que vence en un año");
await foto("6-vencen");

console.log("\n=== salud ===");
ok(malos.length === 0, "ninguna respuesta con error ni excepción de JS", malos.join(" | "));
await nav.close();
console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo bien.");
process.exit(fallas ? 1 : 0);
