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
} as const;

export type Modulo = keyof typeof MODULOS;
export const TODOS: Modulo[] = Object.keys(MODULOS) as Modulo[];

/** Lo que trae siempre cualquier despliegue: entrar, cuentas y datos de la empresa. */
export const PREFIJOS_BASE = ["auth", "users", "business-profile", "health"];

/**
 * Los módulos encendidos, leídos de ROOTMINT_MODULES («comercial,bloques»).
 *
 * Sin la variable se encienden todos: es lo que ya corre en producción y no
 * debe cambiar por actualizar. Un nombre que no existe detiene el arranque —un
 * «comerical» mal escrito no puede dejar el sistema andando sin comercial y
 * sin decir por qué.
 */
export function modulosActivos(valor = process.env.ROOTMINT_MODULES): Modulo[] {
  if (valor === undefined || valor.trim() === "") return [...TODOS];
  const pedidos = valor.split(",").map((m) => m.trim().toLowerCase()).filter(Boolean);
  const raros = pedidos.filter((m) => !(m in MODULOS));
  if (raros.length) {
    throw new Error(
      `ROOTMINT_MODULES trae módulos que no existen: ${raros.join(", ")}. Los válidos son: ${TODOS.join(", ")}.`,
    );
  }
  return [...new Set(pedidos)] as Modulo[];
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
