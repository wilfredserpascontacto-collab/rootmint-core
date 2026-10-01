import { useEffect, useState, type ReactNode } from "react";
import { api, statuses } from "./api";

/**
 * Las piezas sueltas de las pantallas de oficina: pedir datos, mostrar un
 * error, un vacio, un titulo, un campo, una ventana. Viven aparte para que el
 * area comercial y el area de servicio se vean y se comporten igual sin que
 * una importe a la otra.
 */
export function useData<T>(path:string) {
 const [data,setData]=useState<T>(); const [error,setError]=useState(""); const [version,reload]=useState(0);
 // Con ruta vacía no pide nada: sirve para las pantallas que a veces cargan un
 // registro existente y a veces arrancan en blanco.
 useEffect(()=>{if(!path){setData(undefined);return}let live=true;setError("");setData(undefined);api<T>(path).then(d=>{if(live)setData(d)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[path,version]);
 return {data,error,reload:()=>reload(v=>v+1)};
}
export function ErrorBox({message}:{message:string}) { return message?<div className="c-error" role="alert">{message}</div>:null }
export function State({error,children}:{error:string;children?:ReactNode}) {return <ErrorBox message={error}/> }
export function Empty({title,children}:{title:string;children:ReactNode}) {return <div className="c-empty"><span>◇</span><h3>{title}</h3><p>{children}</p></div>}
export function Badge({status}:{status:string}) {return <span className={"c-badge "+status}>{statuses[status]??(status==="prospect"?"Prospecto":"Cliente")}</span>}
export function Header({title,subtitle,action,eyebrow="GESTIÓN COMERCIAL"}:{title:string;subtitle:string;action?:ReactNode;eyebrow?:string}) {return <header className="c-heading"><div><div className="c-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>}
export function Field({label,children,wide=false}:{label:string;children:ReactNode;wide?:boolean}) {return <label className={wide?"c-field wide":"c-field"}><span>{label}</span>{children}</label>}
export function Modal({title,close,children}:{title:string;close:()=>void;children:ReactNode}) {
 useEffect(()=>{const handler=(e:KeyboardEvent)=>{if(e.key==="Escape")close()};document.addEventListener("keydown",handler);return()=>document.removeEventListener("keydown",handler)},[close]);
 return <div className="c-overlay"><section className="c-modal" role="dialog" aria-modal="true" aria-label={title}><div className="c-modal-head"><h2>{title}</h2><button type="button" onClick={close} aria-label="Cerrar">×</button></div>{children}</section></div>;
}
