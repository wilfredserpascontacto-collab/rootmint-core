#!/usr/bin/env bash
#
# Corre todas las pruebas, cada una contra su propio servidor y su propia base.
#
#   npm run build && bash scripts/probar-todo.sh
#
# Por qué es así de aparatoso: cada prueba trae su puerto escrito adentro y
# empieza creando la primera dueña, así que necesita una base vacía para ella
# sola. Y cada servidor carga un Postgres entero en memoria, así que
# levantarlos todos de una vez mata la máquina: van de cuatro en cuatro.
#
# Varias pruebas dan por hecho que el sistema ya trae sus tipos de bloque,
# que es como queda un cliente recién instalado, así que cada base se siembra
# antes de levantar el servidor (PGlite abre la base para un solo proceso).
#
# Con LOTE=1 van de una en una: más lento, pero es lo que hay que usar cuando
# una prueba falla por «SIN SERVIDOR», que casi siempre es falta de memoria y
# no un defecto del sistema.
set -u
cd "$(dirname "$0")/.."
TMP=".pruebas"
rm -rf "$TMP"; mkdir -p "$TMP"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
TODOS="comercial,bloques,servicio"
fallos=0

# Levanta un servidor. Un «-» en los módulos significa no poner la variable:
# así se prueba qué enciende el sistema por su cuenta.
levanta() { # dir puerto marca modulos
  local d=$1 p=$2 marca=$3 m=$4
  rm -rf "$TMP/$d"
  env ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA="$TMP/$d" node dist/db/seed-bloques.js > "$TMP/$d.siembra.log" 2>&1
  if [ "$m" = "-" ]; then
    setsid env ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA="$TMP/$d" PORT="$p" HOST=127.0.0.1 \
      ROOTMINT_BRAND="$marca" node dist/index.js > "$TMP/$d.log" 2>&1 < /dev/null &
  else
    setsid env ROOTMINT_LOCAL=1 ROOTMINT_LOCAL_DATA="$TMP/$d" PORT="$p" HOST=127.0.0.1 \
      ROOTMINT_BRAND="$marca" ROOTMINT_MODULES="$m" node dist/index.js > "$TMP/$d.log" 2>&1 < /dev/null &
  fi
}

espera() { # puerto
  local p=$1 i
  for i in $(seq 1 50); do
    sleep 2
    curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$p/auth/hay-alguien" && return 0
  done
  return 1
}

apaga() { pkill -f "LOCAL_DATA=$TMP/$1" 2>/dev/null; }

reporta() { # nombre resultado(0/1)
  printf "%-30s " "$1"
  if [ "$2" -eq 0 ]; then echo "OK"; else
    echo "FALLA"
    grep -E "✗|Error|Assertion" "$TMP/$1.salida" 2>/dev/null | head -3 | cut -c1-110 | sed 's/^/      /'
    fallos=$((fallos + 1))
  fi
}

# --- Las que se bastan con un servidor --------------------------------------
# «probar-modulos» necesita dos y «probar-modulos-pantalla» una marca propia:
# van aparte, al final.
declare -a NOMBRES=()
for f in scripts/probar-*.mjs; do
  n=$(basename "$f" .mjs)
  case "$n" in probar-demo-planta|probar-modulos|probar-modulos-pantalla) continue ;; esac
  p=$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$f" | head -1 | grep -oE '[0-9]+$')
  [ -z "${p:-}" ] && continue
  m="$TODOS"
  case "$n" in probar-idempotencia) m="comercial" ;; esac
  NOMBRES+=("$n:$p:$m")
done

LOTE=${LOTE:-4}
total=${#NOMBRES[@]}
echo "$total pruebas de a una base, de $LOTE en $LOTE."
for ((i = 0; i < total; i += LOTE)); do
  grupo=("${NOMBRES[@]:i:LOTE}")
  for par in "${grupo[@]}"; do
    IFS=: read -r n p m <<< "$par"
    levanta "$n" "$p" "RootMint" "$m"
  done
  for par in "${grupo[@]}"; do
    IFS=: read -r n p m <<< "$par"
    if ! espera "$p"; then
      printf "%-30s %s\n" "$n" "SIN SERVIDOR en $p (probá con LOTE=1)"
      fallos=$((fallos + 1)); continue
    fi
    timeout 170 node "scripts/$n.mjs" > "$TMP/$n.salida" 2>&1; reporta "$n" $?
  done
  for par in "${grupo[@]}"; do IFS=: read -r n p m <<< "$par"; apaga "$n "; done
  sleep 2
done

# --- El interruptor de módulos: dos servidores a la vez ---------------------
echo
levanta modulos-todo 4601 "Grupo Titán" "-"
levanta modulos-solo 4602 "Grupo Fénix" "comercial"
if espera 4601 && espera 4602; then
  timeout 170 node scripts/probar-modulos.mjs > "$TMP/probar-modulos.salida" 2>&1; reporta "probar-modulos" $?
else
  printf "%-30s %s\n" "probar-modulos" "SIN SERVIDOR"; fallos=$((fallos + 1))
fi
apaga "modulos-todo "; apaga "modulos-solo "; sleep 2

# --- La pantalla de un despliegue sin planta --------------------------------
levanta modulos-pant 4622 "Grupo Fénix" "comercial"
if espera 4622; then
  timeout 170 node scripts/probar-modulos-pantalla.mjs > "$TMP/probar-modulos-pantalla.salida" 2>&1
  reporta "probar-modulos-pantalla" $?
else
  printf "%-30s %s\n" "probar-modulos-pantalla" "SIN SERVIDOR"; fallos=$((fallos + 1))
fi
apaga "modulos-pant "

echo
if [ "$fallos" -eq 0 ]; then echo "Todas las pruebas pasan."; else echo "$fallos prueba(s) con fallas."; fi
exit $([ "$fallos" -eq 0 ] && echo 0 || echo 1)
