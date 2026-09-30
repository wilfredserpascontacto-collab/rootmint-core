import { createContext, useContext, type ReactNode } from "react";
import type { Persona } from "./sesion";

/**
 * Que piezas tiene este despliegue, disponible en cualquier pantalla.
 *
 * El servidor es quien manda —lo apagado ni existe alla—, asi que esto no
 * protege nada: evita mostrar botones que darian 404 y pedir datos que no hay.
 */
const Ctx = createContext<Pick<Persona, "modulos" | "marca" | "subtitulo"> & { persona: Persona | null }>({
  modulos: [],
  marca: "",
  subtitulo: "",
  persona: null,
});

export function ProveedorModulos({ persona, children }: { persona: Persona; children: ReactNode }) {
  return (
    <Ctx.Provider value={{ modulos: persona.modulos, marca: persona.marca, subtitulo: persona.subtitulo, persona }}>
      {children}
    </Ctx.Provider>
  );
}

export function useModulos() {
  const c = useContext(Ctx);
  return { ...c, tiene: (m: string) => c.modulos.includes(m) };
}
