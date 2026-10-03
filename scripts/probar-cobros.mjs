/**
 * Cobros y estado de cuenta: la factura deja de ser deuda.
 *
 *   npm run build
 *   ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=.local-cob PORT=4440 node dist/index.js &
 *   BASE=http://127.0.0.1:4440 node scripts/probar-cobros.mjs
 *
 * Necesita una base vacia: empieza creando la primera duena.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4440";
let fallos = 0;
const ok = (b, t, extra = "") => {
  console.log(`  ${b ? "✓" : "✗"} ${t}${extra ? "  — " + extra : ""}`);
  if (!b) fallos++;
};

let galleta = "";
async function pedir(ruta, cuerpo, metodo) {
  const r = await fetch(BASE + ruta, {
    method: metodo ?? (cuerpo ? "POST" : "GET"),
    headers: {
      ...(cuerpo ? { "content-type": "application/json" } : {}),
      ...(galleta ? { cookie: galleta } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const set = r.headers.get("set-cookie");
  if (set) galleta = set.split(";")[0];
  return { estado: r.status, cuerpo: await r.json().catch(() => null) };
}

await pedir("/auth/primera-duena", {
  name: "Amada",
  email: "amada@bloquestitan.com",
  password: "unaClaveLarga1",
});

const diasAtras = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

// Dos clientes: uno con plazo y tope, otro sin nada pactado.
const ana = (
  await pedir("/customers", {
    name: "Constructora Ana",
    type: "company",
    nrc: "111111-1",
    creditLimitCents: 20000,
    creditTermDays: 30,
  })
).cuerpo;
const beto = (await pedir("/customers", { name: "Beto", type: "person" })).cuerpo;

const factura = async (cliente, cantidad, hace = 0) =>
  (
    await pedir("/invoices", {
      customerId: cliente.id,
      issueDate: diasAtras(hace),
      lines: [{ description: "Bloques", unitPriceCents: 100, quantity: cantidad }],
    })
  ).cuerpo;

const vieja = await factura(ana, 100, 45); // 100 × $1.00 + 13% = $113.00, hace 45 dias: vencida
const nueva = await factura(ana, 100, 5); // lo mismo, hace 5 dias: al corriente
const deBeto = await factura(beto, 50, 2); // $56.50
ok(vieja.totalCents === 11300, "la factura vieja es de $113.00", String(vieja.totalCents));
ok(nueva.totalCents === 11300 && deBeto.totalCents === 5650, "y las otras también cuadran");

console.log("\n=== el estado de cuenta antes de cobrar nada ===");
const ec0 = (await pedir(`/customers/${ana.id}/estado-cuenta`)).cuerpo;
ok(ec0.totales.facturadoCents === 22600, "se le facturó $226.00", String(ec0.totales.facturadoCents));
ok(ec0.totales.saldoCents === 22600, "y debe todo", String(ec0.totales.saldoCents));
ok(ec0.totales.vencidoCents === 11300, "de lo cual $113.00 está vencido", String(ec0.totales.vencidoCents));
const fv = ec0.facturas.find((f) => f.id === vieja.id);
ok(fv.estado === "vencida" && fv.diasVencida === 15, "la vieja dice vencida hace 15 días", `${fv.estado} ${fv.diasVencida}`);
ok(ec0.facturas.find((f) => f.id === nueva.id).estado === "pendiente", "la nueva está pendiente, no vencida");
ok(ec0.avisos.some((a) => /tope de crédito es \$200\.00/.test(a)), "avisa que pasó su tope de $200", ec0.avisos.join(" | "));
ok(ec0.avisos.some((a) => /vencidos/.test(a)), "y que hay plata vencida");

console.log("\n=== cobrar por partes ===");
const c1 = await pedir(`/invoices/${vieja.id}/pagos`, {
  amountCents: 5000,
  method: "transferencia",
  reference: "TRF-001",
});
ok(c1.estado === 201, "se anota un cobro de $50.00", `estado ${c1.estado}`);
ok(c1.cuerpo.saldoCents === 6300, "la factura queda debiendo $63.00", String(c1.cuerpo.saldoCents));
ok(c1.cuerpo.reference === "TRF-001" && c1.cuerpo.method === "transferencia", "con su método y su referencia");
const d1 = (await pedir(`/invoices/${vieja.id}`)).cuerpo;
ok(d1.cobradoCents === 5000 && d1.saldoCents === 6300, "la factura misma ya muestra lo cobrado y el saldo");
const lista = (await pedir(`/invoices?customerId=${ana.id}`)).cuerpo;
ok(lista.find((f) => f.id === vieja.id)?.saldoCents === 6300, "y también en el listado");
const ec1 = (await pedir(`/customers/${ana.id}/estado-cuenta`)).cuerpo;
ok(ec1.facturas.find((f) => f.id === vieja.id).estado === "vencida", "sigue vencida: pagó una parte");
ok(ec1.totales.vencidoCents === 6300, "pero lo vencido bajó a $63.00", String(ec1.totales.vencidoCents));

const c2 = await pedir(`/invoices/${vieja.id}/pagos`, { amountCents: 6300 });
ok(c2.cuerpo.saldoCents === 0, "el segundo cobro la deja en cero");
ok(c2.cuerpo.avisos.some((a) => /pagada por completo/.test(a)), "y lo dice", c2.cuerpo.avisos[0]);
const ec2 = (await pedir(`/customers/${ana.id}/estado-cuenta`)).cuerpo;
ok(ec2.facturas.find((f) => f.id === vieja.id).estado === "pagada", "queda pagada");
ok(ec2.totales.vencidoCents === 0, "y ya no hay nada vencido");
ok(ec2.pagos.length === 2, "el estado de cuenta lista los 2 cobros", String(ec2.pagos.length));
ok(ec2.avisos.every((a) => !/vencidos/.test(a)), "sin avisos de vencimiento");

console.log("\n=== cobrar de más ===");
const c3 = await pedir(`/invoices/${nueva.id}/pagos`, { amountCents: 12000 });
ok(c3.estado === 201, "se anota aunque se pase: no se impide");
ok(
  c3.cuerpo.avisos.some((a) => /quedan \$7\.00 a favor del cliente/.test(a)),
  "y avisa que quedan $7.00 a favor",
  c3.cuerpo.avisos.join(" | "),
);
ok(c3.cuerpo.saldoCents === -700, "el saldo queda en −$7.00", String(c3.cuerpo.saldoCents));

console.log("\n=== anular un cobro ===");
const sinMotivo = await pedir(`/pagos/${c3.cuerpo.id}/anular`, {});
ok(sinMotivo.estado === 400, "no deja anular sin decir por qué");
const anu = await pedir(`/pagos/${c3.cuerpo.id}/anular`, { reason: "Se anotó en la factura equivocada" });
ok(anu.estado === 200, "se anula con su motivo");
ok(anu.cuerpo.saldoCents === 11300, "la factura vuelve a deber $113.00", String(anu.cuerpo.saldoCents));
ok(anu.cuerpo.avisos.some((a) => /Quedó anulado el cobro de \$120\.00/.test(a)), "y lo explica", anu.cuerpo.avisos[0]);
const doble = await pedir(`/pagos/${c3.cuerpo.id}/anular`, { reason: "Otra vez" });
ok(doble.estado === 409, "no se anula dos veces", `estado ${doble.estado}`);
const ec3 = (await pedir(`/customers/${ana.id}/estado-cuenta`)).cuerpo;
const cobroAnulado = ec3.pagos.find((p) => p.id === c3.cuerpo.id);
ok(cobroAnulado?.annulledAt && cobroAnulado.annulReason, "el cobro anulado sigue en la historia, con su motivo");
ok(ec3.totales.cobradoCents === 11300, "pero ya no cuenta: se cobró $113.00 en total", String(ec3.totales.cobradoCents));

console.log("\n=== lo que no se puede ===");
for (const [monto, texto] of [[0, "cero"], [-500, "negativo"], [12.5, "con decimales"], ["mucho", "texto"]]) {
  const r = await pedir(`/invoices/${nueva.id}/pagos`, { amountCents: monto });
  ok(r.estado === 400, `un cobro ${texto} se rechaza`, `estado ${r.estado}`);
}
const fantasma = await pedir("/invoices/00000000-0000-4000-8000-000000000000/pagos", { amountCents: 100 });
ok(fantasma.estado === 404, "cobrar una factura que no existe da 404");

const cobroVivo = await pedir(`/invoices/${nueva.id}/pagos`, { amountCents: 1000 });
const anularConCobro = await pedir(`/invoices/${nueva.id}/anular`, { reason: "Error de cliente" });
ok(anularConCobro.estado === 409, "no se anula una factura con cobros vivos", `estado ${anularConCobro.estado}`);
ok(/cobrados/.test(anularConCobro.cuerpo?.error ?? ""), "y dice que hay que anular los cobros", anularConCobro.cuerpo?.error);
await pedir(`/pagos/${cobroVivo.cuerpo.id}/anular`, { reason: "Era del otro cliente" });
const anularLimpia = await pedir(`/invoices/${nueva.id}/anular`, { reason: "Error de cliente" });
ok(anularLimpia.estado === 200, "anulados los cobros, la factura sí se anula");
const sobreAnulada = await pedir(`/invoices/${nueva.id}/pagos`, { amountCents: 100 });
ok(sobreAnulada.estado === 409, "y a una factura anulada no se le anota ningún cobro", `estado ${sobreAnulada.estado}`);
const ec4 = (await pedir(`/customers/${ana.id}/estado-cuenta`)).cuerpo;
ok(ec4.facturas.find((f) => f.id === nueva.id).estado === "anulada", "en el estado de cuenta figura anulada");
ok(ec4.totales.facturadoCents === 11300, "y no suma a lo facturado", String(ec4.totales.facturadoCents));

console.log("\n=== el detalle de una factura ===");
const det = (await pedir(`/invoices/${vieja.id}/pagos`)).cuerpo;
ok(det.pagos.length === 2 && det.saldoCents === 0, "lista sus 2 cobros y saldo 0");
ok(det.cobradoCents === 11300 && det.totalCents === 11300, "con total y cobrado", `${det.cobradoCents}/${det.totalCents}`);

console.log("\n=== quién debe ===");
const pc = (await pedir("/cobros/por-cobrar")).cuerpo;
ok(pc.clientes.length === 1, "solo Beto debe: Ana quedó al día", pc.clientes.map((c) => c.name).join(", "));
ok(pc.clientes[0].name === "Beto" && pc.clientes[0].saldoCents === 5650, "Beto debe $56.50");
ok(pc.clientes[0].vencidoCents === 0, "sin plazo pactado nada se considera vencido");
ok(pc.clientes[0].diasDesdeLaMasVieja === 2, "y su factura más vieja tiene 2 días", String(pc.clientes[0].diasDesdeLaMasVieja));
const otra = await factura(ana, 300, 40); // $339.00, vencida
const pc2 = (await pedir("/cobros/por-cobrar")).cuerpo;
ok(pc2.clientes[0].name === "Constructora Ana", "ahora Ana va primero: es la que más debe");
ok(pc2.clientes[0].pasaDelTope === true, "y se marca que pasó su tope");
ok(pc2.totales.saldoCents === 33900 + 5650, "el total por cobrar suma a los dos", String(pc2.totales.saldoCents));
ok(pc2.totales.vencidoCents === 33900, "y lo vencido es lo de Ana", String(pc2.totales.vencidoCents));
ok(otra.id !== undefined, "(factura de prueba creada)");

console.log(fallos === 0 ? "\nTODO BIEN" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
