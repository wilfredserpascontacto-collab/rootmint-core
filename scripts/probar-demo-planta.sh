#!/bin/bash
# Carga el ejemplo, lo mira en un navegador, lo quita y comprueba que no quede nada.
#   npm run build && bash scripts/probar-demo-planta.sh
cd "$(dirname "$0")/.."
unset DATABASE_URL
port=${PORT_PRUEBA:-4570}; d=/tmp/loc-demo-$port; rm -rf $d
export ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA=$d BASE=http://127.0.0.1:$port
node dist/db/migrate.js >/dev/null 2>&1; node dist/db/seed-bloques.js >/dev/null 2>&1
arrancar() { PORT=$port node dist/index.js > /tmp/srv-$port.log 2>&1 & pid=$!; sleep 4; }
parar() { kill $pid 2>/dev/null; wait $pid 2>/dev/null; }
arrancar
curl -s -X POST localhost:$port/auth/primera-duena -H 'content-type: application/json' \
  -d '{"name":"Amada","email":"a@x.com","password":"unaClaveLarga1"}' >/dev/null
parar
node dist/db/demo-planta.js || exit 1
arrancar; MODO=lleno node scripts/probar-demo-planta.mjs; r1=$?; parar
node dist/db/demo-planta.js --quitar || exit 1
arrancar; MODO=vacio node scripts/probar-demo-planta.mjs; r2=$?; parar
exit $((r1 + r2))
