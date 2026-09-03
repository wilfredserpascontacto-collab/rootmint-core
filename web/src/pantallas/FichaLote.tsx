import { Link, useParams } from "react-router-dom";
import { useApi } from "../usar";
import { cantidad, fecha, money, moneyFino, mpa, unidad, type Ficha } from "../api";
import { Cargando, Fallo, IconoAviso, claseCalidad } from "../comp/piezas";

/**
 * La ficha del lote: costo y resistencia, del mismo tamaño y dentro del mismo
 * recuadro.
 *
 * No hay una vista que muestre solo el costo. Bajarle el cemento a un bloque
 * lo abarata y lo debilita; separar las dos cifras convertiría eso en un juego
 * con marcador que se gana cada semana.
 */
export default function FichaLote() {
  const { id } = useParams();
  const { dato, error, cargando } = useApi<Ficha>(id ? `/bloques/lotes/${id}/ficha` : null);

  if (cargando) return <main className="lienzo"><Cargando que="la ficha del lote" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;
  if (!dato) return null;

  const f = dato;
  const c = f.calidad;
  const brechaColor = f.brechaCents > 0 ? "var(--falla)" : f.brechaCents < 0 ? "var(--cumple)" : "var(--apagado)";
  const rendMal = f.real.rendimientoPct < 90;
  const totalConsumo = f.consumo.reduce((s, l) => s + l.subtotalCents, 0);

  return (
    <main className="lienzo">
      <div className="fila" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 32, flexWrap: "wrap" }}>
        <div className="pila" style={{ gap: 6 }}>
          <Link to="/lotes" className="lbl" style={{ textDecoration: "none" }}>← Ficha de lote</Link>
          <div className="fila" style={{ gap: 18, alignItems: "baseline", flexWrap: "wrap" }}>
            <h1 className="titulo">LOTE {String(f.lote.numero).padStart(3, "0")}</h1>
            <span style={{ fontSize: 17, color: "var(--apagado)" }}>
              {f.tipoBloque.nombre} · receta «{f.receta.nombre}»
            </span>
          </div>
        </div>
        <div className="pila mono" style={{ alignItems: "flex-end", gap: 5, fontSize: 13, color: "var(--apagado)" }}>
          <span>Producido {fecha(f.lote.producidoEl)} · {f.lote.mezclas} mezclas</span>
          <span>
            {f.ensayo
              ? `Ensayado ${fecha(f.ensayo.ensayadoEl)} · ${f.ensayo.edadDias} días`
              : "Sin ensayo registrado"}
          </span>
        </div>
      </div>

      <div className="rejilla dos-uno">
        {/* --- Las dos cifras, juntas --- */}
        <div className="pila" style={{ gap: 10 }}>
          <div className="tarjeta fuerte" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
            <div className="pila" style={{ gap: 10, padding: "30px 32px", borderRight: "1px solid var(--linea)" }}>
              <span className="lbl">Costo real por bloque</span>
              <span className="cifra enorme mono">{money(f.real.costoRealPorBloqueCents)}</span>
              <div className="fila mono" style={{ gap: 10, fontSize: 14, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ color: "var(--apagado)" }}>teórico {money(f.teorico.costoPorBloqueCents)}</span>
                <span style={{ color: brechaColor, fontWeight: 500 }}>
                  {f.brechaCents >= 0 ? "+" : "−"}{money(Math.abs(f.brechaCents))}
                </span>
              </div>
            </div>

            <div className="pila" style={{ gap: 10, padding: "30px 32px" }}>
              <span className="lbl">Resistencia a {f.ensayo?.edadDias ?? 28} días</span>
              {c.estado === "cumple" || c.estado === "no cumple" ? (
                <div className="fila" style={{ gap: 12, alignItems: "baseline" }}>
                  <span className="cifra enorme mono">{mpa(c.resistenciaMpaMilli)}</span>
                  <span className="cond" style={{ fontSize: 26, fontWeight: 600, color: "var(--apagado)" }}>MPa</span>
                </div>
              ) : (
                <span className="cifra enorme mono" style={{ color: "var(--incierto)" }}>—</span>
              )}
              <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
                <span className={`insignia ${claseCalidad(c)}`}>{c.estado}</span>
                <span className="mono" style={{ fontSize: 14, color: "var(--apagado)" }}>
                  objetivo {mpa(f.objetivo.mpaMilli)} · área {f.objetivo.criterio}
                </span>
              </div>
            </div>
          </div>

          {c.estado === "no comparable" || c.estado === "sin ensayar" ? (
            <div className={`aviso ${c.estado === "no comparable" ? "ambar" : "neutro"}`}>
              <IconoAviso color={c.estado === "no comparable" ? "var(--ambar-tinta)" : "var(--apagado)"} />
              <span>{c.detalle}</span>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--apagado)", maxWidth: "62ch" }}>
              Las dos cifras se muestran siempre juntas. Bajarle el cemento a un bloque lo abarata y lo
              debilita: separar el costo de la resistencia premiaría justo lo que no hay que hacer.
            </p>
          )}
        </div>

        {/* --- Lo que pasó con los bloques --- */}
        <div className="tarjeta pila">
          <div className="pila" style={{ gap: 4, padding: "20px 24px", borderBottom: "1px solid var(--linea)" }}>
            <span className="lbl">Rendimiento</span>
            <div className="fila" style={{ gap: 10, alignItems: "baseline" }}>
              <span className="cifra grande mono" style={{ color: rendMal ? "var(--falla)" : "var(--tinta)" }}>
                {f.real.rendimientoPct}%
              </span>
              <span className="mono" style={{ fontSize: 13, color: "var(--apagado)" }}>
                {f.real.bloquesBuenos} de {f.real.bloquesEsperados}
              </span>
            </div>
            <div className="progreso" style={{ marginTop: 6 }}>
              <span style={{ width: `${Math.min(100, f.real.rendimientoPct)}%`, background: rendMal ? "var(--falla)" : "var(--tinta)" }} />
            </div>
          </div>

          <div className="pila" style={{ gap: 4, padding: "20px 24px", borderBottom: "1px solid var(--linea)" }}>
            <span className="lbl">Desperdicio</span>
            <div className="fila" style={{ gap: 10, alignItems: "baseline" }}>
              <span className="cifra media mono">{f.real.desperdicioPct}%</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--apagado)" }}>
                {f.lote.bloquesRotos} rotos
              </span>
            </div>
          </div>

          <div className="pila" style={{ gap: 6, padding: "20px 24px" }}>
            <span className="lbl">Lo que costó de más</span>
            <span className="cifra media mono">{money(f.perdidaRotosCents)}</span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: "var(--apagado)" }}>
              Los {f.lote.bloquesRotos} bloques que se rompieron, a costo teórico. Material pagado que no se vende.
            </span>
          </div>
        </div>
      </div>

      {/* --- Consumo congelado --- */}
      <div className="rejilla dos-uno">
        <div className="tarjeta">
          <div className="fila" style={{ justifyContent: "space-between", gap: 16, padding: "16px 24px", borderBottom: "1px solid var(--linea)" }}>
            <span className="lbl">Consumo del lote · precios congelados del {fecha(f.lote.producidoEl)}</span>
            <span className="mono" style={{ fontSize: 13, color: "var(--apagado)" }}>{f.lote.mezclas} mezclas</span>
          </div>
          <div className="envoltura-tabla">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Costo unit.</th>
                  <th className="num">Costo</th>
                </tr>
              </thead>
              <tbody>
                {f.consumo.map((l, i) => (
                  <tr key={i}>
                    <td>{l.descripcion}</td>
                    <td className="num">{cantidad(l.cantidadMilli, l.unidad)}</td>
                    {/* El precio congelado es el de COMPRA (por m3, por bolsa) y la
                        cantidad va en unidades de dosificacion: ponerlos lado a lado
                        haria que la fila no multiplicara. Se muestra el costo por
                        unidad dosificada, que si cuadra con el subtotal. */}
                    <td className="num" style={{ color: "var(--apagado)" }}>
                      {moneyFino(l.subtotalCents / Math.max(1, l.cantidadMilli / 1000))} / {unidad(1000, l.unidad)}
                    </td>
                    <td className="num">{money(l.subtotalCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total material</td>
                  <td /><td />
                  <td className="num" style={{ fontSize: 16 }}>{money(totalConsumo)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="tarjeta pila" style={{ gap: 14, padding: "20px 24px 24px" }}>
          <span className="lbl">El ensayo</span>
          {f.ensayo ? (
            <div className="pila" style={{ gap: 10 }}>
              <Dato k="Probetas" v={String(f.ensayo.probetas)} />
              <Dato k="Edad" v={`${f.ensayo.edadDias} días`} />
              <Dato k="Criterio de área" v={f.ensayo.criterio === "net" ? "neta" : "bruta"} />
              <Dato k="Hecho en" v={f.ensayo.fuente === "plant" ? "la planta" : "laboratorio"} />
              <Dato k="Lo registró" v={f.ensayo.origenLectura === "person" ? "una persona" : "la máquina"} />
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--apagado)" }}>
              Este lote todavía no tiene ensayo. Hasta que lo tenga, el sistema no dice que el bloque
              esté bien: dice que no se sabe.
            </p>
          )}
          <div style={{ height: 1, background: "var(--linea-suave)" }} />
          {/* El mantenimiento que estaba vencido cuando se corrió este lote,
              congelado al cerrarlo. Es la pista que explica, meses después,
              por qué un lote rindió mal. */}
          <span className="lbl">Mantenimiento al correrlo</span>
          {f.lote.mantenimientoVencido.length > 0 ? (
            <div className="pila" style={{ gap: 8 }}>
              {f.lote.mantenimientoVencido.map((m) => (
                <div key={m.taskId} className="fila" style={{ gap: 10, alignItems: "flex-start" }}>
                  <IconoAviso color="var(--falla)" size={16} />
                  <span style={{ fontSize: 13.5, lineHeight: 1.45 }}>
                    <strong>{m.nombre}</strong> estaba vencida por {m.vencidaPor} {m.unidad}.
                  </span>
                </div>
              ))}
              <span style={{ fontSize: 13, lineHeight: 1.45, color: "var(--apagado)" }}>
                No impidió producir. Queda anotado por si este lote sale distinto a los demás.
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 14, color: "var(--apagado)", lineHeight: 1.5 }}>
              Sin mantenimiento vencido cuando se corrió.
            </span>
          )}
          <div style={{ height: 1, background: "var(--linea-suave)" }} />
          <span className="lbl">De dónde salió el conteo</span>
          <span style={{ fontSize: 14, color: "var(--apagado)", lineHeight: 1.5 }}>
            {f.lote.origenConteo === "person"
              ? "Lo contó una persona en la planta."
              : `Lo reportó la máquina${f.lote.ciclosMaquina ? ` (${f.lote.ciclosMaquina} ciclos)` : ""}.`}
          </span>
        </div>
      </div>
    </main>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="fila" style={{ justifyContent: "space-between", gap: 12, fontSize: 14 }}>
      <span style={{ color: "var(--apagado)" }}>{k}</span>
      <span className="mono">{v}</span>
    </div>
  );
}
