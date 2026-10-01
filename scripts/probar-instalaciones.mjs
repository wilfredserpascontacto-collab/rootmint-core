/**
 * Instalaciones, golpeando la API como la usaria la oficina.
 *
 * Se corre contra un servidor con ROOTMINT_MODULES=comercial,servicio y una
 * base vacia. No se lee el codigo: se pide y se mira lo que contesta.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4801";
let fallos = 0;
const ok = (b, t, extra = "") => {
  if (!b) fallos++;
  console.log(`  ${b ? "✓" : "✗"} ${t}${!b && extra ? "  — " + extra : ""}`);
};

function navegador() {
  let galleta = "";
  return async (ruta, metodo = "GET", cuerpo) => {
    const r = await fetch(BASE + ruta, {
      method: metodo,
      headers: { ...(cuerpo ? { "content-type": "application/json" } : {}), ...(galleta ? { cookie: galleta } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const set = r.headers.get("set-cookie");
    if (set) galleta = set.split(";")[0];
    const datos = await r.json().catch(() => null);
    return { estado: r.status, datos };
  };
}

const duena = navegador();
const anonimo = navegador();

console.log("\n─── 0 · PREPARAR ───");
await duena("/auth/primera-duena", "POST", { name: "Francisco", email: "f@fenix.sv", password: "unaClaveLarga1" });
const mk = async (n) => (await duena("/customers", "POST", { name: n, type: "person", stage: "customer", address: `Dirección de ${n}` })).datos;
const perez = await mk("María Pérez");
const lopez = await mk("Taller López");
ok(Boolean(perez?.id && lopez?.id), "hay dos clientes");
const cot = (await duena("/quotes", "POST", { customerId: lopez.id, lines: [{ description: "Tablero", quantity: 1, unitPriceCents: 10000 }], taxRatePercent: 13 })).datos;
ok(Boolean(cot?.id), "y una cotización del taller");

console.log("\n─── 1 · LA PUERTA ───");
for (const [m, r] of [["GET", "/instalaciones"], ["POST", "/instalaciones"], ["GET", "/instalaciones/x"]]) {
  const x = await anonimo(r, m, m === "POST" ? {} : undefined);
  ok(x.estado === 401, `${m} ${r} sin sesión → 401`, `dio ${x.estado}`);
}
await duena("/users", "POST", { name: "Oficina", email: "of@fenix.sv", password: "claveOficina1", role: "staff" });
await duena("/users", "POST", { name: "Electricista", email: "el@fenix.sv", password: "claveCalle11", role: "viewer" });
const oficina = navegador(); await oficina("/auth/entrar", "POST", { email: "of@fenix.sv", password: "claveOficina1" });
const calle = navegador(); await calle("/auth/entrar", "POST", { email: "el@fenix.sv", password: "claveCalle11" });
ok((await calle("/instalaciones")).estado === 403, "el de solo lectura no ve instalaciones (todavía no hay visitas con qué filtrar)");
ok((await calle("/instalaciones", "POST", {})).estado === 403, "ni crea");

console.log("\n─── 2 · CARGAR UNA ───");
const base = { customerId: perez.id, label: "La casa de la playa", address: "Km 40 Carretera al Litoral", description: "Tablero de 12 circuitos y acometida", deliveredAt: "2026-03-15" };
const faltas = [
  [{ ...base, label: "" }, "sin «cómo le dice»"],
  [{ ...base, address: "   " }, "con dirección en blanco"],
  [{ ...base, description: "" }, "sin qué se instaló"],
  [{ ...base, customerId: "no-es-un-id" }, "con un cliente que no es un id"],
  [{ ...base, customerId: "00000000-0000-4000-8000-000000000000" }, "con un cliente que no existe"],
  [{ ...base, quoteId: "00000000-0000-4000-8000-000000000000" }, "con una cotización que no existe"],
  [{ ...base, deliveredAt: "2026-02-31" }, "con un 31 de febrero"],
  [{ ...base, deliveredAt: "15/03/2026" }, "con la fecha escrita al revés"],
];
for (const [cuerpo, que] of faltas) {
  const r = await oficina("/instalaciones", "POST", cuerpo);
  ok(r.estado === 400, `se rechaza ${que}`, `dio ${r.estado}`);
}
const a = await oficina("/instalaciones", "POST", base);
ok(a.estado === 201 && a.datos.number === 1, "la oficina carga la primera: número 1", JSON.stringify(a.datos)?.slice(0, 120));
ok(a.datos.deliveredAt === "2026-03-15", "y el 15 de marzo sigue siendo 15 (sin correrse un día por la zona horaria)", a.datos.deliveredAt);
ok(Array.isArray(a.datos.avisos) && a.datos.avisos.length === 0, "sin avisos");

const b = await oficina("/instalaciones", "POST", { customerId: lopez.id, label: "El taller", address: "Colonia Escalón, calle 5", description: "Tomacorrientes trifásicos" });
ok(b.estado === 201 && b.datos.number === 2, "la segunda es la 2");
ok(b.datos.deliveredAt === null, "sin fecha de entrega queda VACÍA, no «hoy»", String(b.datos.deliveredAt));

const mañana = new Date(Date.now() - 6 * 3600e3 + 3 * 86400e3).toISOString().slice(0, 10);
const c = await oficina("/instalaciones", "POST", { ...base, label: "Local nuevo", deliveredAt: mañana });
ok(c.estado === 201 && c.datos.avisos.some((x) => /futura/i.test(x)), "una entrega en el futuro se guarda y AVISA", JSON.stringify(c.datos.avisos));

const d = await oficina("/instalaciones", "POST", { ...base, label: "Bodega", quoteId: cot.id });
ok(d.estado === 201 && d.datos.avisos.some((x) => /otro cliente/i.test(x)), "una cotización de otro cliente se guarda y AVISA (avisar no es impedir)", JSON.stringify(d.datos.avisos));
const e = await oficina("/instalaciones", "POST", { customerId: lopez.id, label: "Oficina del taller", address: "Colonia Escalón", description: "Luminarias", quoteId: cot.id });
ok(e.estado === 201 && e.datos.avisos.length === 0, "con su propia cotización, sin avisos");

console.log("\n─── 3 · ENCONTRAR ───");
const lista = async (q) => (await oficina("/instalaciones" + q)).datos;
let l = await lista("");
ok(l.length === 5, "la lista trae las 5", String(l.length));
ok(l.map((x) => x.number).join() === "5,4,3,2,1", "de la más nueva a la más vieja", l.map((x) => x.number).join());
ok(l.every((x) => x.customerName), "cada una trae el nombre de su cliente");
l = await lista("?q=perez");
ok(l.length === 3 && l.every((x) => x.customerName === "María Pérez"), "«perez» sin tilde encuentra a «María Pérez»", String(l.length));
l = await lista("?q=" + encodeURIComponent("PÉREZ"));
ok(l.length === 3, "y con mayúsculas y tilde también");
l = await lista("?q=escalon");
ok(l.length === 2, "«escalon» encuentra por dirección", String(l.length));
l = await lista("?q=trifasicos");
ok(l.length === 1 && l[0].label === "El taller", "busca también en qué se instaló");
l = await lista("?q=playa");
ok(l.length === 1, "y en cómo le dice el cliente");
l = await lista("?q=INS-00002");
ok(l.length === 1 && l[0].number === 2, "«INS-00002» encuentra la número 2");
l = await lista("?q=2");
ok(l.some((x) => x.number === 2), "y «2» también");
l = await lista("?q=" + encodeURIComponent("%"));
ok(l.length === 0, "un «%» se busca como letra, no como comodín", String(l.length));
l = await lista("?q=" + encodeURIComponent("'; drop table installations; --"));
ok(Array.isArray(l) && l.length === 0, "y un intento de inyección no rompe nada");
l = await lista("?customerId=" + lopez.id);
ok(l.length === 2 && l.every((x) => x.customerId === lopez.id), "se filtra por cliente");
l = await lista("?entrega=entregada");
ok(l.length === 3 && l.every((x) => x.deliveredAt), "«entregadas» trae solo las 3 que tienen fecha", String(l.length));
const sinFecha = (await lista("?entrega=pendiente"));
ok(sinFecha.length === 2 && sinFecha.every((x) => x.deliveredAt === null), "«sin fecha» trae las 2 que no la tienen", String(sinFecha.length));

console.log("\n─── 4 · LA FICHA ───");
let f = (await oficina("/instalaciones/" + e.datos.id)).datos;
ok(f.cotizacion?.number === cot.number, "la ficha trae el número de la cotización de la que salió");
f = (await oficina("/instalaciones/" + a.datos.id)).datos;
ok(f.cotizacion === null, "y nulo si no salió de ninguna");
ok((await oficina("/instalaciones/00000000-0000-4000-8000-000000000000")).estado === 404, "una que no existe → 404");
ok((await oficina("/instalaciones/no-es-un-id")).estado >= 400, "un id sin forma de id no revienta");

console.log("\n─── 5 · CORREGIR ───");
let p = await oficina("/instalaciones/" + a.datos.id, "PATCH", { address: "Km 41 Carretera al Litoral" });
ok(p.estado === 200 && p.datos.address === "Km 41 Carretera al Litoral", "se corrige la dirección");
ok(p.datos.label === "La casa de la playa" && p.datos.deliveredAt === "2026-03-15", "y lo demás queda como estaba");
p = await oficina("/instalaciones/" + a.datos.id, "PATCH", { deliveredAt: null });
ok(p.estado === 200 && p.datos.deliveredAt === null, "la fecha de entrega se puede quitar (null), y queda vacía");
p = await oficina("/instalaciones/" + a.datos.id, "PATCH", { deliveredAt: "2026-04-01" });
ok(p.datos.deliveredAt === "2026-04-01", "y volver a poner");
p = await oficina("/instalaciones/" + a.datos.id, "PATCH", { label: "" });
ok(p.estado === 400, "no se puede dejar sin nombre");
p = await oficina("/instalaciones/" + a.datos.id, "PATCH", { customerId: "00000000-0000-4000-8000-000000000000" });
ok(p.estado === 400, "ni pasarla a un cliente que no existe");
p = await oficina("/instalaciones/00000000-0000-4000-8000-000000000000", "PATCH", { label: "x" });
ok(p.estado === 404, "corregir una que no existe → 404");

// Un cliente quitado DESPUES de cargar la instalacion no impide corregirle la direccion.
await duena("/customers/" + lopez.id, "DELETE");
p = await oficina("/instalaciones/" + b.datos.id, "PATCH", { address: "Colonia Escalón, calle 7" });
ok(p.estado === 200, "si el cliente ya fue quitado, la instalación todavía se puede corregir", `dio ${p.estado}`);
l = await lista("");
ok(l.some((x) => x.id === b.datos.id), "y sigue apareciendo en la lista");

console.log("\n─── 6 · QUITAR ───");
const q1 = await oficina("/instalaciones/" + d.datos.id, "DELETE");
ok(q1.estado === 204, "se quita la que estaba mal cargada");
ok((await oficina("/instalaciones/" + d.datos.id)).estado === 404, "ya no se abre");
l = await lista("");
ok(!l.some((x) => x.id === d.datos.id) && l.length === 4, "ni sale en la lista");
ok((await oficina("/instalaciones/" + d.datos.id, "DELETE")).estado === 404, "quitarla dos veces → 404");
const g = await oficina("/instalaciones", "POST", base);
ok(g.datos.number === 6, "el número 4 quitado NO se reutiliza: la siguiente es la 6", String(g.datos.number));

console.log(fallos ? `\n${fallos} FALLAS` : "\nTodo bien.");
process.exit(fallos ? 1 : 0);
