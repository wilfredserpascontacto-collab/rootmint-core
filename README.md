# RootMint Core

Backend compartido del flujo comercial que reutilizan todos los clientes de
RootMint (Grupo Fénix, BloquesTitán, Service4Plumbing cuando crezca):

Cliente → Cotización → Aceptación → Trabajo → Documento fiscal → Cobro

Ver `../cotizadora_fenix/nucleodedatos.md` para el documento de arquitectura
completo. Este repo implementa **solo el primer bloque** que el doc marca
como punto de partida: `users`, `customers`, `contacts`, `catalog_items`,
`quotes`, `quote_lines`, `activity_log`.

Cada cliente tiene su propia base de datos Postgres (una instancia por
cliente en Coolify) — este servicio se despliega una vez por cliente,
apuntando a `DATABASE_URL` distinto cada vez. No hay `tenant_id`: el
aislamiento es la base de datos completa.

## Desarrollo local

```
cp .env.example .env
docker compose up -d          # Postgres local en :5432
npm install
npm run db:migrate            # aplica drizzle/*.sql
npm run dev                   # Fastify con reload, escucha en :3000
```

`npm run db:generate` regenera la migración SQL después de cambiar
`src/db/schema.ts`. Las migraciones generadas se commitean al repo — son
la fuente de verdad de cómo evoluciona el esquema en cada base de cliente.

## Quién entra

Todo pide sesión. La regla es **cerrado salvo que se diga lo contrario**, y
está en un solo lugar (`onRequest` en `server.ts`) y no ruta por ruta: con la
lista al revés, cada ruta nueva nacería abierta y nadie se enteraría hasta que
fuera tarde. Lo único que se atiende sin sesión son `/health` y las rutas de
`/auth`.

Hasta la versión anterior no había ninguna verificación: quien llamaba decía
quién era en el header `x-user-id`, que se escribe solo. Ese header ya no se
mira. `getUserId()` sale de la sesión.

Dos puertas, porque hay dos situaciones:

- **Oficina** — correo y contraseña (`POST /auth/entrar`).
- **Planta** — se toca el nombre en la lista y se marca un PIN de 4 a 8
  dígitos (`GET /auth/planta`, `POST /auth/pin`). La tablet de la planta pasa
  de mano en mano y con las manos sucias un correo no se teclea; sin esto,
  todos terminan usando la sesión del primero que la abrió.

La sesión dura hasta que se cierra. La llave vive en una cookie `HttpOnly`,
`SameSite=Lax`, y en la base sólo queda su huella `sha256`: quien lea la tabla
`sessions` no encuentra con qué entrar. Revocar una sesión la corta en el acto.
Cinco fallos seguidos traban la cuenta diez minutos; cambiarle la clave o el
PIN la destraba.

Los tres roles se aplican así:

| | Dueña | Empleado | Solo lectura |
|---|---|---|---|
| Ver todo | sí | sí | sí |
| Crear y editar | sí | sí | **no** |
| Límite de crédito y plazo | sí | **no** | no |
| Precios acordados con un cliente | sí | **no** | no |
| Administrar cuentas | sí | **no** | no |

La regla del crédito se mira campo por campo, no sobre la ruta entera: un
empleado tiene que poder corregir un teléfono mal anotado sin pedir permiso.

**La primera cuenta.** Mientras no existe ninguna, `/auth/primera-duena` deja
crearla, y se cierra sola en cuanto hay alguien. Es una ventana angosta y hay
que cruzarla apenas se publica: mientras esté abierta, quien llegue primero a
la dirección se queda con la cuenta. No se puede quitar a la última dueña
activa —ni por rol, ni desactivándola, ni borrándola—, porque eso dejaría el
sistema sin nadie capaz de devolver permisos.

Para comprobarlo sin creerle a nadie: `scripts/probar-acceso.mjs` golpea la
API y `scripts/probar-entrada.mjs` recorre las pantallas en un navegador.

## Qué falta a propósito

Siguiente bloque según el doc: `jobs`, `receivables`, `payments`. Después,
`fiscal_documents` (integración con Hacienda, la parte más delicada).

## Rutas

- `GET/POST /users`, `GET/PATCH/DELETE /users/:id`
- `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id`
- `GET/POST /contacts` (filtra por `?customerId=`), `GET/PATCH/DELETE /contacts/:id`
- `GET/POST /catalog-items`, `GET/PATCH/DELETE /catalog-items/:id`
- `GET/POST /quotes` (filtra por `?customerId=`), `GET /quotes/:id`,
  `PATCH /quotes/:id/status`, `DELETE /quotes/:id`

Todo `DELETE` es baja lógica (`deleted_at`), nunca borrado físico. Todo
`GET` de lista acepta `?includeInactive=true` para ver también los dados
de baja.
