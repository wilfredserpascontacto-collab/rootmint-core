import type { FastifyInstance } from "fastify";
import { inventarioRoutes } from "./routes/inventario.js";
import { ordenesRoutes } from "./routes/ordenes.js";
import { bloquesCatalogoRoutes } from "./routes/bloques-catalogo.js";
import { bloquesProduccionRoutes } from "./routes/bloques-produccion.js";
import { bloquesMantenimientoRoutes } from "./routes/bloques-mantenimiento.js";
import { customersRoutes } from "./routes/customers.js";
import { contactsRoutes } from "./routes/contacts.js";
import { catalogItemsRoutes } from "./routes/catalog-items.js";
import { quotesRoutes } from "./routes/quotes.js";
import { customerFinanceRoutes } from "./routes/customer-finance.js";
import { invoicesRoutes } from "./routes/invoices.js";
import { instalacionesRoutes } from "./routes/instalaciones.js";
import { garantiasRoutes } from "./routes/garantias.js";

/**
 * Qué piezas tiene cada despliegue.
 *
 * El código es uno solo y lo comparten todos los clientes; lo que cambia de un
 * cliente a otro es qué piezas están encendidas. Un cliente que pagó por
 * cotizar y facturar no recibe la fábrica de bloques por actualizarse, y no es
 * una cuestión de esconder el botón: la ruta ni existe en su servidor.
 *
 * Quien decide es quien despliega, con la variable ROOTMINT_MODULES, no el
 * cliente y no una pantalla de ajustes: si el cliente pudiera encenderlo, lo
 * que se le cobró no significaría nada.
 *
 * Esta lista es la única fuente. La regla de la puerta (quién necesita sesión)
 * y la de "esta ruta no existe aquí" salen de ella, para que agregar una ruta
 * sin declararla sea un error al arrancar y no un hueco que nadie ve.
 */
export const MODULOS = {
  comercial: {
    prefijos: ["customers", "contacts", "catalog-items", "quotes", "invoices", "customer-prices", "customer-notes"],
    rutas: [customersRoutes, contactsRoutes, catalogItemsRoutes, quotesRoutes, customerFinanceRoutes, invoicesRoutes],
  },
  bloques: {
    // «inventario» y «ordenes» son de la fábrica aunque el área comercial las
    // consulte: sin planta no hay patio ni órdenes que mostrar.
    prefijos: ["bloques", "inventario", "ordenes"],
    rutas: [
      inventarioRoutes,
      ordenesRoutes,
      bloquesCatalogoRoutes,
      bloquesProduccionRoutes,
      bloquesMantenimientoRoutes,
    ],
  },
  servicio: {
    // Lo que se instalo y lo que se le debe a quien lo tiene (ver
    // schema-servicio.ts). Cuelga de los clientes, asi que pide «comercial».
    prefijos: ["instalaciones", "garantias"],
    rutas: [instalacionesRoutes, garantiasRoutes],
  },
} as const;

/**
 * Lo que un modulo necesita para existir. Faltando eso, el sistema no
 * arranca: es mejor un error claro que una pantalla que pide clientes a un
 * servidor que no los tiene.
 */
export const REQUIERE: Partial<Record<keyof typeof MODULOS, (keyof typeof MODULOS)[]>> = {
  servicio: ["comercial"],
};

/**
 * Lo que se enciende cuando no se dice nada: lo que ya corria en produccion
 * antes de que existiera el interruptor (Titan). NO es «todos»: un modulo
 * nuevo no puede aparecerle por sorpresa a quien no lo pidio ni lo pago.
 */
export const POR_DEFECTO: (keyof typeof MODULOS)[] = ["comercial", "bloques"];

export type Modulo = keyof typeof MODULOS;
export const TODOS: Modulo[] = Object.keys(MODULOS) as Modulo[];

/** Lo que trae siempre cualquier despliegue: entrar, cuentas y datos de la empresa. */
export const PREFIJOS_BASE = ["auth", "users", "business-profile", "health"];

/**
 * Los módulos encendidos, leídos de ROOTMINT_MODULES («comercial,bloques»).
 *
 * Sin la variable se enciende lo que ya corría en producción (POR_DEFECTO) y
 * no más: un módulo nuevo no debe llegarle a quien no lo pidió. Un nombre que no existe detiene el arranque —un
 * «comerical» mal escrito no puede dejar el sistema andando sin comercial y
 * sin decir por qué.
 */
export function modulosActivos(valor = process.env.ROOTMINT_MODULES): Modulo[] {
  if (valor === undefined || valor.trim() === "") return [...POR_DEFECTO];
  const pedidos = valor.split(",").map((m) => m.trim().toLowerCase()).filter(Boolean);
  const raros = pedidos.filter((m) => !(m in MODULOS));
  if (raros.length) {
    throw new Error(
      `ROOTMINT_MODULES trae módulos que no existen: ${raros.join(", ")}. Los válidos son: ${TODOS.join(", ")}.`,
    );
  }
  const activos = [...new Set(pedidos)] as Modulo[];
  for (const m of activos) {
    const faltan = (REQUIERE[m] ?? []).filter((r) => !activos.includes(r));
    if (faltan.length) {
      throw new Error(`El módulo «${m}» necesita también: ${faltan.join(", ")}. Agregalo a ROOTMINT_MODULES.`);
    }
  }
  return activos;
}

/** Toda ruta que este sistema conoce, encendida o no: la que no se conoce es la que cae en la interfaz. */
export const PREFIJOS_CONOCIDOS = new Set<string>([
  ...PREFIJOS_BASE,
  ...TODOS.flatMap((m) => MODULOS[m].prefijos as readonly string[]),
]);

export async function registrarModulos(app: FastifyInstance, activos: Modulo[]) {
  for (const m of activos) {
    for (const rutas of MODULOS[m].rutas) await app.register(rutas);
  }
}
