import { useMemo } from "react";

/**
 * El código que sube por la mitad de abajo de la pantalla.
 *
 * Es decoración declarada: las líneas se generan acá, no salen de la base de
 * datos y no significan nada. Existe porque un tablero industrial que se ve
 * vivo se lee como un tablero industrial, y eso vale cuando alguien está
 * viendo el sistema por primera vez.
 *
 * Por eso mismo hay una regla que no se rompe: acá NO aparece nada que se
 * pueda confundir con un dato de la planta. Ni un costo, ni una resistencia,
 * ni un número de lote, ni un porcentaje de rendimiento. Si una cifra
 * inventada se pudiera leer como real, el adorno estaría mintiendo, y todo
 * el resto del sistema existe para no hacer eso.
 *
 * Lo que sube es ruido de máquina: registros, direcciones, opcodes, estados
 * de bus. Nada de eso tiene lectura posible como número de producción.
 *
 * La profundidad son tres planos y la regla del paralaje decide todo: lo
 * lejano es chico, tenue y lento; lo cercano es grande, borroso y rápido.
 * Al revés se vería plano, que es justo lo que no se quiere.
 */

const VERBOS = [
  "SYNC", "POLL", "READ", "ACK", "SCAN", "IDLE", "LOCK", "TICK",
  "PING", "BIND", "WAKE", "FLUSH", "CHK", "AUTH", "LOOP", "PROBE",
];

const BUSES = [
  "BUS0", "BUS1", "IO/A", "IO/B", "PLC0", "MTR1", "VIB2", "HYD3",
  "TMP0", "PRS1", "SNS4", "REL7", "CLK", "AUX9", "NET0", "DRV2",
];

const ESTADOS = ["OK", "OK", "OK", "RDY", "RDY", "SYN", "ACK", "WAIT", "NOM"];

/** Un entero pseudoaleatorio determinista: la cinta se ve igual en cada carga. */
function crearDado(semilla: number) {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hex(dado: () => number, largo: number) {
  let out = "";
  for (let i = 0; i < largo; i++) out += "0123456789ABCDEF"[Math.floor(dado() * 16)];
  return out;
}

function elegir<T>(dado: () => number, xs: readonly T[]): T {
  return xs[Math.floor(dado() * xs.length)]!;
}

/** Una línea de ruido. Ninguna forma de acá se parece a una cifra de planta. */
function linea(dado: () => number, corta: boolean): string {
  const forma = Math.floor(dado() * (corta ? 3 : 5));
  switch (forma) {
    case 0:
      return `0x${hex(dado, 4)}  ${elegir(dado, VERBOS)}  ${elegir(dado, BUSES)}`;
    case 1:
      return `${elegir(dado, BUSES)} :: ${hex(dado, 2)}:${hex(dado, 2)}:${hex(dado, 2)}`;
    case 2:
      return `${elegir(dado, VERBOS)} ${hex(dado, 6)} ${elegir(dado, ESTADOS)}`;
    case 3:
      return `[${hex(dado, 3)}] ${elegir(dado, BUSES)} ${elegir(dado, ESTADOS)}`;
    default:
      return `${hex(dado, 2)} ${hex(dado, 2)} ${hex(dado, 2)} ${hex(dado, 2)} ${hex(dado, 2)}`;
  }
}

/**
 * Un canal: sus líneas duplicadas, para que el bucle no tenga costura, y
 * arrancado a una altura propia para que las columnas no suban en fila.
 */
function Canal({
  semilla, segundos, filas, corta,
}: { semilla: number; segundos: number; filas: number; corta: boolean }) {
  const { lineas, retraso } = useMemo(() => {
    const dado = crearDado(semilla);
    const base = Array.from({ length: filas }, () => ({
      texto: linea(dado, corta),
      // Se mantiene lo que ya funcionaba: unas pocas líneas más encendidas
      // que el resto, para que la cinta no se lea como un bloque parejo.
      viva: dado() < 0.14,
    }));
    return { lineas: [...base, ...base], retraso: -dado() * segundos };
  }, [semilla, filas, corta, segundos]);

  return (
    <div className="canal">
      <div className="cinta" style={{ animationDuration: `${segundos}s`, animationDelay: `${retraso}s` }}>
        {lineas.map((l, i) => (
          <div key={i} className={l.viva ? "linea viva" : "linea"}>{l.texto}</div>
        ))}
      </div>
    </div>
  );
}

interface Plano {
  clase: "lejos" | "medio" | "cerca";
  canales: number;
  /** Cuántas filas necesita cada columna para llenar el alto de su plano. */
  filas: number;
  /** Segundos de recorrido: lejos lento, cerca rápido. Es el paralaje. */
  lento: number;
  rapido: number;
  corta: boolean;
}

const PLANOS: Plano[] = [
  { clase: "lejos", canales: 9, filas: 70, lento: 95, rapido: 62, corta: true },
  { clase: "medio", canales: 5, filas: 48, lento: 44, rapido: 26, corta: false },
  { clase: "cerca", canales: 3, filas: 28, lento: 19, rapido: 12, corta: true },
];

export default function Telemetria() {
  return (
    <div className="telemetria" aria-hidden="true">
      {PLANOS.map((p, ip) => (
        <div key={p.clase} className={`plano ${p.clase}`}>
          {Array.from({ length: p.canales }, (_, i) => (
            <Canal
              key={i}
              semilla={9176 + ip * 7919 + i * 104729}
              // Cada columna con su propio ritmo dentro del plano: si todas
              // fueran iguales el plano se leería como una sola lámina.
              segundos={p.rapido + ((p.lento - p.rapido) * i) / Math.max(1, p.canales - 1)}
              filas={p.filas}
              corta={p.corta}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
