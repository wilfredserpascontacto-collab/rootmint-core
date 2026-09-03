# node:22-alpine causa que npm ci se cuelgue en el VPS de Coolify por un
# problema de resolución DNS de musl. Usar la base Debian/glibc.

FROM node:22-slim AS build
WORKDIR /app

# Dependencias del servidor y de la interfaz por separado, antes del código:
# así una edición de fuente no invalida la caché de las instalaciones.
COPY package.json package-lock.json* ./
RUN npm ci
COPY web/package.json web/package-lock.json* ./web/
RUN npm ci --prefix web

COPY . .
# Compila la interfaz a dist-web/ y el servidor a dist/.
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-web ./dist-web
COPY --from=build /app/drizzle ./drizzle

EXPOSE 3000
# Aplica las migraciones pendientes y recién entonces levanta el servidor.
# Si la migración falla, el contenedor no arranca — mejor eso que servir
# contra un esquema que no corresponde.
CMD ["npm", "run", "start:prod"]
