import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { NavLink, Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api, money, date, number, statuses, cents, centsOrNull, type Customer, type Item, type Profile, type Quote, type Renglon } from "./api";
import "./comercial.css";

function useData<T>(path:string) {
 const [data,setData]=useState<T>(); const [error,setError]=useState(""); const [version,reload]=useState(0);
 // Con ruta vacía no pide nada: sirve para las pantallas que a veces cargan un
 // registro existente y a veces arrancan en blanco.
 useEffect(()=>{if(!path){setData(undefined);return}let live=true;setError("");setData(undefined);api<T>(path).then(d=>{if(live)setData(d)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[path,version]);
 return {data,error,reload:()=>reload(v=>v+1)};
}
function ErrorBox({message}:{message:string}) { return message?<div className="c-error" role="alert">{message}</div>:null }
function State({error,children}:{error:string;children?:ReactNode}) {return <ErrorBox message={error}/> }
function Empty({title,children}:{title:string;children:ReactNode}) {return <div className="c-empty"><span>◇</span><h3>{title}</h3><p>{children}</p></div>}
function Badge({status}:{status:string}) {return <span className={"c-badge "+status}>{statuses[status]??(status==="prospect"?"Prospecto":"Cliente")}</span>}
function Header({title,subtitle,action}:{title:string;subtitle:string;action?:ReactNode}) {return <header className="c-heading"><div><div className="c-eyebrow">GESTIÓN COMERCIAL</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>}
function Field({label,children,wide=false}:{label:string;children:ReactNode;wide?:boolean}) {return <label className={wide?"c-field wide":"c-field"}><span>{label}</span>{children}</label>}
function Modal({title,close,children}:{title:string;close:()=>void;children:ReactNode}) {
 useEffect(()=>{const handler=(e:KeyboardEvent)=>{if(e.key==="Escape")close()};document.addEventListener("keydown",handler);return()=>document.removeEventListener("keydown",handler)},[close]);
 return <div className="c-overlay"><section className="c-modal" role="dialog" aria-modal="true" aria-label={title}><div className="c-modal-head"><h2>{title}</h2><button type="button" onClick={close} aria-label="Cerrar">×</button></div>{children}</section></div>;
}
function Customers() {
 const {data,error,reload}=useData<Customer[]>("/customers"); const [search,setSearch]=useState("");const [filter,setFilter]=useState("all"); const [editing,setEditing]=useState<Partial<Customer>|null>(null); const [failure,setFailure]=useState("");const [busy,setBusy]=useState(false);
 const save=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(busy)return;setBusy(true);setFailure("");const f=new FormData(e.currentTarget);const body=Object.fromEntries([...f].filter(([k,v])=>k!=="email"||v!==""));try{await api(editing?.id?"/customers/"+editing.id:"/customers",editing?.id?"PATCH":"POST",body);setEditing(null);reload()}catch(e){setFailure((e as Error).message)}finally{setBusy(false)}};
 const rows=data?.filter(c=>(filter==="all"||c.stage===filter)&&[c.name,c.email,c.phone,c.nit].some(v=>v?.toLowerCase().includes(search.toLowerCase())));
 return <><Header title="Clientes y prospectos" subtitle="Una relación, todo su historial." action={<button className="c-primary" onClick={()=>{setFailure("");setEditing({stage:"prospect",type:"company"})}}>+ Nuevo contacto</button>}/>
 <div className="c-toolbar"><input aria-label="Buscar clientes" placeholder="Buscar por nombre, teléfono o NIT…" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Tipo de relación" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos los contactos</option><option value="prospect">Prospectos</option><option value="customer">Clientes</option></select><span>{data?.length??0} registros</span></div>
 <State error={error}/>{!data&&!error?<p>Cargando contactos…</p>:<div className="c-card c-scroll"><table><thead><tr><th>Nombre / razón social</th><th>Relación</th><th>Contacto</th><th>Identificación</th><th></th></tr></thead><tbody>{rows?.map(c=><tr key={c.id}><td><Link to={c.id}><strong>{c.name}</strong></Link><small>{c.type==="company"?"Empresa":"Persona"}</small></td><td><Badge status={c.stage}/></td><td>{c.phone||"—"}<small>{c.email}</small></td><td>{c.nit||"—"}</td><td><button className="c-link" onClick={()=>{setFailure("");setEditing(c)}}>Editar</button></td></tr>)}</tbody></table>{!rows?.length&&<Empty title={search?"Sin coincidencias":"Empieza por una relación"}>Registra un prospecto o cliente para preparar su primera cotización.</Empty>}</div>}
 {editing&&<Modal title={editing.id?"Editar contacto":"Nuevo contacto"} close={()=>setEditing(null)}><form onSubmit={save}><div className="c-form-grid"><Field label="Nombre o razón social" wide><input name="name" defaultValue={editing.name} required autoFocus maxLength={160}/></Field><Field label="Relación"><select name="stage" defaultValue={editing.stage}><option value="prospect">Prospecto</option><option value="customer">Cliente</option></select></Field><Field label="Tipo"><select name="type" defaultValue={editing.type}><option value="company">Empresa</option><option value="person">Persona</option></select></Field>{[["phone","Teléfono"],["email","Correo electrónico"],["nit","NIT"],["nrc","NRC"]].map(([key,label])=><Field key={key} label={label!}><input name={key} type={key==="email"?"email":"text"} defaultValue={editing[key as keyof Customer] as string??""}/></Field>)}<Field label="Dirección" wide><input name="address" defaultValue={editing.address??""}/></Field><Field label="Notas de seguimiento" wide><textarea name="notes" defaultValue={editing.notes??""} rows={3}/></Field></div><ErrorBox message={failure}/><div className="c-actions"><button type="button" onClick={()=>setEditing(null)}>Cancelar</button><button className="c-primary" disabled={busy}>{busy?"Guardando…":"Guardar contacto"}</button></div></form></Modal>}
 </>;
}
function CustomerDetail(){
 const {id}=useParams();const c=useData<Customer>("/customers/"+id);const q=useData<Quote[]>("/quotes?customerId="+id);
 return <><Link className="c-back" to="/comercial/clientes">← Clientes y prospectos</Link><Header title={c.data?.name??"Expediente"} subtitle="Información de contacto e historial de cotizaciones." action={<Link className="c-primary" to={"/comercial/cotizaciones/nueva?cliente="+id}>+ Preparar cotización</Link>}/><ErrorBox message={c.error||q.error}/>{c.data&&<div className="c-detail-grid"><aside className="c-card c-pad"><Badge status={c.data.stage}/><h3>Datos del contacto</h3><p>{c.data.phone||"Sin teléfono"}</p><p>{c.data.email||"Sin correo"}</p><p>{c.data.address||"Sin dirección"}</p><hr/><p>NIT: {c.data.nit||"—"}</p><p>NRC: {c.data.nrc||"—"}</p><h3>Seguimiento</h3><p className="c-pre">{c.data.notes||"Sin notas registradas."}</p></aside><section className="c-card c-pad"><h2>Cotizaciones</h2><QuoteTable quotes={q.data??[]} customers={c.data?[c.data]:[]}/>{q.data?.length===0&&<Empty title="Historial por comenzar">Las cotizaciones de este contacto aparecerán aquí.</Empty>}</section></div>}</>;
}
function Catalog(){
 const {data,error,reload}=useData<Item[]>("/catalog-items");const [search,setSearch]=useState("");const [editing,setEditing]=useState<Partial<Item>|null>(null);const [failure,setFailure]=useState("");const [busy,setBusy]=useState(false);
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;setBusy(true);setFailure("");const f=new FormData(e.currentTarget);try{const body={...Object.fromEntries(f),unitPriceCents:cents(String(f.get("price")))};delete (body as Record<string,unknown>).price;await api(editing?.id?"/catalog-items/"+editing.id:"/catalog-items",editing?.id?"PATCH":"POST",body);setEditing(null);reload()}catch(e){setFailure((e as Error).message)}finally{setBusy(false)}}
 return <><Header title="Productos y servicios" subtitle="Los precios de partida para tus cotizaciones." action={<button className="c-primary" onClick={()=>{setFailure("");setEditing({type:"product",unit:"unidad"})}}>+ Agregar al catálogo</button>}/><div className="c-toolbar"><input aria-label="Buscar productos" placeholder="Buscar por código o descripción…" value={search} onChange={e=>setSearch(e.target.value)}/><span>{data?.length??0} productos y servicios</span></div><ErrorBox message={error}/><div className="c-card c-scroll"><table><thead><tr><th>Código</th><th>Producto o servicio</th><th>Unidad</th><th className="c-num">Precio unitario</th><th></th></tr></thead><tbody>{data?.filter(i=>(i.name+" "+i.code).toLowerCase().includes(search.toLowerCase())).map(i=><tr key={i.id}><td>{i.code}</td><td><strong>{i.name}</strong><small>{i.category|| (i.type==="product"?"Producto":"Servicio")}</small></td><td>{i.unit}</td><td className="c-num">{money(i.unitPriceCents)}</td><td><button className="c-link" onClick={()=>{setFailure("");setEditing(i)}}>Editar</button></td></tr>)}</tbody></table>{data?.length===0&&<Empty title="Tu catálogo empieza aquí">Agrega ladrillos, transporte u otros conceptos para cotizar.</Empty>}</div>
 {editing&&<Modal title={editing.id?"Editar producto":"Agregar al catálogo"} close={()=>setEditing(null)}><form onSubmit={save}><div className="c-form-grid"><Field label="Código"><input name="code" defaultValue={editing.code} required autoFocus/></Field><Field label="Tipo"><select name="type" defaultValue={editing.type}><option value="product">Producto</option><option value="service">Servicio</option></select></Field><Field label="Nombre" wide><input name="name" defaultValue={editing.name} required/></Field><Field label="Unidad"><input name="unit" defaultValue={editing.unit} required/></Field><Field label="Precio unitario antes de impuestos (USD)"><input name="price" type="number" min="0" max="1000000" step="0.01" required defaultValue={((editing.unitPriceCents??0)/100).toFixed(2)}/></Field><Field label="Categoría" wide><input name="category" defaultValue={editing.category??""}/></Field></div><ErrorBox message={failure}/><div className="c-actions"><button type="button" onClick={()=>setEditing(null)}>Cancelar</button><button className="c-primary" disabled={busy}>{busy?"Guardando…":"Guardar producto"}</button></div></form></Modal>}</>;
}
function QuoteTable({quotes,customers}:{quotes:Quote[];customers:Customer[]}){
 return <div className="c-scroll"><table><thead><tr><th>Cotización / cliente</th><th>Fecha</th><th>Estado</th><th className="c-num">Total</th><th></th></tr></thead><tbody>{[...quotes].sort((a,b)=>b.number-a.number).map(q=><tr key={q.id}><td><Link to={"/comercial/cotizaciones/"+q.id}><strong>{number(q.number)}</strong></Link><small>{q.customerSnapshot?.name??customers.find(c=>c.id===q.customerId)?.name??"Cliente"}</small></td><td>{date(q.issueDate)}</td><td><Badge status={q.status}/></td><td className="c-num"><strong>{money(q.totalCents)}</strong></td><td><Link className="c-link" to={"/comercial/cotizaciones/"+q.id}>Ver →</Link></td></tr>)}</tbody></table></div>
}
function Quotes(){
 const q=useData<Quote[]>("/quotes");const c=useData<Customer[]>("/customers");const [filter,setFilter]=useState("all"); const [search,setSearch]=useState("");
 const rows=q.data?.filter(q=>(filter==="all"||q.status===filter)&&(number(q.number)+" "+(q.customerSnapshot?.name??c.data?.find(c=>c.id===q.customerId)?.name??"")).toLowerCase().includes(search.toLowerCase()))??[];
 return <><Header title="Cotizaciones" subtitle="Prepara propuestas claras y da seguimiento a cada oportunidad." action={<Link className="c-primary" to="nueva">+ Nueva cotización</Link>}/><div className="c-toolbar"><input aria-label="Buscar cotizaciones" placeholder="Buscar cotización o cliente…" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Estado de cotización" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos los estados</option>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div><ErrorBox message={q.error||c.error}/><section className="c-card"><QuoteTable quotes={rows} customers={c.data??[]}/>{q.data&&!rows.length&&<Empty title="Todo comienza con una buena propuesta">Crea una cotización con tu cliente, productos y condiciones.</Empty>}</section></>;
}
/**
 * Preparar una cotización nueva, o corregir una que ya existe.
 *
 * Es la misma pantalla para las dos cosas a propósito. Antes solo sabía crear,
 * y corregir un precio mal tecleado obligaba a archivar la cotización entera y
 * volver a escribir las doce partidas. Un borrador que no se puede corregir no
 * es un borrador.
 *
 * El precio de cada renglón vive como texto mientras se edita, no como número.
 * Antes se convertía en cada tecla y el error se descartaba en silencio: quien
 * escribía tres decimales veía el campo congelarse sin explicación. Ahora lo
 * que se escribe se conserva tal cual y el aviso aparece debajo del renglón.
 */
function QuoteEditor(){
 const {id}=useParams();
 const corrigiendo=Boolean(id);
 const existente=useData<Quote>(id?"/quotes/"+id:"");
 const customers=useData<Customer[]>("/customers");const items=useData<Item[]>("/catalog-items");const profile=useData<Profile>("/business-profile");
 const navigate=useNavigate();
 const [renglones,setRenglones]=useState<Renglon[]>([{description:"",quantity:1,precio:"0.00"}]);
 const [tax,setTax]=useState(13);
 const [failure,setFailure]=useState("");const [busy,setBusy]=useState(false);const [sembrado,setSembrado]=useState(false);

 // La cotización existente siembra el formulario una sola vez; después manda
 // lo que la persona esté escribiendo.
 useEffect(()=>{
  const q=existente.data; if(!q||sembrado) return;
  setRenglones((q.lines??[]).map(l=>({catalogItemId:l.catalogItemId??undefined,description:l.description,quantity:l.quantity,precio:(l.unitPriceCents/100).toFixed(2)})));
  setTax((q.taxRateMilli??0)/1000);
  setSembrado(true);
 },[existente.data,sembrado]);

 const precios=renglones.map(r=>centsOrNull(r.precio));
 const subtotal=renglones.reduce((s,r,i)=>s+r.quantity*(precios[i]??0),0);
 const taxCents=Math.round(subtotal*tax/100);
 function change(i:number,patch:Partial<Renglon>){setRenglones(old=>old.map((r,j)=>j===i?{...r,...patch}:r))}

 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault(); if(busy) return; setFailure("");
  // El aviso dice cuál partida, no «alguna»: con doce renglones, «revisá las
  // partidas» manda a buscar a ciegas.
  const malas=renglones.map((r,i)=>({n:i+1,ok:Boolean(r.description.trim())&&Number.isFinite(r.quantity)&&r.quantity>0&&precios[i]!==null})).filter(x=>!x.ok);
  if(malas.length){setFailure(`Revisá ${malas.length===1?"la partida":"las partidas"} ${malas.map(m=>m.n).join(", ")}: falta la descripción, la cantidad o el precio está mal escrito.`);return}
  setBusy(true);
  const f=new FormData(e.currentTarget);
  const lines=renglones.map((r,i)=>({catalogItemId:r.catalogItemId,description:r.description,quantity:r.quantity,unitPriceCents:precios[i] as number}));
  try{
   const cuerpo={...Object.fromEntries(f),validityDays:Number(f.get("validityDays")),taxRatePercent:tax,lines};
   const q=corrigiendo
    ? await api<Quote>("/quotes/"+id,"PATCH",cuerpo)
    : await api<Quote>("/quotes","POST",cuerpo);
   navigate("/comercial/cotizaciones/"+q.id);
  }catch(e){setFailure((e as Error).message)}finally{setBusy(false)}
 }

 const q=existente.data;
 if(corrigiendo&&!q) return <><ErrorBox message={existente.error}/>{!existente.error&&<p>Cargando la cotización…</p>}</>;
 const clientePorDefecto=q?q.customerId:new URLSearchParams(location.hash.split("?")[1]).get("cliente")??"";

 return <><Link className="c-back" to={q?"/comercial/cotizaciones/"+q.id:"/comercial/cotizaciones"}>← {q?"Volver a la cotización":"Cotizaciones"}</Link>
 <Header title={q?"Corregir "+number(q.number):"Nueva cotización"} subtitle={q?"Lo que cambies reemplaza a lo anterior. Queda registrado quién y cuándo.":"Precios y datos quedarán guardados con esta propuesta."}/>
 {q&&q.status!=="draft"&&<div className="c-aviso" role="status">Esta cotización ya está «{statuses[q.status]}». Se puede corregir igual, pero si el cliente ya recibió la anterior conviene volvérsela a enviar.</div>}
 <ErrorBox message={customers.error||items.error||profile.error}/>
 <form onSubmit={save} className="c-editor"><div><section className="c-card c-pad"><h2>01 · Cliente y proyecto</h2><div className="c-form-grid"><Field label="Cliente o prospecto" wide><select name="customerId" required defaultValue={clientePorDefecto}><option value="">Selecciona un contacto</option>{customers.data?.filter(c=>c.active||c.id===q?.customerId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Nombre del proyecto" wide><input name="description" defaultValue={q?.description??""} placeholder="Ej. Suministro de ladrillos · Residencial Las Palmas"/></Field><Field label="Lugar de entrega" wide><input name="workLocation" defaultValue={q?.workLocation??""} placeholder="Dirección de la obra o punto de retiro"/></Field><Field label="Vigencia (días)"><input name="validityDays" type="number" defaultValue={q?.validityDays??15} min={1} max={365} required/></Field></div>{customers.data?.length===0&&<p>Primero <Link to="/comercial/clientes">registra un contacto</Link>.</p>}{q&&q.status!=="draft"&&<p style={{fontSize:13}}>El cliente no se puede cambiar en una cotización que ya salió. Si está equivocado, archivala y creá una nueva.</p>}</section>

 <section className="c-card c-pad"><div className="c-section-head"><h2>02 · Productos y servicios</h2><span>{renglones.length} partidas</span></div>{renglones.map((r,i)=><div className="c-line-editor" key={i}><div className="c-line-top"><strong>Partida {i+1}</strong><button type="button" className="c-link" disabled={renglones.length===1} onClick={()=>setRenglones(renglones.filter((_,j)=>j!==i))}>Quitar</button></div><Field label="Seleccionar del catálogo"><select aria-label={"Producto partida "+(i+1)} value={r.catalogItemId??""} onChange={e=>{const it=items.data?.find(v=>v.id===e.target.value);change(i,it?{catalogItemId:it.id,description:it.name+" · "+it.unit,precio:(it.unitPriceCents/100).toFixed(2)}:{catalogItemId:undefined})}}><option value="">Concepto personalizado</option>{items.data?.filter(v=>v.active).map(it=><option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}</select></Field><div className="c-form-grid"><Field label="Descripción" wide><input aria-label={"Descripción partida "+(i+1)} value={r.description} onChange={e=>change(i,{description:e.target.value})} required/></Field><Field label="Cantidad (unidades enteras)"><input aria-label={"Cantidad partida "+(i+1)} type="number" min={1} max={1000000} step={1} value={r.quantity} onChange={e=>change(i,{quantity:Number(e.target.value)})} required/></Field><Field label="Precio unitario (USD)"><input aria-label={"Precio partida "+(i+1)} type="text" inputMode="decimal" value={r.precio} onChange={e=>change(i,{precio:e.target.value})} required/></Field></div>{precios[i]===null&&r.precio.trim()!==""&&<p className="c-error" style={{margin:"0 0 10px"}}>No se entiende «{r.precio}» como precio. Escribí solo el número, por ejemplo 0.65</p>}<div className="c-line-total">{money(r.quantity*(precios[i]??0))}</div></div>)}<button type="button" className="c-secondary" onClick={()=>setRenglones([...renglones,{description:"",quantity:1,precio:"0.00"}])}>+ Agregar partida</button></section>

 <section className="c-card c-pad"><h2>03 · Condiciones</h2><Field label="Condiciones de pago y entrega">{(profile.data||q)&&<textarea name="terms" rows={4} defaultValue={q?(q.terms??""):profile.data?.terms} placeholder="Forma de pago, entrega, transporte y exclusiones…"/>}</Field><Field label="Observaciones de la propuesta"><textarea name="notes" rows={2} defaultValue={q?.notes??""}/></Field></section></div>

 <aside><div className="c-card c-pad c-summary"><span className="c-eyebrow">RESUMEN DE PROPUESTA</span><h2>Importe de la cotización</h2><dl><div><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div></dl><Field label="Impuesto (%)"><input type="number" min={0} max={100} step=".01" value={tax} onChange={e=>setTax(Number(e.target.value))} required/></Field><dl><div><dt>Impuesto</dt><dd>{money(taxCents)}</dd></div><div className="c-grand"><dt>Total</dt><dd>{money(subtotal+taxCents)}</dd></div></dl><ErrorBox message={failure}/><button className="c-primary" disabled={busy||!customers.data?.length}>{busy?"Guardando…":corrigiendo?"Guardar cambios":"Guardar cotización"}</button><p>{corrigiendo?"Reemplaza lo que había. La cotización conserva su número.":"Se guardará como borrador. Luego podrás revisar e imprimir la propuesta."}</p><small>Documento comercial. No es un DTE.</small></div></aside></form></>;
}
/**
 * Todos los estados a los que se puede mover una cotización.
 *
 * Se ofrecen siempre todos menos el actual, no solo «el siguiente». Quien se
 * equivocó de botón tiene que ver, en la misma barra y sin buscar, cómo
 * deshacerlo. Un estado que solo se puede corregir llamando al programador
 * no está corregido.
 */
const ACCIONES:Record<string,string>={draft:"Volver a borrador",sent:"Marcar como emitida",accepted:"Registrar aceptación",rejected:"Registrar rechazo",expired:"Marcar vencida"};
/** El curso natural va primero; las correcciones existen pero no encabezan. */
const CURSO_NATURAL:Record<string,string[]>={draft:["sent"],sent:["accepted","rejected","expired"],accepted:[],rejected:[],expired:[]};
function QuoteDetail(){
 const {id}=useParams();const q=useData<Quote>("/quotes/"+id);const navigate=useNavigate();
 const [failure,setFailure]=useState("");const [busy,setBusy]=useState(false);const [aviso,setAviso]=useState("");const [confirmando,setConfirmando]=useState(false);
 async function status(value:string){if(busy)return;setBusy(true);setFailure("");try{const r=await api<Quote&{aviso?:string|null}>("/quotes/"+id+"/status","PATCH",{status:value});setAviso(r.aviso??"");q.reload()}catch(e){setFailure((e as Error).message)}finally{setBusy(false)}}
 // Sin setBusy(false) al salir bien: la pantalla ya se fue.
 async function archivar(){if(busy)return;setBusy(true);setFailure("");try{await api("/quotes/"+id,"DELETE");navigate("/comercial/cotizaciones")}catch(e){setFailure((e as Error).message);setBusy(false);setConfirmando(false)}}
 const quote=q.data;if(!quote)return <><ErrorBox message={q.error}/>{!q.error&&<p>Cargando cotización…</p>}</>;
 const naturales=CURSO_NATURAL[quote.status]??[];
 const opciones=[...naturales,...Object.keys(ACCIONES).filter(k=>k!==quote.status&&!naturales.includes(k))];
 const customer=quote.customerSnapshot;const business=quote.businessSnapshot;
 const expires=new Date(quote.issueDate);expires.setUTCDate(expires.getUTCDate()+quote.validityDays);
 return <><div className="c-no-print"><Link className="c-back" to="/comercial/cotizaciones">← Cotizaciones</Link><Header title={number(quote.number)} subtitle={quote.description||"Propuesta comercial"} action={<button className="c-primary" onClick={()=>window.print()}>Imprimir / guardar PDF</button>}/><div className="c-statusbar"><Badge status={quote.status}/><Link className="c-primary" to={"/comercial/cotizaciones/"+quote.id+"/editar"}>Corregir</Link>{opciones.map(k=><button key={k} className={naturales.length===1&&naturales[0]===k?"c-primary":""} disabled={busy} onClick={()=>status(k)}>{ACCIONES[k]}</button>)}{confirmando?<span className="c-confirmar">¿Archivar {number(quote.number)}?<button disabled={busy} onClick={archivar}>Sí, archivar</button><button disabled={busy} onClick={()=>setConfirmando(false)}>No</button></span>:<button disabled={busy} onClick={()=>setConfirmando(true)}>Archivar</button>}<span>El envío al cliente se realiza fuera del sistema.</span></div>{aviso&&<div className="c-aviso" role="status">{aviso}</div>}<ErrorBox message={failure}/></div>
 <article className="c-paper"><div className="c-paper-top"><div><span className="c-paper-mark">▥</span><h2>{business?.name??"Empresa · documento anterior"}</h2><p>{business?.address}</p><p>{[business?.phone,business?.email].filter(Boolean).join(" · ")}</p>{business?.nit&&<p>NIT {business.nit}</p>}</div><div className="c-paper-number"><span>COTIZACIÓN</span><h2>{number(quote.number)}</h2><p>Emisión: {date(quote.issueDate)}</p><p>Válida hasta: {date(expires.toISOString())}</p><Badge status={quote.status}/></div></div>
 <div className="c-paper-client"><div><span className="c-eyebrow">PREPARADA PARA</span><h3>{customer?.name??"Cliente · documento anterior sin copia histórica"}</h3><p>{customer?.address}</p><p>{[customer?.phone,customer?.email].filter(Boolean).join(" · ")}</p>{customer?.nit&&<p>NIT: {customer.nit}</p>}</div><div><span className="c-eyebrow">PROYECTO / ENTREGA</span><h3>{quote.description||"Suministro de productos y servicios"}</h3><p>{quote.workLocation||"Por acordar"}</p></div></div>
 <table className="c-paper-lines"><thead><tr><th>Descripción</th><th className="c-num">Cantidad</th><th className="c-num">Precio unitario</th><th className="c-num">Importe</th></tr></thead><tbody>{quote.lines?.map((l,i)=><tr key={i}><td>{l.description}</td><td className="c-num">{l.quantity}</td><td className="c-num">{money(l.unitPriceCents)}</td><td className="c-num">{money(l.subtotalCents??l.quantity*l.unitPriceCents)}</td></tr>)}</tbody></table>
 <div className="c-paper-totals"><dl><div><dt>Subtotal</dt><dd>{money(quote.subtotalCents)}</dd></div><div><dt>Impuestos</dt><dd>{money(quote.taxCents)}</dd></div><div className="c-grand"><dt>Total USD</dt><dd>{money(quote.totalCents)}</dd></div></dl></div>
 <div className="c-paper-terms"><h3>Condiciones comerciales</h3><p className="c-pre">{quote.terms||"Condiciones por acordar con el cliente."}</p>{quote.notes&&<><h3>Observaciones</h3><p className="c-pre">{quote.notes}</p></>}</div><footer>Gracias por considerar nuestra propuesta. · Documento comercial, no constituye comprobante fiscal.</footer></article></>;
}
function Settings({onSaved}:{onSaved:()=>void}) {
 const p=useData<Profile>("/business-profile");const [failure,setFailure]=useState("");const [saved,setSaved]=useState(false);const [busy,setBusy]=useState(false);
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setSaved(false);try{await api("/business-profile","PUT",Object.fromEntries(new FormData(e.currentTarget)));setSaved(true);setFailure("");onSaved()}catch(e){setFailure((e as Error).message)}finally{setBusy(false)}}
 return <><Header title="Mi empresa" subtitle="La información que aparecerá en tus nuevas cotizaciones."/><ErrorBox message={p.error}/>{p.data&&<form className="c-card c-pad c-settings" onSubmit={save}><div className="c-form-grid"><Field label="Nombre comercial / razón social" wide><input required name="name" defaultValue={p.data.name}/></Field>{[["phone","Teléfono"],["email","Correo electrónico"],["nit","NIT"],["address","Dirección"]].map(([k,l])=><Field key={k} label={l!}><input name={k} type={k==="email"?"email":"text"} defaultValue={p.data?.[k as keyof Profile]??""}/></Field>)}<Field label="Condiciones predeterminadas" wide><textarea name="terms" rows={5} defaultValue={p.data.terms}/></Field></div><ErrorBox message={failure}/>{saved&&<p role="status" className="c-success">Configuración guardada. Las cotizaciones anteriores conservan sus datos.</p>}<div className="c-actions"><button className="c-primary" disabled={busy}>{busy?"Guardando…":"Guardar configuración"}</button></div></form>}</>;
}
function Dashboard(){
 const c=useData<Customer[]>("/customers");const q=useData<Quote[]>("/quotes");const items=useData<Item[]>("/catalog-items");
 const pending=q.data?.filter(q=>q.status==="sent")??[];
 return <><Header title="Tu actividad comercial" subtitle="De la primera conversación a una propuesta concreta." action={<Link className="c-primary" to="/comercial/cotizaciones/nueva">+ Nueva cotización</Link>}/><ErrorBox message={c.error||q.error||items.error}/><div className="c-stats">{[["Prospectos",c.data?String(c.data.filter(c=>c.stage==="prospect").length):"—","Relaciones por desarrollar"],["Clientes",c.data?String(c.data.filter(c=>c.stage==="customer").length):"—","Contactos registrados"],["Cotizaciones emitidas",q.data?String(pending.length):"—","Pendientes de decisión"],["Valor propuesto",q.data?money(pending.reduce((s,q)=>s+q.totalCents,0)):"—","No representa cuentas por cobrar"]].map(([title,val,desc])=><section className="c-stat" key={title}><span>{title}</span><strong>{val}</strong><small>{desc}</small></section>)}</div>
 <div className="c-home-grid"><section className="c-card"><div className="c-pad c-section-head"><h2>Últimas cotizaciones</h2><Link to="/comercial/cotizaciones">Ver todas →</Link></div><QuoteTable quotes={[...(q.data??[])].sort((a,b)=>b.number-a.number).slice(0,5)} customers={c.data??[]}/>{q.data?.length===0&&<Empty title="Prepara tu primera cotización">Registra un contacto, agrega productos y crea una propuesta lista para presentar.</Empty>}</section><aside className="c-card c-pad"><span className="c-eyebrow">PRIMEROS PASOS</span><h2>Deja tu negocio listo</h2>{[["01","Configura tu empresa","Datos y condiciones comerciales","/comercial/empresa"],["02","Registra tus contactos","Prospectos y clientes en un lugar","/comercial/clientes"],["03","Prepara tu catálogo","Productos y servicios para cotizar","/comercial/productos"]].map(([n,t,s,l])=><Link className="c-step" key={n} to={l!}><span>{n}</span><div><strong>{t}</strong><small>{s}</small></div><b>↗</b></Link>)}<div className="c-note">Primera etapa · Pedidos, cobros, pagos e inventario se incorporarán sobre esta base. Los DTE quedan para el final.</div></aside></div></>;
}
export default function Comercial(){
 const p=useData<Profile>("/business-profile");
 return <div id="commercial"><aside className="c-sidebar"><Link className="c-logo" to="/comercial"><span>▥</span> ROOTMINT<small>CONSTRUCCIÓN</small></Link><div className="c-company"><span>{(p.data?.name??"M").slice(0,1).toUpperCase()}</span><div><strong>{p.data?.name??"Mi empresa"}</strong><small>Espacio comercial</small></div></div><div className="c-nav-label">COMERCIAL</div><nav>{[["","◫","Resumen"],["clientes","◎","Clientes y prospectos"],["cotizaciones","▤","Cotizaciones"],["productos","▦","Productos y servicios"]].map(([path,icon,label])=><NavLink key={path} to={"/comercial"+(path?"/"+path:"")} end={path===""}><span>{icon}</span>{label}</NavLink>)}</nav><div className="c-nav-label">ADMINISTRACIÓN</div><nav><NavLink to="/comercial/empresa"><span>⚙</span>Mi empresa</NavLink><Link to="/lotes"><span>↗</span>Abrir producción</Link></nav><div className="c-sidebar-bottom"><span className="c-dot"/>Versión de desarrollo<small>Usar únicamente datos de prueba.</small></div></aside><div className="c-workspace"><div className="c-topbar"><span>Construcción <b>/</b> Área comercial</span><span className="c-environment">{/^(localhost|127\.0\.0\.1)$/.test(location.hostname)?"DESARROLLO LOCAL":"VERSIÓN DE PRUEBA"}</span></div><main><Routes><Route index element={<Dashboard/>}/><Route path="clientes" element={<Customers/>}/><Route path="clientes/:id" element={<CustomerDetail/>}/><Route path="productos" element={<Catalog/>}/><Route path="cotizaciones" element={<Quotes/>}/><Route path="cotizaciones/nueva" element={<QuoteEditor/>}/><Route path="cotizaciones/:id/editar" element={<QuoteEditor/>}/><Route path="cotizaciones/:id" element={<QuoteDetail/>}/><Route path="empresa" element={<Settings onSaved={p.reload}/>}/><Route path="*" element={<Empty title="Página no encontrada"><Link to="/comercial">Volver al resumen</Link></Empty>}/></Routes></main><footer className="c-workspace-footer">ROOTMINT · GESTIÓN PARA CONSTRUCCIÓN<span>USD · El Salvador</span></footer></div></div>
}

