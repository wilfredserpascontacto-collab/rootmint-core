/**
 * ¿De verdad está cerrada la puerta?
 * No se lee el código: se golpea la API y se mira qué contesta.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4330";
let fallos = 0;
const ok = (b, t, extra = "") => { console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`); if (!b) fallos++; };

/** fetch que recuerda las cookies, como un navegador. */
function navegador() {
  let galleta = "";
  return async (ruta, opciones = {}) => {
    const r = await fetch(BASE + ruta, {
      ...opciones,
      headers: { ...(opciones.body ? { "content-type": "application/json" } : {}), ...(galleta ? { cookie: galleta } : {}), ...(opciones.headers ?? {}) },
    });
    const set = r.headers.get("set-cookie");
    if (set) galleta = set.split(";")[0];
    const cuerpo = await r.json().catch(() => null);
    return { estado: r.status, cuerpo, set };
  };
}

const anonimo = navegador();

console.log("\n=== SIN SESIÓN: no se entra a nada ===");
const RUTAS = ["/customers", "/quotes", "/catalog-items", "/users", "/customer-prices?customerId=x", "/business-profile", "/bloques/lotes"];
for (const ruta of RUTAS) {
  const r = await anonimo(ruta);
  ok(r.estado === 401, `GET ${ruta} → 401`, `dio ${r.estado}`);
}
const esc = await anonimo("/customers", { method: "POST", body: JSON.stringify({ name: "Intruso" }) });
ok(esc.estado === 401, "POST /customers → 401", `dio ${esc.estado}`);

console.log("\n=== el encabezado x-user-id ya no sirve para suplantar ===");
const suplantar = await anonimo("/customers", { headers: { "x-user-id": "00000000-0000-0000-0000-000000000001" } });
ok(suplantar.estado === 401, "GET /customers con x-user-id inventado → 401", `dio ${suplantar.estado}`);

console.log("\n=== la primera dueña ===");
const hay = await anonimo("/auth/hay-alguien");
ok(hay.cuerpo?.hayAlguien === false, "todavía no hay nadie");

const duena = navegador();
const creada = await duena("/auth/primera-duena", { method: "POST", body: JSON.stringify({ name: "Amada", email: "amada@bloquestitan.com", password: "unaClaveLarga1" }) });
ok(creada.estado === 201 && creada.cuerpo?.role === "owner", "se crea la primera dueña y entra", `estado ${creada.estado}`);
ok(Boolean(creada.set?.includes("HttpOnly")), "la cookie es HttpOnly (el JavaScript de la página no la lee)");
ok(Boolean(creada.set?.includes("SameSite=Lax")), "y SameSite=Lax (otro sitio no la usa en tu nombre)");

const otra = await anonimo("/auth/primera-duena", { method: "POST", body: JSON.stringify({ name: "Colado", email: "colado@x.com", password: "otraClaveLarga1" }) });
ok(otra.estado === 409, "la ventana se cierra sola: ya no se puede crear otra 'primera'", `dio ${otra.estado}`);

console.log("\n=== con sesión sí se trabaja ===");
const yo = await duena("/auth/me");
ok(yo.estado === 200 && yo.cuerpo?.email === "amada@bloquestitan.com", "/auth/me dice quién soy");
ok(yo.cuerpo?.passwordHash === undefined && yo.cuerpo?.pinHash === undefined, "y no devuelve la contraseña ni el PIN");
const lista = await duena("/customers");
ok(lista.estado === 200, "GET /customers → 200 estando adentro", `dio ${lista.estado}`);

console.log("\n=== la dueña crea gente ===");
const emp = await duena("/users", { method: "POST", body: JSON.stringify({ name: "Nelson (planta)", email: "nelson@bloquestitan.com", password: "claveDeNelson1", role: "staff", pin: "5382" }) });
ok(emp.estado === 201 && emp.cuerpo?.tienePin === true, "empleado de planta con PIN", `estado ${emp.estado}`);
ok(emp.cuerpo?.pinHash === undefined && emp.cuerpo?.passwordHash === undefined, "el PIN cifrado no sale en la respuesta");

const mirona = await duena("/users", { method: "POST", body: JSON.stringify({ name: "Contadora", email: "conta@bloquestitan.com", password: "claveContable1", role: "viewer" }) });
ok(mirona.estado === 201, "cuenta de solo ver");

const obvio = await duena("/users", { method: "POST", body: JSON.stringify({ name: "X", email: "x@x.com", password: "claveCualquiera1", role: "staff", pin: "1234" }) });
ok(obvio.estado === 400, "un PIN obvio como 1234 se rechaza", obvio.cuerpo?.details?.[0]?.message ?? obvio.cuerpo?.error);

console.log("\n=== entrar con PIN desde la tablet ===");
const anon = navegador();
const planta = await anon("/auth/planta");
ok(planta.estado === 200 && planta.cuerpo.some((u) => u.name.startsWith("Nelson")), "la tablet ve la lista de nombres sin estar adentro");
ok(planta.cuerpo.every((u) => Object.keys(u).join() === "id,name"), "y solo nombre e id, nada más", JSON.stringify(planta.cuerpo[0]));
ok(!planta.cuerpo.some((u) => u.name === "Amada"), "la dueña no aparece en la tablet (no tiene PIN)");

