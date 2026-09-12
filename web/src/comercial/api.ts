export type Customer = { id:string; name:string; type:"person"|"company"; stage:"prospect"|"customer"; phone?:string; email?:string; address?:string; nit?:string; nrc?:string; notes?:string; active:boolean };
export type Item = { id:string; name:string; code:string; type:"product"|"service"; unit:string; unitPriceCents:number; category?:string; active:boolean };
export type Profile = { name:string; phone?:string; email?:string; address?:string; nit?:string; terms?:string };
export type Line = { catalogItemId?:string; description:string; quantity:number; unitPriceCents:number; subtotalCents?:number };
export type Quote = { id:string; number:number; customerId:string; issueDate:string; validityDays:number; status:string; subtotalCents:number; taxCents:number; totalCents:number; description?:string; workLocation?:string; terms?:string; notes?:string; customerSnapshot?:Customer; businessSnapshot?:Profile; lines?:Line[] };
export async function api<T>(path:string, method="GET", body?:unknown):Promise<T> {
 const response=await fetch(path,{ method, headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body) });
 const data=await response.json().catch(()=>null);
 if(!response.ok) throw new Error(data?.details?.[0]?.message ? data.error+": "+data.details[0].message : data?.error ?? "No se pudo conectar. Intenta de nuevo.");
 return data;
}
export const money=(value:number)=>new Intl.NumberFormat("es-SV",{style:"currency",currency:"USD"}).format(value/100);
export const date=(value:string)=>new Intl.DateTimeFormat("es-SV",{timeZone:"America/El_Salvador",year:"numeric",month:"short",day:"numeric"}).format(new Date(value));
export const statuses:Record<string,string>={draft:"Borrador",sent:"Emitida",accepted:"Aceptada",rejected:"Rechazada",expired:"Vencida"};
export const number=(n:number)=>"COT-"+String(n).padStart(5,"0");
export function cents(value:string) { if(!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Usa un precio positivo con hasta dos decimales."); const [whole,part=""]=value.split("."); return Number(whole)*100+Number(part.padEnd(2,"0")); }

