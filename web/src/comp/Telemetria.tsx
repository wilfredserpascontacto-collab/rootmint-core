import { useMemo } from "react";

/**
 * La cinta de código que sube al pie de la pantalla.
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
function linea(dado: () => number): string {
  const forma = Math.floor(dado() * 5);
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

/** Un canal: sus líneas duplicadas, para que el bucle no tenga costura. */
function Canal({ semilla, segundos }: { semilla: number; segundos: number }) {
  const lineas = useMemo(() => {
    const dado = crearDado(semilla);
    const base = Array.from({ length: 26 }, () => ({
      texto: linea(dado),
      viva: dado() < 0.14,
    }));
    return [...base, ...base];
  }, [semilla]);

  return (
    <div className="canal">
      <div className="cinta" style={{ animationDuration: `${segundos}s` }}>
        {lineas.map((l, i) => (
          <div key={i} className={l.viva ? "linea viva" : "linea"}>{l.texto}</div>
        ))}
      </div>
    </div>
  );
}

/**
 * Cuatro canales a velocidades distintas: si todos subieran al mismo ritmo se
 * vería como una sola imagen desplazándose, no como cuatro cosas ocurriendo.
 */
export default function Telemetria() {
  return (
    <div className="telemetria" aria-hidden="true">
      <Canal semilla={20260904} segundos={17} />
      <Canal semilla={81723} segundos={23} />
      <Canal semilla={559041} segundos={13} />
      <Canal semilla={7714} segundos={29} />
    </div>
  );
}
