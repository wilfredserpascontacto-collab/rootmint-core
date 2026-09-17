import assert from 'node:assert/strict';
process.env.ROOTMINT_LOCAL = '1';
process.env.ROOTMINT_LOCAL_DATA = 'memory://';
delete process.env.DATABASE_URL;
const { buildServer } = await import('../dist/server.js');
const { pool } = await import('../dist/db/client.js');
const app = await buildServer();
async function request(method,url,payload,status=200) {
  const res = await app.inject({ method,url,payload });
  assert.equal(res.statusCode,status,res.body);
  return res.body ? res.json() : undefined;
}
try {
  await request('PUT','/business-profile',{name:'Empresa de prueba',terms:'Entrega por acordar.'});
  const c = await request('POST','/customers',{name:'Prospecto de prueba',type:'company',stage:'prospect'},201);
  const p = await request('POST','/catalog-items',{name:'Ladrillo prueba',code:'TEST-1',type:'product',unit:'unidad',unitPriceCents:65},201);
  const body={customerId:c.id,taxRatePercent:13,lines:[{catalogItemId:p.id,quantity:3000}]};
  const q=await request('POST','/quotes',body,201);
  assert.equal(q.subtotalCents,195000);assert.equal(q.taxCents,25350);assert.equal(q.totalCents,220350);
  assert.equal(q.customerSnapshot.name,'Prospecto de prueba');
  await request('PATCH','/customers/'+c.id,{name:'Nombre nuevo',stage:'customer'});
  await request('PATCH','/catalog-items/'+p.id,{unitPriceCents:95});
  await request('PUT','/business-profile',{name:'Empresa nueva'});
  const historical=await request('GET','/quotes/'+q.id);
  assert.equal(historical.lines[0].unitPriceCents,65);assert.equal(historical.customerSnapshot.name,'Prospecto de prueba');assert.equal(historical.businessSnapshot.name,'Empresa de prueba');
  // --- Corregir una cotización guardada ---------------------------------
  // Antes esto no existía: una cotización guardada era de piedra.
  const editada = await request('PATCH','/quotes/'+q.id,{lines:[{description:'Bloque corregido',quantity:100,unitPriceCents:50}]});
  assert.equal(editada.subtotalCents,5000);
  assert.equal(editada.taxCents,650,'conserva el 13% sin que se lo vuelvan a mandar');
  assert.equal(editada.totalCents,5650);
  assert.deepEqual(editada.avisos,[],'corregir un borrador no necesita aviso');
  // La partida vieja no se borra, se da de baja: el detalle solo trae la nueva.
  const releida = await request('GET','/quotes/'+q.id);
  assert.equal(releida.lines.length,1);
  assert.equal(releida.lines[0].description,'Bloque corregido');
  // Cambiar solo la tasa recalcula sobre las partidas que ya están.
  const sinImpuesto = await request('PATCH','/quotes/'+q.id,{taxRatePercent:0});
  assert.equal(sinImpuesto.taxCents,0);
  assert.equal(sinImpuesto.totalCents,5000);
  await request('PATCH','/quotes/'+q.id,{taxRatePercent:13});
  // El cliente sí se puede cambiar mientras es borrador, y el retrato se vuelve a congelar.
  const otro = await request('POST','/customers',{name:'Cliente equivocado',type:'company'},201);
  const reasignada = await request('PATCH','/quotes/'+q.id,{customerId:otro.id});
  assert.equal(reasignada.customerSnapshot.name,'Cliente equivocado');
  await request('PATCH','/quotes/'+q.id,{customerId:c.id});

  // --- La ficha financiera del cliente ------------------------------------
  await request('PATCH','/customers/'+c.id,{creditLimitCents:10000,creditTermDays:45});
  const ficha = await request('GET','/customers/'+c.id);
  assert.equal(ficha.creditLimitCents,10000);
  assert.equal(ficha.creditTermDays,45);
  // Un precio propio, más barato que los 95 del catálogo.
  const precio = await request('POST','/customer-prices',{customerId:c.id,catalogItemId:p.id,unitPriceCents:58},201);
  assert.equal(precio.description,'Ladrillo prueba','el nombre se toma del catálogo si no lo escriben');
  // Un precio suelto sí necesita nombre: sin producto y sin descripción no sirve a nadie.
  await request('POST','/customer-prices',{customerId:c.id,unitPriceCents:100},400);
  // Al cotizar gana el acuerdo, y el sistema dice de dónde salió el precio.
  const conAcuerdo = await request('POST','/quotes',{customerId:c.id,taxRatePercent:0,lines:[{catalogItemId:p.id,quantity:100}]},201);
  assert.equal(conAcuerdo.lines[0].unitPriceCents,58);
  assert.equal(conAcuerdo.subtotalCents,5800);
  assert.match(conAcuerdo.avisos.join(' '),/precio acordado/);
  // Pero lo que se teclea a mano manda sobre el acuerdo.
  const aMano = await request('POST','/quotes',{customerId:c.id,taxRatePercent:0,lines:[{catalogItemId:p.id,quantity:100,unitPriceCents:70}]},201);
  assert.equal(aMano.lines[0].unitPriceCents,70);
  // Pasarse del límite avisa y no impide.
  const pasada = await request('POST','/quotes',{customerId:c.id,taxRatePercent:0,lines:[{catalogItemId:p.id,quantity:5000}]},201);
  assert.match(pasada.avisos.join(' '),/límite de crédito/);
  assert.equal(pasada.status,'draft','avisar no es impedir');
  // Notas de plata: se apilan con fecha, se corrigen y se dan de baja.
  const n1 = await request('POST','/customer-notes',{customerId:c.id,body:'Pidio prorroga hasta fin de mes'},201);
  await request('POST','/customer-notes',{customerId:c.id,body:'Abono parcial en efectivo',notedOn:'2026-01-15'},201);
  const notas = await request('GET','/customer-notes?customerId='+c.id);
  assert.equal(notas.length,2);
  assert.equal(notas[0].id,n1.id,'la más reciente va primero');
  await request('PATCH','/customer-notes/'+n1.id,{body:'Pidio prorroga hasta el 5'});
  await request('DELETE','/customer-notes/'+n1.id,undefined,204);
  assert.equal((await request('GET','/customer-notes?customerId='+c.id)).length,1);

  // Ningún estado es una puerta de un solo sentido: el que se equivoca de
  // botón tiene que poder deshacerlo, y el que va por el camino natural no
  // tiene que ver avisos que no le hacen falta.
  const emitida=await request('PATCH','/quotes/'+q.id+'/status',{status:'sent'});
  assert.deepEqual(emitida.avisos,[],'el curso natural no debe avisar');
  // Ya emitida y aun así corregible: avisa, no impide.
  const tocadaEmitida = await request('PATCH','/quotes/'+q.id,{description:'Proyecto corregido despues de emitir'});
  assert.match(tocadaEmitida.avisos[0],/ya está «Emitida»/,'corregir algo emitido tiene que avisar');
  // Pero el cliente ya no: sería otro documento con el mismo número.
  await request('PATCH','/quotes/'+q.id,{customerId:otro.id},409);
  await request('PATCH','/quotes/'+q.id+'/status',{status:'accepted'});
  const corregida=await request('PATCH','/quotes/'+q.id+'/status',{status:'draft'});
  assert.equal(corregida.status,'draft');
  assert.match(corregida.avisos[0],/corrigió/,'volver atrás debe avisar sin impedir');
  // Y una cotización ya emitida al cliente equivocado se puede archivar.
  await request('PATCH','/quotes/'+q.id+'/status',{status:'sent'});
  await request('DELETE','/quotes/'+q.id,undefined,204);
  await request('GET','/quotes/'+q.id,undefined,404);
  await request('POST','/quotes',{...body,lines:[{description:'Invalid',quantity:-1,unitPriceCents:1}]},400);
  await request('POST','/quotes',{...body,lines:[{description:'Overflow',quantity:1000000,unitPriceCents:1000000}]},400);
  await request('POST','/quotes',{...body,customerId:'11111111-1111-4111-8111-111111111111'},400);
  await request('PATCH','/catalog-items/'+p.id,{active:false});
  await request('POST','/quotes',body,400);
  const manual={customerId:c.id,lines:[{description:'Servicio',quantity:1,unitPriceCents:500}]};
  const parallel=await Promise.all([request('POST','/quotes',manual,201),request('POST','/quotes',manual,201)]);
  assert.notEqual(parallel[0].number,parallel[1].number);
  await request('DELETE','/quotes/'+parallel[0].id,undefined,204);
  await request('GET','/quotes/'+parallel[0].id,undefined,404);
  await request('GET','/quotes/missing-route/test',undefined,404);
  console.log('PASA: totales, ficha financiera del cliente, precio acordado que gana al catálogo, aviso de crédito, notas con fecha, corrección de contenido con recálculo, copias históricas, etapas, corrección de estado con aviso, archivado en cualquier estado, desbordamiento, entradas inválidas, catálogo activo, correlativos en paralelo, baja lógica y 404 de la API.');
} finally { await app.close();await pool.end(); }
