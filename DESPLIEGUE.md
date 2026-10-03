# Desplegar un cliente en Coolify

Un despliegue por cliente: su propio servicio y su propia base de datos
(ver el README). Esta guía es para Bloques Titán, pero los pasos son los mismos
para Fénix cambiando dos variables (abajo).

## Lo que hace falta antes

- El repositorio en GitHub, con la rama `main` al día.
- Un dominio o subdominio apuntando al servidor (por ejemplo
  `sistema.bloquestitan.com`). **Con HTTPS**: la cookie de sesión sale marcada
  como segura en producción, así que por HTTP simple nadie podrá entrar.

## 1. La base de datos

1. En Coolify: **Nuevo recurso → Base de datos → PostgreSQL 16**.
2. Ponerle un nombre claro (`titan-db`), usuario y una contraseña larga.
3. Activar **copias de seguridad programadas** (diarias) y anotar adónde van.
   Es la única copia de las facturas y los cobros del cliente.
4. Copiar la **URL interna** de conexión (empieza con `postgres://`). Se usa
   en el paso siguiente como `DATABASE_URL`.

## 2. La aplicación

1. **Nuevo recurso → Aplicación → repositorio de GitHub** → este repo, rama `main`.
2. Tipo de compilación: **Dockerfile** (ya está en la raíz). Puerto: **3000**.
3. Variables de entorno:

   | Variable | Valor para Titán | Para qué |
   |---|---|---|
   | `DATABASE_URL` | la URL interna del paso 1 | a qué base se conecta |
   | `NODE_ENV` | `production` | cookie segura y modo producción |
   | `HOST` | `0.0.0.0` | para que Coolify lo alcance |
   | `PORT` | `3000` | |
   | `ROOTMINT_MODULES` | `comercial,bloques` | qué piezas están encendidas |
   | `ROOTMINT_BRAND` | `Grupo Titán` | cómo se llama el sistema en pantalla |

   Para **Fénix** (cotizar, facturar y servicio, sin fábrica):
   `ROOTMINT_MODULES=comercial,servicio` y `ROOTMINT_BRAND=Grupo Fénix`.

   No hace falta `ROOTMINT_ORIGINS`: la interfaz se sirve desde el mismo
   servidor.
4. Dominio: el subdominio del cliente, con certificado automático.
5. **Desplegar.** Al arrancar, el contenedor aplica solo las migraciones
   pendientes (`npm run start:prod`). Si una migración falla, no arranca: es
   a propósito.

## 3. Primera vez

1. Abrir la dirección. La primera pantalla pide crear **la cuenta de la
   dueña**: es la única vez que se puede; después, las demás cuentas se crean
   desde adentro.
2. Solo para el módulo `bloques`: en la terminal del contenedor (Coolify →
   la aplicación → Terminal) correr **una vez**:

   ```
   node dist/db/seed-bloques.js
   ```

   Trae los tipos de bloque y los materiales de fábrica, con los precios en
   cero. Se puede correr otra vez sin duplicar nada.
3. En **Mi empresa**: nombre, dirección, teléfono, **NIT y NRC de la empresa**
   y las condiciones. El NRC sale impreso en los créditos fiscales; sin él, el
   sistema avisa cada vez que se emite uno.
4. Cargar los precios de los materiales, enlazar cada producto del catálogo
   con su tipo de bloque (Productos → enlazar) y contar el patio una vez
   (Inventario → ajustar), para que la existencia de partida sea la real.

## Actualizar

Subir cambios a `main` y, en Coolify, **Redesplegar** (o activar el despliegue
automático). Las migraciones nuevas se aplican solas al arrancar. Nunca se
borra ni se reescribe lo que ya está en la base.

## Si algo no arranca

- **Pantalla en blanco / no deja entrar:** casi siempre es que el dominio no
  tiene HTTPS.
- **El contenedor se reinicia:** mirar el registro; si dice `ROOTMINT_MODULES
  trae módulos que no existen`, hay un nombre mal escrito en la variable.
- **«no pertenece a ningun modulo»:** una ruta nueva sin declarar en
  `src/modulos.ts`. Es un error de programación, no de configuración.
- **Comprobar que está vivo:** `https://su-dominio/health` debe contestar
  `{"status":"ok"}`.