const tablet = navegador();
const malPin = await tablet("/auth/pin", { method: "POST", body: JSON.stringify({ userId: emp.cuerpo.id, pin: "0000" }) });
ok(malPin.estado === 401, "PIN equivocado → 401");
const buenPin = await tablet("/auth/pin", { method: "POST", body: JSON.stringify({ userId: emp.cuerpo.id, pin: "5382" }) });
ok(buenPin.estado === 200, "PIN correcto → adentro", `estado ${buenPin.estado}`);
const quienSoy = await tablet("/auth/me");
ok(quienSoy.cuerpo?.role === "staff", "y entra como empleado");

console.log("\n=== lo que el empleado NO puede ===");
const cli = await duena("/customers", { method: "POST", body: JSON.stringify({ name: "Constructora Test", type: "company" }) });
ok(cli.estado === 201, "la dueña crea un cliente");

const tel = await tablet(`/customers/${cli.cuerpo.id}`, { method: "PATCH", body: JSON.stringify({ phone: "7777-7777" }) });
ok(tel.estado === 200, "el empleado SÍ corrige un teléfono", `dio ${tel.estado}`);

const credito = await tablet(`/customers/${cli.cuerpo.id}`, { method: "PATCH", body: JSON.stringify({ creditLimitCents: 500000 }) });
ok(credito.estado === 403, "pero NO toca el límite de crédito", credito.cuerpo?.error);

const precio = await tablet("/customer-prices", { method: "POST", body: JSON.stringify({ customerId: cli.cuerpo.id, description: "Bloque barato", unitPriceCents: 1 }) });
ok(precio.estado === 403, "ni los precios acordados", precio.cuerpo?.error);

const cuentas = await tablet("/users");
ok(cuentas.estado === 403, "ni administra cuentas", cuentas.cuerpo?.error);

console.log("\n=== la que solo mira, solo mira ===");
const ojos = navegador();
await ojos("/auth/entrar", { method: "POST", body: JSON.stringify({ email: "conta@bloquestitan.com", password: "claveContable1" }) });
const lee = await ojos("/customers");
ok(lee.estado === 200, "lee clientes");
const escribe = await ojos("/customers", { method: "POST", body: JSON.stringify({ name: "No debería" }) });
ok(escribe.estado === 403, "pero no crea nada", escribe.cuerpo?.error);

console.log("\n=== la última dueña no se puede quitar ===");
const yoMisma = await duena("/auth/me");
const degradar = await duena(`/users/${yoMisma.cuerpo.id}`, { method: "PATCH", body: JSON.stringify({ role: "staff" }) });
ok(degradar.estado === 409, "no puede dejar de ser dueña si es la única", degradar.cuerpo?.error);
const borrarse = await duena(`/users/${yoMisma.cuerpo.id}`, { method: "DELETE" });
ok(borrarse.estado === 409, "ni borrarse", borrarse.cuerpo?.error);

console.log("\n=== salir ===");
const salida = await tablet("/auth/salir", { method: "POST" });
ok(salida.estado === 200, "cierra sesión");
const despues = await tablet("/customers");
ok(despues.estado === 401, "y la sesión deja de servir en el acto", `dio ${despues.estado}`);

console.log("\n=== contraseña equivocada, y el candado ===");
// Se traba una cuenta de usar y tirar, no la de la dueña: si se trabara la
// suya, el resto de la prueba no podria seguir — y en la vida real, tampoco.
const victima = await duena("/users", { method: "POST", body: JSON.stringify({ name: "Prueba candado", email: "candado@bloquestitan.com", password: "claveDePrueba1", role: "staff" }) });
const malo = navegador();
const mal = await malo("/auth/entrar", { method: "POST", body: JSON.stringify({ email: "candado@bloquestitan.com", password: "noEsLaClave" }) });
ok(mal.estado === 401, "contraseña equivocada → 401");
ok(!/no existe|no encontrado/i.test(mal.cuerpo?.error ?? ""), "el mensaje no delata si el correo existe", mal.cuerpo?.error);
const inventado = await malo("/auth/entrar", { method: "POST", body: JSON.stringify({ email: "nadie@bloquestitan.com", password: "loQueSea1" }) });
ok(inventado.cuerpo?.error === mal.cuerpo?.error, "y es el MISMO mensaje para un correo que no existe");

let ultimo = mal;
for (let i = 0; i < 5; i++) ultimo = await malo("/auth/entrar", { method: "POST", body: JSON.stringify({ email: "candado@bloquestitan.com", password: "noEsLaClave" }) });
ok(/trabada/i.test(ultimo.cuerpo?.error ?? ""), "tras varios intentos la cuenta se traba", ultimo.cuerpo?.error);
const buenaTrabada = await malo("/auth/entrar", { method: "POST", body: JSON.stringify({ email: "candado@bloquestitan.com", password: "claveDePrueba1" }) });
ok(buenaTrabada.estado === 401, "y mientras está trabada no entra ni con la clave correcta");
const destrabada = await duena(`/users/${victima.cuerpo.id}`, { method: "PATCH", body: JSON.stringify({ password: "claveNueva123" }) });
ok(destrabada.estado === 200, "la dueña le cambia la clave y con eso la destraba");
const yaEntra = await malo("/auth/entrar", { method: "POST", body: JSON.stringify({ email: "candado@bloquestitan.com", password: "claveNueva123" }) });
ok(yaEntra.estado === 200, "y ya puede entrar", `dio ${yaEntra.estado}`);

console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
