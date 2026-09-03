import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Lectura con estado de carga, error y recarga manual. Sin librerías. */
export function useApi<T>(ruta: string | null) {
  const [dato, setDato] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(() => {
    if (!ruta) return;
    setCargando(true);
    api
      .get<T>(ruta)
      .then((d) => { setDato(d); setError(null); })
      .catch(setError)
      .finally(() => setCargando(false));
  }, [ruta]);

  useEffect(recargar, [recargar]);

  return { dato, error, cargando, recargar, setDato };
}
