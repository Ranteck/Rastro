#!/bin/sh
# Dice si el dashboard construido (frontend/dist) es de la versión del frontend de la raíz de Rastro.
# Imprime una palabra: al-dia (sale con 0), falta, desactualizado o sin-raiz (salen con 1). Tras actualizar el plugin queda
# el build viejo en frontend/dist, que es ignorado por git: sin esta comparación nadie lo reconstruye.
RAIZ="$("$(dirname "$0")/raiz-rastro.sh")" || { echo sin-raiz; exit 1; }
[ -f "$RAIZ/frontend/dist/version.txt" ] || {
  [ -d "$RAIZ/frontend/dist" ] && echo desactualizado || echo falta
  exit 1
}
ESPERADA="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$RAIZ/frontend/package.json")" || { echo desactualizado; exit 1; }
[ "$(cat "$RAIZ/frontend/dist/version.txt")" = "$ESPERADA" ] && { echo al-dia; exit 0; }
echo desactualizado
exit 1
