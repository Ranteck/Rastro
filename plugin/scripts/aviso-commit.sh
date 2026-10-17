#!/bin/sh
# PostToolUse de Bash: si el comando fue un `git commit`, le devuelve a la sesión el aviso de desvío de Rastro.
# Nunca rompe la sesión: ante cualquier error sale con 0 y sin salida.
AQUI="$(cd "$(dirname "$0")" && pwd)" || exit 0
PAYLOAD="$(cat)" || exit 0

# Devuelve el directorio donde se commiteó, o nada si el comando no era un `git commit`.
# Por cada tramo (separado por && || ; | o salto de línea) mira si empieza con `git` (tras rtk, command, env o VAR=valor) y, tras sus opciones, sigue `commit`:
# así `git commit-tree` y un `echo "git commit"` no cuentan, y `git -C ruta commit` apunta a ese repo.
DIR="$(printf '%s' "$PAYLOAD" | node -e '
const path = require("node:path");
const p = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const comando = p.tool_input && p.tool_input.command;
if (p.tool_name !== "Bash" || typeof comando !== "string" || typeof p.cwd !== "string") process.exit(0);
for (const tramo of comando.split(/&&|\|\||;|\||\n/)) {
  // Un espacio escapado con barra (`mi\ dir`) sigue siendo parte de la palabra.
  const t = (tramo.match(/"[^"]*"|\x27[^\x27]*\x27|(?:\\.|\S)+/g) ?? []).map((x) => (/^["\x27]/.test(x) ? x.replace(/^["\x27]|["\x27]$/g, "") : x.replace(/\\(.)/g, "$1")));
  // rtk, command y env solo envuelven al comando: `rtk git commit` es un git commit.
  while (t.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]) || ["rtk", "command", "env"].includes(t[0]))) t.shift();
  if (t.shift() !== "git") continue;
  let dir = p.cwd;
  while (t.length > 0 && t[0].startsWith("-")) {
    const opcion = t.shift();
    if ((opcion === "-C" || opcion === "-c") && t.length > 0) {
      const valor = t.shift();
      if (opcion === "-C") dir = path.resolve(dir, valor);
    }
  }
  if (t[0] === "commit") { process.stdout.write(dir); break; }
}
' 2>/dev/null)" || exit 0
[ -n "$DIR" ] || exit 0

AVISO="$(cd "$DIR" 2>/dev/null && "$AQUI/rastro.sh" aviso 2>/dev/null)" || exit 0
[ -n "$AVISO" ] || exit 0

# Si el hook de git de `rastro init` ya imprimió el aviso en la salida del commit, repetirlo sería ruido.
printf '%s' "$PAYLOAD" | AVISO="$AVISO" node -e '
const p = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const r = p.tool_response;
const salida = typeof r === "string" ? r : r && typeof r === "object" ? `${r.stdout ?? ""}\n${r.stderr ?? ""}` : "";
const aviso = process.env.AVISO;
if (aviso.split("\n").every((linea) => salida.includes(linea))) process.exit(0);
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: aviso } }));
' 2>/dev/null
exit 0
