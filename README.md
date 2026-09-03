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

## Qué falta a propósito

Este primer corte es la capa de datos con reglas duras (dinero en centavos,
baja lógica, correlativo reservado en transacción, activity_log en cada
mutación) pero **sin autenticación real**: las rutas confían en un header
`x-user-id` opcional para saber quién actúa. Antes de exponer esto fuera de
la red interna hace falta login/sesión de verdad.

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
