export type Precio = { id:string; customerId:string; catalogItemId?:string|null; description:string; unitPriceCents:number; unit?:string|null; notes?:string|null };
export type NotaPlata = { id:string; customerId:string; notedOn:string; body:string };
export type Customer = { id:string; name:string; creditLimitCents?:number|null; creditTermDays?:number|null; type:"person"|"company"; stage:"prospect"|"customer"; phone?:string; email?:string; address?:string; nit?:string; nrc?:string; notes?:string; active:boolean };
export type Item = { id:string; name:string; code:string; type:"product"|"service"; unit:string; unitPriceCents:number; category?:string; blockTypeId?:string|null; active:boolean };
export type Profile = { name:string; phone?:string; email?:string; address?:string; nit?:string; terms?:string };
export type Line = { catalogItemId?:string|null; description:string; quantity:number; unitPriceCents:number; subtotalCents?:number };
/** El renglón mientras se edita: el precio vive como texto para no perder lo que se teclea. */
export type Renglon = { catalogItemId?:string; description:string; quantity:number; precio:string; tocado?:boolean };
export type Existencia = { blockTypeId:string; code:string; name:string; existencia:number; lotes:number; ultimoLote:string|null; catalogItemId:string|null; catalogItemName:string|null; unitPriceCents:number|null };
export type MovimientoInv = { id:string; blockTypeId:string; quantity:number; reason:string; refType?:string|null; note?:string|null; notedAt:string };
/** Lo que falta fabricar de una cotización, renglón por renglón. */
export type QueProducir = { quoteLineId:string; description:string; pedido:number; esProducible:boolean; sinEnlazar:boolean; enExistencia:number|null; hayQueProducir:number|null; blockTypeId:string|null; blockTypeName:string|null };
export const MOTIVO_INV:Record<string,string>={produccion:"Producción",venta:"Venta",ajuste:"Ajuste",rotura:"Rotura",devolucion:"Devolución"};
/** Una orden de producción vista desde el área comercial: lo que se le mandó a fabricar a la planta. */
export type Orden = { id:string; number:number; quoteId:string|null; customerName:string|null; status:"pendiente"|"en_proceso"|"terminada"|"anulada"; neededBy:string|null; notes:string|null; pedido:number; producido:number; falta:number; avisos?:string[] };
export const ESTADO_ORDEN:Record<string,string>={pendiente:"Pendiente",en_proceso:"En proceso",terminada:"Terminada",anulada:"Anulada"};
export type Factura = { id:string; kind:"ccf"|"final"; number:number; customerId:string; quoteId?:string|null; issueDate:string; status:"issued"|"annulled"; subtotalCents:number; taxCents:number; totalCents:number; taxRateMilli:number; notes?:string|null; annulledAt?:string|null; annulReason?:string|null; customerSnapshot?:Customer; businessSnapshot?:Profile; lines?:Line[]; avisos?:string[] };
/** Un renglón de la cotización con lo que ya se facturó y lo que falta. */
export type PorFacturar = { quoteLineId:string; description:string; unitPriceCents:number; cotizado:number; facturado:number; pendiente:number };
/** Los dos documentos de cobro que existen en El Salvador. */
export const TIPO_FACTURA:Record<string,string>={ccf:"Crédito fiscal",final:"Consumidor final"};
export const numeroFactura=(kind:string,n:number)=>(kind==="ccf"?"CCF-":"FCF-")+String(n).padStart(5,"0");
export type Quote = { id:string; number:number; customerId:string; issueDate:string; validityDays:number; status:string; subtotalCents:number; taxCents:number; totalCents:number; taxRateMilli?:number; description?:string; workLocation?:string; terms?:string; notes?:string; contactId?:string|null; customerSnapshot?:Customer; businessSnapshot?:Profile; lines?:Line[]; avisos?:string[] };
import { avisarSinSesion } from "../acceso/sesion";

