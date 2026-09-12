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
  await request('PATCH','/quotes/'+q.id+'/status',{status:'accepted'},409);
  await request('PATCH','/quotes/'+q.id+'/status',{status:'sent'});
  await request('PATCH','/quotes/'+q.id+'/status',{status:'accepted'});
  await request('PATCH','/quotes/'+q.id+'/status',{status:'draft'},409);
  await request('DELETE','/quotes/'+q.id,undefined,409);
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
  console.log('PASS: totals, historical snapshots, stages, state transitions, overflow, invalid input, active catalog, concurrent numbers, soft deletion and API 404.');
} finally { await app.close();await pool.end(); }
