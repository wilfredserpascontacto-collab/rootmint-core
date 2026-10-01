/**
 * Garantias, golpeando la API como la usaria la oficina.
 *
 * Servidor con ROOTMINT_MODULES=comercial,servicio y base vacia. Las fechas
 * se arman respecto a HOY (el de El Salvador), asi la prueba sigue valiendo
 * mañana.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4811";
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

// Dias relativos a hoy en El Salvador.
const hoy = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const mas = (dia, n) => new Date(Date.parse(dia + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const mesesMas = (dia, n) => {
  const [y, m, d] = dia.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ty = Math.floor(idx / 12), tm = (idx % 12) + 1;
  const ultimo = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
};

const duena = navegador();
const anonimo = navegador();

console.log("\n─── 0 · PREPARAR ───");
await duena("/auth/primera-duena", "POST", { name: "Francisco", email: "f@fenix.sv", password: "unaClaveLarga1" });
const cli = (await duena("/customers", "POST", { name: "María Pérez", type: "person", stage: "customer" })).datos;
await duena("/users", "POST", { name: "Oficina", email: "of@fenix.sv", password: "claveOficina1", role: "staff" });
await duena("/users", "POST", { name: "Calle", email: "el@fenix.sv", password: "claveCalle11", role: "viewer" });
const oficina = navegador(); await oficina("/auth/entrar", "POST", { email: "of@fenix.sv", password: "claveOficina1" });
const calle = navegador(); await calle("/auth/entrar", "POST", { email: "el@fenix.sv", password: "claveCalle11" });
const nueva = async (label, deliveredAt) =>
  (await oficina("/instalaciones", "POST", { customerId: cli.id, label, address: "Dir " + label, description: "Algo", deliveredAt })).datos;
const entregada = mesesMas(hoy, -2); // entregada hace 2 meses
const i1 = await nueva("Casa uno", entregada);
const i2 = await nueva("Sin fecha", null);
ok(Boolean(i1?.id && i2?.id), "hay dos instalaciones: una entregada hace 2 meses y otra sin fecha");

console.log("\n─── 1 · LA PREGUNTA DEL DÍA, antes de cargar nada ───");
let f = (await oficina("/instalaciones/" + i1.id)).datos;
ok(f.garantia.estado === "sin_garantia", "entregada y sin garantía cargada → «sin garantía»", f.garantia.estado);
f = (await oficina("/instalaciones/" + i2.id)).datos;
ok(f.garantia.estado === "sin_fecha", "sin fecha de entrega y sin garantía → «sin fecha»: NO se sabe, no se inventa", f.garantia.estado);
ok(Array.isArray(f.garantias) && f.garantias.length === 0, "y la ficha trae la lista de garantías, vacía");

console.log("\n─── 2 · LA PUERTA ───");
for (const [m, r] of [["GET", "/garantias"], ["POST", `/instalaciones/${i1.id}/garantias`], ["PATCH", "/garantias/x"], ["POST", "/garantias/x/anular"], ["GET", "/garantias/plantilla"]]) {
  const x = await anonimo(r, m, m === "GET" ? undefined : {});
  ok(x.estado === 401, `${m} ${r} sin sesión → 401`, `dio ${x.estado}`);
}
for (const [m, r] of [["GET", "/garantias"], ["POST", `/instalaciones/${i1.id}/garantias`]]) {
  const x = await calle(r, m, m === "GET" ? undefined : {});
  ok(x.estado === 403, `${m} ${r} con cuenta de solo lectura → 403`, `dio ${x.estado}`);
}

console.log("\n─── 3 · DAR UNA GARANTÍA (la duración es libre) ───");
const mal = [
  [{}, "sin duración"],
  [{ months: 6, endsAt: mas(hoy, 100) }, "con meses Y fecha a la vez"],
  [{ months: 0 }, "de 0 meses"],
  [{ months: 6.5 }, "de 6 meses y medio"],
  [{ months: 999 }, "de 999 meses"],
  [{ endsAt: "2026-02-31" }, "con un 31 de febrero"],
  [{ startsAt: mas(hoy, 10), endsAt: hoy }, "que termina antes de empezar"],
];
for (const [c, que] of mal) {
  const r = await oficina(`/instalaciones/${i1.id}/garantias`, "POST", c);
  ok(r.estado === 400, `se rechaza ${que}`, `dio ${r.estado}`);
}
let r = await oficina(`/instalaciones/${i2.id}/garantias`, "POST", { months: 6 });
ok(r.estado === 400 && /fecha de entrega/i.test(r.datos.error), "sin fecha de entrega y sin inicio explícito: se pide, no se inventa", JSON.stringify(r.datos));
ok((await oficina(`/instalaciones/00000000-0000-4000-8000-000000000000/garantias`, "POST", { months: 6 })).estado === 404, "instalación que no existe → 404");

const g6 = await oficina(`/instalaciones/${i1.id}/garantias`, "POST", { months: 6 });
ok(g6.estado === 201, "6 meses: se crea", JSON.stringify(g6.datos)?.slice(0, 150));
ok(g6.datos.startsAt === entregada, "arranca el día de la entrega (sin teclearlo)", g6.datos.startsAt);
ok(g6.datos.endsAt === mesesMas(entregada, 6), "y termina 6 meses después, calculado", `${g6.datos.endsAt} vs ${mesesMas(entregada, 6)}`);
ok(g6.datos.estado === "vigente" && g6.datos.diasRestantes > 0, "y está vigente, con los días que quedan");
ok(Array.isArray(g6.datos.avisos) && g6.datos.avisos.length === 0, "sin avisos");
ok(g6.datos.faltanTextos.length === 4, "sin los cuatro textos del Art. 33, dice qué falta para el certificado", String(g6.datos.faltanTextos.length));

f = (await oficina("/instalaciones/" + i1.id)).datos;
ok(f.garantia.estado === "en_garantia" && f.garantia.hasta === g6.datos.endsAt, "la pregunta del día: EN GARANTÍA hasta la fecha de fin", JSON.stringify(f.garantia));
ok(f.garantia.diasRestantes === g6.datos.diasRestantes, "con los días que quedan");
ok(f.garantias.length === 1 && f.garantias[0].id === g6.datos.id, "y la ficha lista la garantía");

// Otro cliente, otro plazo: un año, con fecha de inicio explícita.
const i3 = await nueva("Casa tres", mesesMas(hoy, -1));
const g12 = await oficina(`/instalaciones/${i3.id}/garantias`, "POST", { months: 12 });
ok(g12.datos.endsAt === mesesMas(mesesMas(hoy, -1), 12), "a otro cliente, 1 año: cada garantía lleva su plazo");
const i4 = await nueva("Casa cuatro", null);
const gExp = await oficina(`/instalaciones/${i4.id}/garantias`, "POST", { startsAt: mas(hoy, -10), endsAt: mas(hoy, 20) });
ok(gExp.estado === 201 && gExp.datos.endsAt === mas(hoy, 20), "con fecha de inicio y de fin explícitas (aunque no haya fecha de entrega)");
f = (await oficina("/instalaciones/" + i4.id)).datos;
ok(f.garantia.estado === "en_garantia", "y con una garantía cargada se sabe, aunque falte la fecha de entrega");

console.log("\n─── 4 · AVISAR NO ES IMPEDIR ───");
r = await oficina(`/instalaciones/${i1.id}/garantias`, "POST", { months: 3 });
ok(r.estado === 201 && r.datos.avisos.some((a) => /otra garantía del trabajo/i.test(a)), "una segunda garantía del trabajo en las mismas fechas: se guarda y AVISA", JSON.stringify(r.datos.avisos));
const gSolapada = r.datos;
r = await oficina(`/instalaciones/${i1.id}/garantias`, "POST", { startsAt: mas(entregada, -400), months: 3 });
ok(r.estado === 201 && r.datos.avisos.some((a) => /ya está vencida/i.test(a)) && r.datos.avisos.some((a) => /distinto al de la entrega/i.test(a)),
   "una que nace vencida y con inicio distinto a la entrega: se guarda y AVISA las dos cosas", JSON.stringify(r.datos.avisos));
const gVencida = r.datos;
f = (await oficina("/instalaciones/" + i1.id)).datos;
ok(f.garantia.estado === "en_garantia", "la vencida de antes no le quita la garantía vigente");

console.log("\n─── 5 · EDITAR (Francisco lo pidió: a unos 6 meses, a otros un año) ───");
let p = await oficina("/garantias/" + g6.datos.id, "PATCH", { months: 12 });
ok(p.estado === 200 && p.datos.endsAt === mesesMas(entregada, 12), "de 6 a 12 meses: el fin se recalcula desde el inicio", `${p.datos.endsAt}`);
ok(p.datos.startsAt === entregada, "y el inicio no se mueve");
p = await oficina("/garantias/" + g6.datos.id, "PATCH", { endsAt: mas(hoy, 45) });
ok(p.datos.endsAt === mas(hoy, 45) && p.datos.diasRestantes === 45, "o con una fecha de fin exacta: quedan 45 días", JSON.stringify([p.datos.endsAt, p.datos.diasRestantes]));
p = await oficina("/garantias/" + g6.datos.id, "PATCH", { months: 6, endsAt: mas(hoy, 45) });
ok(p.estado === 400, "meses Y fecha a la vez se rechaza");
p = await oficina("/garantias/" + g6.datos.id, "PATCH", { endsAt: mas(entregada, -1) });
ok(p.estado === 400, "no se puede dejar terminando antes de empezar");
p = await oficina("/garantias/" + g6.datos.id, "PATCH", { startsAt: mas(hoy, 200) });
ok(p.estado === 400, "ni mover el inicio más allá del fin (el fin no se corre solo)");
p = await oficina("/garantias/" + g6.datos.id, "PATCH", {
  conditions: "Cubre defectos de instalación y mano de obra.",
  customerDuties: "Dar acceso al técnico y no manipular el tablero.",
  howToClaim: "Llamar al 7000-0000 con el número de instalación.",
  issuedBy: "Grupo Phonix, S.A. de C.V.",
});
ok(p.estado === 200 && p.datos.faltanTextos.length === 0, "con los cuatro textos del Art. 33 ya no falta nada para el certificado");
ok(p.datos.endsAt === mas(hoy, 45), "y guardar los textos no toca las fechas");
p = await oficina("/garantias/" + g6.datos.id, "PATCH", { conditions: "   " });
ok(p.datos.faltanTextos.includes("las condiciones, formas y plazos"), "un texto en blanco cuenta como faltante");
ok((await oficina("/garantias/00000000-0000-4000-8000-000000000000", "PATCH", { months: 3 })).estado === 404, "editar una que no existe → 404");

console.log("\n─── 6 · LA PLANTILLA (no teclear los 4 párrafos cada vez) ───");
await oficina("/garantias/" + g6.datos.id, "PATCH", { conditions: "Cubre defectos de instalación y mano de obra." });
const pl = (await oficina("/garantias/plantilla")).datos;
ok(/mano de obra/.test(pl.conditions) && /Phonix/.test(pl.issuedBy), "trae los textos de la última garantía que los tiene", JSON.stringify(pl).slice(0, 120));

console.log("\n─── 7 · ANULAR ───");
r = await oficina("/garantias/" + gSolapada.id + "/anular", "POST", {});
ok(r.estado === 400, "anular pide motivo");
r = await oficina("/garantias/" + gSolapada.id + "/anular", "POST", { reason: "ab" });
ok(r.estado === 400, "y que no sea de dos letras");
r = await oficina("/garantias/" + gSolapada.id + "/anular", "POST", { reason: "Se cargó dos veces por error" });
ok(r.estado === 200 && r.datos.estado === "anulada" && r.datos.annulReason, "se anula con su motivo");
ok((await oficina("/garantias/" + gSolapada.id + "/anular", "POST", { reason: "otra vez" })).estado === 409, "anular dos veces → 409");
ok((await oficina("/garantias/" + gSolapada.id, "PATCH", { months: 3 })).estado === 409, "una anulada no se edita");
f = (await oficina("/instalaciones/" + i1.id)).datos;
ok(f.garantias.some((g) => g.id === gSolapada.id && g.estado === "anulada"), "pero sigue en la ficha, marcada: no se borra");

console.log("\n─── 8 · SOLO ANULADAS: ya no hay garantía ───");
const i5 = await nueva("Casa cinco", mesesMas(hoy, -1));
const g5 = (await oficina(`/instalaciones/${i5.id}/garantias`, "POST", { months: 6 })).datos;
await oficina("/garantias/" + g5.id + "/anular", "POST", { reason: "Error de carga" });
f = (await oficina("/instalaciones/" + i5.id)).datos;
ok(f.garantia.estado === "sin_garantia", "con su única garantía anulada, vuelve a «sin garantía»", f.garantia.estado);

console.log("\n─── 9 · LA LISTA TRAE EL ESTADO ───");
const lista = (await oficina("/instalaciones")).datos;
const de = (id) => lista.find((x) => x.id === id).garantia.estado;
ok(de(i1.id) === "en_garantia" && de(i2.id) === "sin_fecha" && de(i5.id) === "sin_garantia", "cada fila de la lista dice si está en garantía");

console.log("\n─── 10 · «LAS QUE VENCEN ESTE MES» ───");
// Una que vence hoy mismo, una que venció ayer, una que vence en 200 días.
const iHoy = await nueva("Vence hoy", mesesMas(hoy, -6));
const gHoy = (await oficina(`/instalaciones/${iHoy.id}/garantias`, "POST", { startsAt: mas(hoy, -30), endsAt: hoy })).datos;
ok(gHoy.estado === "vigente" && gHoy.diasRestantes === 0, "la que termina hoy sigue vigente (0 días): el último día se cuenta");
const iAyer = await nueva("Venció ayer", mesesMas(hoy, -6));
const gAyer = (await oficina(`/instalaciones/${iAyer.id}/garantias`, "POST", { startsAt: mas(hoy, -30), endsAt: mas(hoy, -1) })).datos;
ok(gAyer.estado === "vencida", "la que terminó ayer ya venció");
f = (await oficina("/instalaciones/" + iAyer.id)).datos;
ok(f.garantia.estado === "vencida" && f.garantia.haceDias === 1, "y la instalación dice «vencida hace 1 día»", JSON.stringify(f.garantia));

let v = (await oficina(`/garantias?desde=${mas(hoy, -1)}&hasta=${hoy}`)).datos;
ok(v.length === 2 && v.map((x) => x.id).sort().join() === [gHoy.id, gAyer.id].sort().join(), "el periodo ayer-hoy trae justo las dos", String(v.length));
ok(v[0].endsAt <= v[1].endsAt, "ordenadas por la que vence primero");
ok(v[0].instalacion?.label && v[0].customer?.name === "María Pérez", "cada una trae su instalación y su cliente");
v = (await oficina(`/garantias?desde=${mas(hoy, 100)}&hasta=${mas(hoy, 120)}`)).datos;
ok(v.length === 0 || v.every((x) => x.endsAt >= mas(hoy, 100)), "un periodo lejano no trae las de hoy");
v = (await oficina(`/garantias?desde=${mas(hoy, -400)}&hasta=${mas(hoy, 400)}`)).datos;
ok(!v.some((x) => x.id === gSolapada.id), "las anuladas no aparecen");
v = (await oficina(`/garantias?desde=${mas(hoy, -400)}&hasta=${mas(hoy, 400)}&incluirAnuladas=true`)).datos;
ok(v.some((x) => x.id === gSolapada.id), "salvo que se pidan");
v = (await oficina("/garantias")).datos;
ok(Array.isArray(v), "sin parámetros trae el mes actual");
ok((await oficina("/garantias?desde=2026-02-31")).estado === 400, "una fecha imposible se rechaza");
ok((await oficina(`/garantias?desde=${hoy}&hasta=${mas(hoy, -5)}`)).estado === 400, "un periodo al revés se rechaza");

console.log("\n─── 11 · CORREGIR LA ENTREGA, QUITAR LA INSTALACIÓN ───");
p = await oficina("/instalaciones/" + i1.id, "PATCH", { deliveredAt: mas(entregada, 3) });
ok(p.estado === 200 && p.datos.avisos.some((a) => /garantía/i.test(a) && /no se movieron/i.test(a)),
   "corregir la entrega AVISA que las garantías ya cargadas no se movieron solas", JSON.stringify(p.datos.avisos));
f = (await oficina("/instalaciones/" + i1.id)).datos;
ok(f.garantias.find((g) => g.id === g6.datos.id).startsAt === entregada, "y de verdad no se movieron");
p = await oficina("/instalaciones/" + i1.id, "PATCH", { address: "Otra dirección" });
ok(p.estado === 200 && p.datos.avisos.length === 0, "corregir otra cosa no avisa nada");
r = await oficina("/instalaciones/" + i1.id, "DELETE");
ok(r.estado === 409 && /garantías vigentes/i.test(r.datos.error), "una instalación con garantía viva NO se quita", JSON.stringify(r.datos));
r = await oficina("/instalaciones/" + i5.id, "DELETE");
ok(r.estado === 204, "pero la que solo tiene anuladas sí");

console.log(fallos ? `\n${fallos} FALLAS` : "\nTodo bien.");
process.exit(fallos ? 1 : 0);
