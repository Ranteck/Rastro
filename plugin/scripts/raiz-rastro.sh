#!/bin/sh
# Imprime la raíz del repo de Rastro (la que tiene backend/bin/rastro.js) o sale con 1 sin salida.
# Instalado desde GitHub, el plugin corre desde una copia en la caché sin backend/ al lado; el repo entero
# queda clonado en plugins/marketplaces/<nombre>, y ahí se busca.
tiene_cli() { [ -f "$1/backend/bin/rastro.js" ]; }

# Solo el marketplace propio, con su nombre: otro marketplace que declare un plugin "rastro" no puede hacerse pasar por este.
es_marketplace_rastro() {
  [ -f "$1/.claude-plugin/marketplace.json" ] || return 1
  node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const ok = m.name === "rastro" && Array.isArray(m.plugins) && m.plugins.some((p) => p.name === "rastro");
    process.exit(ok ? 0 : 1);
  ' "$1/.claude-plugin/marketplace.json" 2>/dev/null
}

PLUGIN="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
if tiene_cli "$PLUGIN/.."; then
  (cd "$PLUGIN/.." && pwd)
  exit 0
fi

MARKETPLACE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/rastro"
if tiene_cli "$MARKETPLACE" && es_marketplace_rastro "$MARKETPLACE"; then
  printf '%s\n' "$MARKETPLACE"
  exit 0
fi
exit 1