export async function api<T>(path:string, method="GET", body?:unknown):Promise<T> {
 // La cabecera de JSON solo cuando de verdad viaja un JSON. Anunciarla con el
 // cuerpo vacío —lo que pasa en todo DELETE— hace que Fastify conteste 400
 // «Body cannot be empty», un error en inglés y de la casa que no tiene nada
 // que ver con lo que la persona hizo.
 const response=await fetch(path,{ method, headers:body===undefined?undefined:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body) });
 const data=await response.json().catch(()=>null);
 // 401 no es un error de la pantalla: es que la sesion se acabo. La app
 // vuelve a la entrada en vez de mostrar un mensaje que nadie sabe resolver.
 if(response.status===401){ avisarSinSesion(); throw new Error("Se cerró la sesión. Volvé a entrar."); }
 if(!response.ok) throw new Error(data?.details?.[0]?.message ? data.error+": "+data.details[0].message : data?.error ?? "No se pudo conectar. Intenta de nuevo.");
 return data;
}
export const money=(value:number)=>new Intl.NumberFormat("es-SV",{style:"currency",currency:"USD"}).format(value/100);
export const date=(value:string)=>new Intl.DateTimeFormat("es-SV",{timeZone:"America/El_Salvador",year:"numeric",month:"short",day:"numeric"}).format(new Date(value));
export const statuses:Record<string,string>={draft:"Borrador",sent:"Emitida",accepted:"Aceptada",rejected:"Rechazada",expired:"Vencida"};
export const number=(n:number)=>"COT-"+String(n).padStart(5,"0");
/**
 * Un monto escrito por una persona, en centavos.
 *
 * Acepta lo que la gente de verdad teclea o pega: «1,250.00» copiado de una
 * planilla, «$1250», «1250.5», con espacios de más. Antes solo entraba el
 * formato exacto y pegar una celda de Excel daba error, que es justo el momento
 * en que alguien decide que el sistema estorba.
 *
 * Más de dos decimales se redondean al centavo en vez de rebotar: nadie quiere
 * que un campo se trabe por haber escrito 2.333. Lo que no se puede adivinar
 * —letras, vacío, dos puntos decimales— sí se rechaza, y el mensaje repite lo
 * que se escribió para que se vea dónde está el error.
 */
export function cents(value:string) {
 let bruto=String(value).trim().replace(/^\$/,"").replace(/\s/g,"");
 // La coma es separador de miles en El Salvador («2,203.50»), salvo cuando es
 // la única y la siguen exactamente dos dígitos sin punto por ningún lado:
 // ahí quien escribió «1,50» quiso decir un dólar cincuenta, no ciento
 // cincuenta. Adivinar mal en silencio sería multiplicar el precio por cien.
 const comaDecimal=!bruto.includes(".")&&/^-?\d+,\d{2}$/.test(bruto);
 const limpio=comaDecimal?bruto.replace(",","."):bruto.replace(/,/g,"");
 if(limpio===""||!/^-?\d*\.?\d+$/.test(limpio)) throw new Error(`No se entiende «${value}» como monto. Escribí solo el número, por ejemplo 1250.00`);
 const n=Number(limpio);
 if(!Number.isFinite(n)) throw new Error(`No se entiende «${value}» como monto.`);
 if(n<0) throw new Error("El monto no puede ser negativo.");
 return Math.round(n*100);
}
/** Lo mismo pero sin reventar: sirve para avisar mientras la persona escribe. */
export function centsOrNull(value:string){ try{ return cents(value) }catch{ return null } }


// --- Servicio: instalaciones ---------------------------------------------

export type Instalacion = {
  id: string; number: number; customerId: string; customerName: string;
  quoteId: string | null; label: string; address: string; description: string;
  /** Un DIA (AAAA-MM-DD), no un instante. Nulo: todavia no se entrega, o nadie cargo la fecha. */
  deliveredAt: string | null;
  notes: string | null; createdAt: string; updatedAt: string;
  cotizacion?: { id: string; number: number } | null;
};
export const numeroInstalacion = (n: number) => "INS-" + String(n).padStart(5, "0");

/**
 * Un dia de calendario, escrito para leerse. NO usa `date()` de arriba, a
 * proposito: esa convierte un instante a la hora de El Salvador, y un dia
 * suelto («2026-03-15») se interpreta como medianoche UTC, que alla es las
 * 6 de la tarde del 14. La entrega saldria un dia antes en pantalla.
 */
export const dia = (value: string) => {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("es-SV", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" })
    .format(new Date(Date.UTC(y!, m! - 1, d!)));
};
