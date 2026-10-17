#!/bin/sh
# Ejecuta la CLI de Rastro con los argumentos recibidos. Si no la encuentra avisa por stderr y sale con 127,
# para que un comando no confunda "no encontré Rastro" con "no hay desvíos". Los hooks envuelven esta llamada y se quedan en silencio.
if [ -n "${RASTRO_BIN:-}" ]; then
  [ -x "$RASTRO_BIN" ] || { echo "rastro: RASTRO_BIN no apunta a un ejecutable." >&2; exit 127; }
  exec "$RASTRO_BIN" "$@"
fi
if command -v rastro >/dev/null 2>&1; then
  exec rastro "$@"
fi
RAIZ="$("$(dirname "$0")/raiz-rastro.sh")" && exec node "$RAIZ/backend/bin/rastro.js" "$@"
echo "rastro: no encuentro la CLI. Definí RASTRO_BIN, poné rastro en el PATH o instalá el plugin desde el marketplace de Rastro (backend/bin/rastro.js)." >&2
exit 127
