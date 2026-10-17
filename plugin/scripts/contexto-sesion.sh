#!/bin/sh
# SessionStart: si la sesión está en un repo observado por Rastro, le da a la sesión el plan de la semana (`rastro siguiente`) como contexto.
# Nunca rompe la sesión: ante cualquier error sale con 0 y sin salida. No usa LLM ni red.
AQUI="$(cd "$(dirname "$0")" && pwd)" || exit 0
PAYLOAD="$(cat)" || exit 0

DIR="$(printf '%s' "$PAYLOAD" | node -e '
const p = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (typeof p.cwd === "string") process.stdout.write(p.cwd);
' 2>/dev/null)" || exit 0
[ -n "$DIR" ] || exit 0

# `--si-registrado` calla fuera de un repo observado: la decisión es de la CLI, que conoce el registro global.
PLAN="$(cd "$DIR" 2>/dev/null && "$AQUI/rastro.sh" siguiente --si-registrado 2>/dev/null)" || exit 0
[ -n "$PLAN" ] || exit 0

PLAN="$PLAN" node -e '
const texto = `Plan de Rastro para esta semana:\n${process.env.PLAN}`;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: texto } }));
' 2>/dev/null
exit 0
