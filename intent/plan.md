# Rastro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Estado: borrador · Fecha: 2026-10-09 · Desde `intent/spec.md` (2026-10-09, aceptado) e `intent/intent.md` (2026-10-09, aceptado)

**Goal:** Construir la CLI `rastro` y su central: hooks que anotan eventos, detección determinística de pendientes, desvíos y repeticiones, resumen con `claude -p`, publicación con confirmación y un central que recibe lo de cada persona y sirve la UI que Denis diseña aparte.

**Architecture:** Colectores (git, plan, zsh, Claude Code) → detectores puros → LLM detrás de una interfaz → `state.json` validado contra el contrato → conectores (central HTTP, Notion). El central (`node:http`) guarda el último snapshot por persona y sirve `frontend/dist/`. Las fuentes ya son logs: no hay daemon.

**Tech Stack:** TypeScript 7.0.2 estricto ejecutado por Node ≥ 22.18 sin build (type stripping); `node:test`; `typescript` y `@types/node` como únicas dependencias de desarrollo; `claude -p` headless.

**Spec:** `intent/spec.md`. Pedido de UI: `frontend/README.md`.

## Global Constraints

- Node ≥ 22.18 ejecuta los `.ts` directamente. Los imports llevan extensión `.ts`.
- `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`. Prohibido: `enum`, `namespace`, parameter properties (`constructor(private x)`). En su lugar, uniones de literales y campos explícitos.
- Cero dependencias en runtime. Solo `typescript@7.0.2` y `@types/node@22` como devDependencies.
- Identificadores del dominio en español, igual que el contrato (`bitacora`, `pendientes`, `desvios`).
- Resultados a stdout; logs a stderr solo vía `src/log.ts`; los mensajes al usuario se traducen en un solo lugar (`src/cli.ts`). Los errores esperados son `ErrorUsuario`.
- Datos externos se validan al entrar con `src/contract/validar.ts`: `obj` (cerrado, rechaza campos extra) para datos de Rastro; `objAbierto` (descarta extras) para datos de terceros (payload de hooks de Claude Code, transcripts, salida de `claude -p`).
- `claude -p` siempre con: `--output-format json --model <modelo> --tools "" --no-session-persistence --strict-mcp-config --setting-sources "" --system-prompt <corto> --json-schema <esquema>`, prompt por stdin. Medido el 2026-10-09: US$0.12 por llamada sin estos flags, US$0.00025 con ellos. `--setting-sources ""` además evita que la sesión headless dispare los hooks del proyecto (incluido el `SessionEnd` de Rastro).
- Zona horaria de `config.zonaHoraria` (por defecto `America/Argentina/Buenos_Aires`), nunca la del proceso.
- Todo texto que va al LLM pasa por `armarPrompt` (que redacta secretos) en `src/llm/usos.ts`.
- Cada commit termina con la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Un post-commit existente que no es de shell (Python) o que termina en `exit`.** Rastro no debe romperlo: si es de shell, se inserta después del shebang; si no, no se toca y se avisa. Test en Task 9.
2. **Rutas hostiles al central** (`/api/persona/..%2F..`, `/..%2f..%2fpackage.json`, `%E0%A4%A` malformado). Siempre 400/404, nunca leer fuera de `frontend/dist/` ni del directorio de datos. Tests en Task 13.
3. **Repo sin commits, sin remoto o con HEAD separado.** `rastro daily` produce un snapshot válido y vacío, sin excepción. Test en Task 11.
4. **Historial de zsh con bytes metaficados y líneas sin timestamp; transcripts con líneas rotas.** Se decodifica bien, y lo ilegible se descarta y se cuenta, sin abortar. Tests en Task 15.
5. **Remoto con credenciales** (`https://usuario:token@github.com/...`). El token nunca aparece en la evidencia ni en el snapshot. Test en Task 5.

## Archivos

Todos son nuevos salvo `intent/`, `frontend/` y la propuesta, que ya existen.

| Archivo | Responsabilidad |
| --- | --- |
| `package.json`, `tsconfig.json`, `.gitignore`, `bin/rastro.js` | Proyecto y punto de entrada ejecutable |
| `src/cli.ts`, `src/log.ts`, `src/errores.ts` | Despacho de comandos con carga diferida, logging, errores al usuario |
| `src/contract/validar.ts` | Combinadores de validación sin dependencias |
| `src/contract/snapshot.ts`, `src/contract/equipo.ts` | Contrato `Snapshot` y fila de equipo, con sus validadores |
| `src/fechas.ts`, `src/texto.ts`, `src/redactar.ts` | Fechas en zona, slugs y normalización, redacción de secretos |
| `src/plan.ts` | Parser y renderer del formato `## Plan semana` de daily-flock |
| `src/git.ts` | Colector de git |
| `src/detectores/vinculo.ts`, `pendientes.ts`, `desvios.ts`, `repeticiones.ts` | Detectores determinísticos |
| `src/config.ts`, `src/eventos.ts`, `src/hooks.ts`, `src/init.ts` | Configuración, `events.jsonl`, hooks e instalación |
| `src/llm/llm.ts`, `src/llm/claudeCli.ts`, `src/llm/crear.ts`, `src/llm/usos.ts` | Interfaz LLM, implementación con `claude -p`, fábrica y pedidos |
| `src/fuentes/claudeCode.ts`, `src/fuentes/zsh.ts` | Transcripts de Claude Code e historial de zsh |
| `src/gantt.ts`, `src/daily.ts`, `src/planCmd.ts` | Gantt mock, `rastro daily` y `rastro plan` |
| `src/central/almacen.ts`, `servidor.ts`, `demo.ts`, `cmd.ts` | Central: almacenamiento, HTTP, datos demo y comandos |
| `src/conectores/conector.ts`, `central.ts`, `notion.ts`, `crear.ts`, `src/publish.ts` | Conectores y `rastro publish` |
| `test/helpers/repo.ts`, `test/helpers/fakeLlm.ts`, `test/*.test.ts` | Repos git temporales, LLM falso y tests |
| `README.md` | Uso de Rastro |

## Tests a escribir (trazabilidad)

| Test (comportamiento observable) | REQ |
| --- | --- |
| hooks: init encadena un post-commit existente y el commit registra el evento | REQ-1 |
| hooks: init dos veces no duplica y respeta settings existentes | REQ-1 |
| hooks: init no toca un post-commit que no es de shell | REQ-1 |
| hooks: el commit se crea aunque `events.jsonl` no se pueda escribir | REQ-2 |
| hooks: session-end registra la sesión e ignora campos nuevos del payload | REQ-2 |
| hooks: el post-commit avisa el desvío temprano | REQ-8 |
| daily: bitácora con evidencia de commit y rama, y sesiones de Claude Code | REQ-3 |
| vinculo: por `[Nombre]` en el mensaje y por slug como segmento de la rama | REQ-4 |
| daily: vínculo inferido marcado con razón; sin LLM queda `sin-tarea` | REQ-4 |
| pendientes: las cinco reglas | REQ-5 |
| daily: "resuelto sin cerrar" de punta a punta con un merge real | REQ-5 |
| plan: parseo y render del formato daily-flock | REQ-6 |
| planCmd: escribe `plan.md`; si existe, escribe `plan.sugerido.md` | REQ-6 |
| desvios: % fuera del plan, alerta y tareas sin actividad | REQ-7 |
| daily: la tarea sin actividad aparece en `resumen.sigue` | REQ-7 |
| repeticiones: secuencias de zsh y prompts de Claude Code con umbral | REQ-9 |
| daily: las sugerencias llegan al snapshot con propuesta | REQ-9 |
| daily: resumen con LLM; con el LLM caído, `resumen: null` y pendientes completos | REQ-10 |
| claudeCli: salida estructurada, reintento, costo y flags | REQ-11 |
| publish: "n" no envía nada; sugerencias filtradas; conectores independientes | REQ-12 |
| redactar: tokens y asignaciones; daily: el prompt no lleva secretos | REQ-13 |
| central: publish válido 201, extra 400, rutas hostiles 404, equipo calculado | REQ-14 |
| notion: formato daily-flock y argumentos de `claude -p` | REQ-15 |
| contract: los ejemplos de `frontend/` cumplen; los inválidos se rechazan | REQ-16 |
| seed: tres compañeros válidos aparecen en `/api/equipo` | REQ-17 |
| planCmd: `--sugerir` propone tareas nuevas desde el trabajo fuera del plan | REQ-18 |

## Orden y corte

Tasks 1 a 8 dejan el núcleo determinístico. Con la Task 11, `rastro daily` ya es demostrable. Con las 13 y 14, el central recibe datos. Las 15 y 16 (repeticiones y Notion real) son las primeras en caer si falta tiempo.

---

### Task 1: Proyecto, repo y CLI mínima

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `bin/rastro.js`, `src/cli.ts`, `src/log.ts`, `src/errores.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Produces: `main(argv: string[]): Promise<number>` en `src/cli.ts`; `type Comando = (args: string[]) => Promise<number>`; mapa `comandos` de cargadores diferidos al que las tareas siguientes agregan entradas. `log(nivel, evento, campos)` en `src/log.ts`. `class ErrorUsuario extends Error` en `src/errores.ts`.

- [ ] **Step 1: Inicializar el repo y las dependencias**

```bash
cd /home/denis-legion/Documentos/AI-Day/Rastro
git init -b main
npm init -y
npm i -D typescript@7.0.2 @types/node@22
```

Completar `package.json` (las versiones exactas de `devDependencies` quedan como las escribió `npm i`):

```bash
npm pkg set type=module description="Memoria de equipo con evidencia" bin.rastro=bin/rastro.js "engines.node=>=22.18" \
  scripts.test='node --test "test/**/*.test.ts"' scripts.typecheck="tsc -p ." scripts.check="npm run typecheck && npm test"
npm pkg set private=true --json
npm pkg delete main
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`.gitignore`:

```
node_modules/
.rastro/
frontend/dist/
.remember/
```

- [ ] **Step 2: Escribir el test que falla**

`test/cli.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));

test("sin argumentos muestra la ayuda y sale con 0", () => {
  const r = spawnSync(process.execPath, [BIN], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /rastro daily/);
});

test("un comando desconocido sale con 2 y lo nombra", () => {
  const r = spawnSync(process.execPath, [BIN, "nada"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Comando desconocido: nada/);
});
```

- [ ] **Step 3: Correrlo y ver que falla**

Run: `node --test test/cli.test.ts`
Expected: FAIL (no existe `bin/rastro.js`).

- [ ] **Step 4: Implementar**

`src/errores.ts`:

```ts
/** Error esperado: la CLI muestra su mensaje tal cual, sin stack. */
export class ErrorUsuario extends Error {
  override name = "ErrorUsuario";
}
```

`src/log.ts`:

```ts
type Nivel = "debug" | "info" | "warn" | "error";

const ORDEN: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function nivelMinimo(): Nivel {
  const v = process.env["RASTRO_LOG"];
  return v === "debug" || v === "info" || v === "warn" || v === "error" ? v : "info";
}

export function log(nivel: Nivel, evento: string, campos: Record<string, string | number | boolean> = {}): void {
  if (ORDEN[nivel] < ORDEN[nivelMinimo()]) return;
  const pares = Object.entries(campos).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  process.stderr.write(`rastro ${nivel} ${evento}${pares.length > 0 ? ` ${pares.join(" ")}` : ""}\n`);
}
```

`src/cli.ts`:

```ts
import { ErrorUsuario } from "./errores.ts";
import { log } from "./log.ts";

export type Comando = (args: string[]) => Promise<number>;

const AYUDA = `rastro: memoria de equipo con evidencia

Uso:
  rastro init [--equipo <nombre>]          Prepara el repo y los hooks
  rastro hook commit | session-end         Lo llaman los hooks
  rastro plan <propuesta.md> | --sugerir   Arma o sugiere el plan de la semana
  rastro daily [--desde AAAA-MM-DD]        Genera .rastro/state.json
  rastro publish [--yes]                   Publica en los conectores
  rastro serve [--puerto N] [--datos dir]  Levanta el central
  rastro seed-demo [--central url]         Publica compañeros de ejemplo
`;

// Carga diferida: el hook de cada commit solo importa lo que usa.
const comandos: Readonly<Record<string, () => Promise<Comando>>> = {};

export async function main(argv: string[]): Promise<number> {
  const [nombre, ...resto] = argv;
  if (nombre === undefined || nombre === "--help" || nombre === "-h") {
    process.stdout.write(AYUDA);
    return 0;
  }
  const cargar = comandos[nombre];
  if (cargar === undefined) {
    process.stderr.write(`Comando desconocido: ${nombre}\n\n${AYUDA}`);
    return 2;
  }
  try {
    return await (await cargar())(resto);
  } catch (e) {
    if (e instanceof ErrorUsuario) {
      process.stderr.write(`rastro: ${e.message}\n`);
      return 1;
    }
    log("error", "fallo_inesperado", { comando: nombre, detalle: e instanceof Error ? e.message : String(e) });
    if (e instanceof Error && e.stack !== undefined) log("debug", "stack", { stack: e.stack });
    process.stderr.write("rastro: error inesperado; corré con RASTRO_LOG=debug para ver el detalle.\n");
    return 1;
  }
}
```

`bin/rastro.js`:

```js
#!/usr/bin/env node
import { main } from "../src/cli.ts";

process.exitCode = await main(process.argv.slice(2));
```

```bash
chmod +x bin/rastro.js
```

- [ ] **Step 5: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS (2 tests) y `tsc` sin errores.

- [ ] **Step 6: Primer commit (incluye intent, spec, plan, frontend y propuesta)**

```bash
git add .gitignore package.json package-lock.json tsconfig.json bin src test intent frontend "Memoria de equipo con evidencia — Propuesta de producto.md"
git commit -m "chore: proyecto rastro con CLI mínima" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Contrato y validador

**Files:**
- Create: `src/contract/validar.ts`, `src/contract/snapshot.ts`
- Test: `test/contract.test.ts`

**Interfaces:**
- Produces (`validar.ts`): `class ErrorValidacion extends Error { ruta: string }`; `type Check<T> = (valor: unknown, ruta: string) => T`; `type Infer<C>`; `str`, `num`, `bool`, `desconocido`, `lit(...valores)`, `patron(re, descripcion)`, `arr(check)`, `nullable(check)`, `obj(requeridos, opcionales?)`, `objAbierto(requeridos, opcionales?)`, `fecha`, `hora`, `slug`, `RE_SLUG`.
- Produces (`snapshot.ts`): `checkSnapshot`, `validarSnapshot(raw: unknown): Snapshot` y los tipos `Snapshot`, `Evidencia`, `EntradaBitacora`, `Pendiente`, `Tarea`, `Plan`, `Desvios`, `Resumen`, `Sugerencia`, `Gantt`, `Costo`.

- [ ] **Step 1: Escribir el test que falla**

`test/contract.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validarSnapshot } from "../src/contract/snapshot.ts";
import { ErrorValidacion } from "../src/contract/validar.ts";

const ejemplo = (): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL("../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8")) as Record<string, unknown>;

test("el ejemplo de frontend cumple el contrato", () => {
  const s = validarSnapshot(ejemplo());
  assert.equal(s.persona.id, "denis");
  assert.equal(s.gantt.mock, true);
  assert.equal(s.bitacora[1]?.razon, "El commit toca la validación del endpoint de publicación del central.");
});

test("rechaza un campo no admitido y dice dónde", () => {
  const raw = ejemplo();
  raw["extra"] = 1;
  assert.throws(() => validarSnapshot(raw), (e: unknown) => e instanceof ErrorValidacion && e.ruta === "snapshot.extra");
});

test("rechaza un tipo de pendiente desconocido", () => {
  const raw = ejemplo();
  raw["pendientes"] = [{ tipo: "otro", tarea: null, texto: "x", evidencia: [], proximoPaso: "y" }];
  assert.throws(() => validarSnapshot(raw), ErrorValidacion);
});

test("rechaza un id de persona que no es slug", () => {
  const raw = ejemplo();
  raw["persona"] = { id: "../etc", nombre: "X", equipo: "Y" };
  assert.throws(() => validarSnapshot(raw), /snapshot\.persona\.id/);
});

test("rechaza un gantt que no viene marcado como mock", () => {
  const raw = ejemplo();
  raw["gantt"] = { mock: false, barras: [] };
  assert.throws(() => validarSnapshot(raw), /snapshot\.gantt\.mock/);
});

test("rechaza un campo requerido ausente", () => {
  const raw = ejemplo();
  delete raw["costo"];
  assert.throws(() => validarSnapshot(raw), /snapshot\.costo/);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/contract.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`src/contract/validar.ts`:

```ts
export class ErrorValidacion extends Error {
  override name = "ErrorValidacion";
  readonly ruta: string;

  constructor(ruta: string, detalle: string) {
    super(`${ruta}: ${detalle}`);
    this.ruta = ruta;
  }
}

export type Check<T> = (valor: unknown, ruta: string) => T;
export type Infer<C> = C extends Check<infer T> ? T : never;
type Forma = Record<string, Check<unknown>>;
type Salida<F extends Forma> = { [K in keyof F]: Infer<F[K]> };
type Primitivo = string | number | boolean;

export const str: Check<string> = (v, r) => {
  if (typeof v !== "string") throw new ErrorValidacion(r, "se esperaba texto");
  return v;
};

export const num: Check<number> = (v, r) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ErrorValidacion(r, "se esperaba un número");
  return v;
};

export const bool: Check<boolean> = (v, r) => {
  if (typeof v !== "boolean") throw new ErrorValidacion(r, "se esperaba true o false");
  return v;
};

export const desconocido: Check<unknown> = (v) => v;

export function lit<const L extends readonly Primitivo[]>(...valores: L): Check<L[number]> {
  return (v, r) => {
    if (!valores.some((x) => x === v)) throw new ErrorValidacion(r, `se esperaba uno de: ${valores.join(", ")}`);
    return v as L[number];
  };
}

export function patron(re: RegExp, descripcion: string): Check<string> {
  return (v, r) => {
    const s = str(v, r);
    if (!re.test(s)) throw new ErrorValidacion(r, `se esperaba ${descripcion}`);
    return s;
  };
}

export function arr<T>(c: Check<T>): Check<T[]> {
  return (v, r) => {
    if (!Array.isArray(v)) throw new ErrorValidacion(r, "se esperaba una lista");
    return v.map((x, i) => c(x, `${r}[${i}]`));
  };
}

export function nullable<T>(c: Check<T>): Check<T | null> {
  return (v, r) => (v === null ? null : c(v, r));
}

function comoRegistro(v: unknown, r: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ErrorValidacion(r, "se esperaba un objeto");
  return v as Record<string, unknown>;
}

function construir<F extends Forma, O extends Forma>(
  reg: Record<string, unknown>,
  r: string,
  requeridos: F,
  opcionales: O,
): Salida<F> & Partial<Salida<O>> {
  const salida: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(requeridos)) salida[k] = c(reg[k], `${r}.${k}`);
  for (const [k, c] of Object.entries(opcionales)) if (reg[k] !== undefined) salida[k] = c(reg[k], `${r}.${k}`);
  return salida as Salida<F> & Partial<Salida<O>>;
}

/** Objeto cerrado: rechaza campos que el contrato no admite. Para datos que define Rastro. */
export function obj<F extends Forma, O extends Forma = Record<never, never>>(
  requeridos: F,
  opcionales?: O,
): Check<Salida<F> & Partial<Salida<O>>> {
  return (v, r) => {
    const reg = comoRegistro(v, r);
    for (const k of Object.keys(reg)) {
      if (!(k in requeridos) && !(opcionales !== undefined && k in opcionales)) throw new ErrorValidacion(`${r}.${k}`, "campo no admitido");
    }
    return construir(reg, r, requeridos, opcionales ?? ({} as O));
  };
}

/** Objeto abierto: descarta los campos que no se piden. Para datos de terceros que pueden sumar campos. */
export function objAbierto<F extends Forma, O extends Forma = Record<never, never>>(
  requeridos: F,
  opcionales?: O,
): Check<Salida<F> & Partial<Salida<O>>> {
  return (v, r) => construir(comoRegistro(v, r), r, requeridos, opcionales ?? ({} as O));
}

export const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const fecha = patron(/^\d{4}-\d{2}-\d{2}$/, "una fecha AAAA-MM-DD");
export const hora = patron(/^\d{2}:\d{2}$/, "una hora HH:MM");
export const slug = patron(RE_SLUG, "un slug en minúsculas con guiones");
```

`src/contract/snapshot.ts`:

```ts
import { arr, bool, fecha, hora, lit, nullable, num, obj, slug, str, type Infer } from "./validar.ts";

const rango = obj({ desde: fecha, hasta: fecha });
const evidencia = obj({ tipo: lit("commit", "rama", "doc", "sesion"), ref: str }, { url: str });

export const checkSnapshot = obj({
  schemaVersion: lit(1),
  generadoEn: str,
  persona: obj({ id: slug, nombre: str, equipo: str }),
  repo: obj({ nombre: str }, { url: str }),
  periodo: rango,
  plan: nullable(
    obj({
      semana: fecha,
      entregable: str,
      tareas: arr(obj({ slug, nombre: str, objetivo: str, estado: lit("pendiente", "hecha", "sacada") })),
    }),
  ),
  bitacora: arr(
    obj(
      {
        fecha,
        hora,
        tarea: nullable(str),
        rama: str,
        texto: str,
        vinculo: lit("nombre", "inferido", "sin-tarea"),
        evidencia: arr(evidencia),
      },
      { razon: str },
    ),
  ),
  pendientes: arr(
    obj({
      tipo: lit("resuelto-sin-cerrar", "cerrado-sin-evidencia", "rama-quieta", "todo-nuevo", "codigo-sin-doc"),
      tarea: nullable(str),
      texto: str,
      evidencia: arr(evidencia),
      proximoPaso: str,
    }),
  ),
  desvios: obj({ fueraDelPlanPct: num, alerta: bool, tareasSinActividad: arr(str) }),
  resumen: nullable(obj({ hice: arr(str), avance: arr(str), sigue: arr(str), bloqueos: arr(str) })),
  sugerencias: arr(
    obj({
      fuente: lit("zsh", "claude-code"),
      patron: str,
      ocurrencias: num,
      dias: num,
      propuesta: obj({ tipo: lit("alias", "script", "hook", "skill"), contenido: str, porque: str }),
    }),
  ),
  gantt: obj({ mock: lit(true), barras: arr(obj({ tarea: str, plan: nullable(rango), real: nullable(rango) })) }),
  costo: obj({ llamadas: num, usd: num, tokens: num }),
});

export type Snapshot = Infer<typeof checkSnapshot>;
export type Evidencia = Infer<typeof evidencia>;
export type Plan = NonNullable<Snapshot["plan"]>;
export type Tarea = Plan["tareas"][number];
export type EntradaBitacora = Snapshot["bitacora"][number];
export type Pendiente = Snapshot["pendientes"][number];
export type Desvios = Snapshot["desvios"];
export type Resumen = NonNullable<Snapshot["resumen"]>;
export type Sugerencia = Snapshot["sugerencias"][number];
export type Gantt = Snapshot["gantt"];
export type Costo = Snapshot["costo"];

export function validarSnapshot(raw: unknown): Snapshot {
  return checkSnapshot(raw, "snapshot");
}
```

- [ ] **Step 4: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contract test/contract.test.ts
git commit -m "feat: contrato del snapshot con validador sin dependencias" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Fechas, texto y redacción de secretos

**Files:**
- Create: `src/fechas.ts`, `src/texto.ts`, `src/redactar.ts`
- Test: `test/fechas.test.ts`, `test/redactar.test.ts`

**Interfaces:**
- Produces (`fechas.ts`): `type Fecha = string`; `fechaLocal(d: Date, zona: string): Fecha`; `horaLocal(d: Date, zona: string): string`; `sumarDias(f: Fecha, dias: number): Fecha`; `lunesDe(f: Fecha): Fecha`; `ddmm(f: Fecha): string`; `desdeDdmm(texto: string, referencia: Fecha): Fecha`; `diasEntre(desde: Date, hasta: Date): number`.
- Produces (`texto.ts`): `sinAcentos(s)`, `normalizar(s)` (sin acentos y en minúsculas), `slugDe(s)`, `escaparRegex(s)`.
- Produces (`redactar.ts`): `redactar(texto: string): string`, `REDACTADO = "[redactado]"`.

- [ ] **Step 1: Escribir los tests que fallan**

`test/fechas.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ddmm, desdeDdmm, diasEntre, fechaLocal, horaLocal, lunesDe, sumarDias } from "../src/fechas.ts";
import { slugDe } from "../src/texto.ts";

const BA = "America/Argentina/Buenos_Aires";

test("la fecha y la hora locales salen de la zona configurada, no de UTC", () => {
  const d = new Date("2026-10-10T01:30:00Z");
  assert.equal(fechaLocal(d, BA), "2026-10-09");
  assert.equal(horaLocal(d, BA), "22:30");
});

test("el lunes de la semana", () => {
  assert.equal(lunesDe("2026-10-09"), "2026-10-05");
  assert.equal(lunesDe("2026-10-05"), "2026-10-05");
  assert.equal(lunesDe("2026-10-11"), "2026-10-05");
});

test("sumar días cruza meses y años", () => {
  assert.equal(sumarDias("2026-12-30", 3), "2027-01-02");
  assert.equal(sumarDias("2026-10-01", -1), "2026-09-30");
});

test("DD/MM de daily-flock se resuelve con el año correcto", () => {
  assert.equal(ddmm("2026-10-05"), "05/10");
  assert.equal(desdeDdmm("05/10", "2026-10-09"), "2026-10-05");
  assert.equal(desdeDdmm("29/12", "2027-01-02"), "2026-12-29");
});

test("días entre dos instantes", () => {
  assert.equal(diasEntre(new Date("2026-10-04T12:00:00Z"), new Date("2026-10-09T12:00:00Z")), 5);
});

test("slug sin acentos ni signos", () => {
  assert.equal(slugDe("Bitácora"), "bitacora");
  assert.equal(slugDe("Docker GUI"), "docker-gui");
  assert.equal(slugDe("  Tests e2e! "), "tests-e2e");
});
```

`test/redactar.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactar } from "../src/redactar.ts";

test("redacta tokens conocidos", () => {
  const gh = `ghp_${"a".repeat(36)}`;
  const r = redactar(`export GITHUB_TOKEN=${gh} && curl -H 'Authorization: Bearer abcdefghijklmnop' https://x`);
  assert.ok(!r.includes(gh));
  assert.ok(!r.includes("abcdefghijklmnop"));
  assert.match(r, /GITHUB_TOKEN=\[redactado\]/);
});

test("redacta asignaciones de *_KEY, *_TOKEN y password", () => {
  const r = redactar("OPENAI_API_KEY='sk-proj-abc123def456' mysql --password=hunter2 AWS=AKIAABCDEFGHIJKLMNOP");
  assert.ok(!r.includes("sk-proj-abc123def456"));
  assert.ok(!r.includes("hunter2"));
  assert.ok(!r.includes("AKIAABCDEFGHIJKLMNOP"));
});

test("no toca texto sin secretos", () => {
  assert.equal(redactar("git commit -m 'arreglo el parser'"), "git commit -m 'arreglo el parser'");
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `node --test test/fechas.test.ts test/redactar.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`src/fechas.ts`:

```ts
export type Fecha = string;

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

function aUtc(f: Fecha): Date {
  const m = RE_FECHA.exec(f);
  if (m === null) throw new Error(`fecha inválida: ${f}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function fechaLocal(d: Date, zona: string): Fecha {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function horaLocal(d: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function sumarDias(f: Fecha, dias: number): Fecha {
  const d = aUtc(f);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function lunesDe(f: Fecha): Fecha {
  return sumarDias(f, -((aUtc(f).getUTCDay() + 6) % 7));
}

export function ddmm(f: Fecha): string {
  return `${f.slice(8, 10)}/${f.slice(5, 7)}`;
}

/** Los planes de daily-flock dicen "05/10" sin año: se resuelve contra `referencia`. */
export function desdeDdmm(texto: string, referencia: Fecha): Fecha {
  const m = /^(\d{2})\/(\d{2})$/.exec(texto);
  if (m === null) throw new Error(`fecha DD/MM inválida: ${texto}`);
  const anio = Number(referencia.slice(0, 4));
  const candidata = `${anio}-${m[2]}-${m[1]}`;
  // Un plan de fines de diciembre leído en enero es del año anterior.
  return candidata > sumarDias(referencia, 7) ? `${anio - 1}-${m[2]}-${m[1]}` : candidata;
}

export function diasEntre(desde: Date, hasta: Date): number {
  return Math.floor((hasta.getTime() - desde.getTime()) / 86_400_000);
}
```

`src/texto.ts`:

```ts
export function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalizar(s: string): string {
  return sinAcentos(s).toLowerCase();
}

export function slugDe(s: string): string {
  return normalizar(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

`src/redactar.ts`:

```ts
export const REDACTADO = "[redactado]";

const TOKENS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/g,
];

// Cubre FOO_KEY=..., API_TOKEN="...", SECRET=..., password=... y --password=...
const ASIGNACIONES = /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|password)\s*=\s*("[^"]*"|'[^']*'|\S+)/gi;

export function redactar(texto: string): string {
  let r = texto;
  for (const re of TOKENS) r = r.replace(re, REDACTADO);
  return r.replace(ASIGNACIONES, (_m, nombre: string) => `${nombre}=${REDACTADO}`);
}
```

- [ ] **Step 4: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fechas.ts src/texto.ts src/redactar.ts test/fechas.test.ts test/redactar.test.ts
git commit -m "feat: fechas en zona, slugs y redacción de secretos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Plan con el formato de daily-flock

**Files:**
- Create: `src/plan.ts`
- Test: `test/plan.test.ts`

**Interfaces:**
- Consumes: `Plan`, `Tarea` (Task 2); `ddmm`, `desdeDdmm`, `lunesDe`, `Fecha` (Task 3); `slugDe` (Task 3); `ErrorUsuario` (Task 1).
- Produces: `parsearPlan(md: string, hoy: Fecha): Plan | null`; `renderizarPlan(semana: Fecha, entregable: string, tareas: readonly TareaARenderizar[]): string` con `type TareaARenderizar = { nombre: string; objetivo: string; estado?: Tarea["estado"] }`.

- [ ] **Step 1: Escribir el test que falla**

`test/plan.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorUsuario } from "../src/errores.ts";
import { parsearPlan, renderizarPlan } from "../src/plan.ts";

const MD = `## Por hacer
- [ ] Revisar algo.

## Plan semana 05/10
- ~~**Entregable del viernes:** Algo viejo.~~
- **Entregable del viernes:** Demo de Rastro en el AI Day.
- [x] **Bitácora:** Registrar el día con evidencia.
- [ ] **Pendientes:** Detectar lo resuelto sin cerrar.
\t- 08/10: Pasa a mañana.
- [ ] ~~**Jira:** Leer tareas de Jira.~~
\t- 07/10: Se sacó del plan.
- **Cierre (09/10):** Entregado.

## Plan semana 28/09
- [ ] **Vieja:** No es de esta semana.
`;

test("lee el plan de la semana de hoy con estados, tachados y comentarios", () => {
  const plan = parsearPlan(MD, "2026-10-09");
  assert.deepEqual(plan, {
    semana: "2026-10-05",
    entregable: "Demo de Rastro en el AI Day.",
    tareas: [
      { slug: "bitacora", nombre: "Bitácora", objetivo: "Registrar el día con evidencia.", estado: "hecha" },
      { slug: "pendientes", nombre: "Pendientes", objetivo: "Detectar lo resuelto sin cerrar.", estado: "pendiente" },
      { slug: "jira", nombre: "Jira", objetivo: "Leer tareas de Jira.", estado: "sacada" },
    ],
  });
});

test("sin plan para la semana devuelve null", () => {
  assert.equal(parsearPlan(MD, "2026-10-14"), null);
});

test("una línea mal formada corta con su número de línea", () => {
  const roto = "## Plan semana 05/10\n- [ ] Tarea sin nombre en negrita\n";
  assert.throws(() => parsearPlan(roto, "2026-10-09"), (e: unknown) => e instanceof ErrorUsuario && e.message.includes("línea 2"));
});

test("lo renderizado se vuelve a leer igual", () => {
  const md = renderizarPlan("2026-10-05", "Demo.", [
    { nombre: "Central", objetivo: "Recibir snapshots." },
    { nombre: "Bitácora", objetivo: "Registrar el día.", estado: "hecha" },
  ]);
  const plan = parsearPlan(md, "2026-10-07");
  assert.equal(plan?.entregable, "Demo.");
  assert.deepEqual(plan?.tareas.map((t) => [t.slug, t.estado]), [["central", "pendiente"], ["bitacora", "hecha"]]);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/plan.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`src/plan.ts`:

```ts
import type { Plan, Tarea } from "./contract/snapshot.ts";
import { ErrorUsuario } from "./errores.ts";
import { ddmm, desdeDdmm, lunesDe, type Fecha } from "./fechas.ts";
import { slugDe } from "./texto.ts";

const RE_ENCABEZADO = /^## Plan semana (\d{2}\/\d{2})\s*$/;
const RE_ENTREGABLE = /^- (~~)?\*\*Entregable del viernes:\*\*\s*(.*?)(~~)?\s*$/;
const RE_TAREA = /^- \[([ xX])\] (~~)?\*\*(.+?):\*\*\s*(.*?)(~~)?\s*$/;

/** Devuelve el plan de la semana de `hoy` o null si el archivo no tiene uno. */
export function parsearPlan(md: string, hoy: Fecha): Plan | null {
  const lineas = md.split(/\r?\n/);
  const lunes = lunesDe(hoy);
  const inicio = lineas.findIndex((l) => {
    const m = RE_ENCABEZADO.exec(l);
    return m !== null && m[1] !== undefined && desdeDdmm(m[1], hoy) === lunes;
  });
  if (inicio === -1) return null;

  let entregable = "";
  const tareas: Tarea[] = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    const linea = lineas[i] ?? "";
    if (/^#{1,6} /.test(linea)) break;
    // Vacías y sub-bullets con fecha: son comentarios del plan, no tareas.
    if (linea.trim() === "" || /^\s/.test(linea) || linea.startsWith("- **Cierre")) continue;
    const e = RE_ENTREGABLE.exec(linea);
    if (e !== null) {
      if (e[1] === undefined) entregable = e[2] ?? "";
      continue;
    }
    const t = RE_TAREA.exec(linea);
    if (t === null || t[3] === undefined) {
      throw new ErrorUsuario(`plan.md línea ${i + 1}: no es una tarea válida (se espera "- [ ] **Nombre:** objetivo")`);
    }
    tareas.push({
      slug: slugDe(t[3]),
      nombre: t[3],
      objetivo: t[4] ?? "",
      estado: t[2] === "~~" ? "sacada" : t[1] === " " ? "pendiente" : "hecha",
    });
  }
  return { semana: lunes, entregable, tareas };
}

export type TareaARenderizar = { nombre: string; objetivo: string; estado?: Tarea["estado"] };

export function renderizarPlan(semana: Fecha, entregable: string, tareas: readonly TareaARenderizar[]): string {
  const linea = (t: TareaARenderizar): string =>
    t.estado === "sacada"
      ? `- [ ] ~~**${t.nombre}:** ${t.objetivo}~~`
      : `- [${t.estado === "hecha" ? "x" : " "}] **${t.nombre}:** ${t.objetivo}`;
  return [`## Plan semana ${ddmm(semana)}`, `- **Entregable del viernes:** ${entregable}`, ...tareas.map(linea), ""].join("\n");
}
```

- [ ] **Step 4: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plan.ts test/plan.test.ts
git commit -m "feat: parser y render del plan con formato daily-flock" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Colector de git

**Files:**
- Create: `src/git.ts`, `test/helpers/repo.ts`
- Test: `test/git.test.ts`

**Interfaces:**
- Consumes: `ErrorUsuario` (Task 1).
- Produces (`git.ts`): `type Commit = { sha: string; fecha: Date; padres: string[]; asunto: string; cuerpo: string; archivos: string[]; rama: string }`; `type Rama = { nombre: string; ultimoCommit: Date; sha: string; mergeada: boolean }`; `type DatosGit = { ramaPrincipal: string; commits: Commit[]; ramas: Rama[]; urlBase: string | null }`; `git(repo, args): string`; `raizDelRepo(dir): string`; `ramaPrincipal(repo): string`; `urlBaseDe(remoto): string | null`; `commitsDe(repo, ref, desdeGit): Omit<Commit, "rama">[]`; `recolectarGit(repo, desdeGit): DatosGit`; `lineasAgregadas(repo, sha): string[]`; `diffResumido(repo, sha, maxBytes): string`.
- Produces (`test/helpers/repo.ts`): `crearRepo(): RepoTemporal` con `{ dir, git(...args), escribir(ruta, contenido), commit(mensaje, fechaIso?) }`; `ENV_GIT` (entorno sin config global del usuario).

- [ ] **Step 1: Escribir el helper y el test que falla**

`test/helpers/repo.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Entorno de git aislado de la config global de quien corre los tests. */
export const ENV_GIT: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

export type RepoTemporal = {
  dir: string;
  git: (...args: string[]) => string;
  escribir: (ruta: string, contenido: string) => void;
  commit: (mensaje: string, fechaIso?: string) => string;
};

export function crearRepo(): RepoTemporal {
  const dir = mkdtempSync(join(tmpdir(), "rastro-test-"));
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: ENV_GIT }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  const escribir = (ruta: string, contenido: string): void => {
    const abs = join(dir, ruta);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contenido);
  };
  const commit = (mensaje: string, fechaIso?: string): string => {
    git("add", "-A");
    const env = fechaIso === undefined ? ENV_GIT : { ...ENV_GIT, GIT_AUTHOR_DATE: fechaIso, GIT_COMMITTER_DATE: fechaIso };
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", mensaje], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    return git("rev-parse", "HEAD");
  };
  return { dir, git, escribir, commit };
}
```

`test/git.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineasAgregadas, recolectarGit, urlBaseDe } from "../src/git.ts";
import { crearRepo } from "./helpers/repo.ts";

test("los commits de una rama mergeada conservan su rama y se marca la rama como mergeada", () => {
  const r = crearRepo();
  r.escribir("README.md", "hola\n");
  r.commit("inicio", "2026-10-09T10:00:00-03:00");
  r.git("checkout", "-q", "-b", "feat/pendientes");
  r.escribir("src/a.ts", "export const a = 1;\n");
  const enRama = r.commit("[Pendientes] detector", "2026-10-09T11:00:00-03:00");
  r.git("checkout", "-q", "main");
  r.git("merge", "-q", "--no-ff", "feat/pendientes", "-m", "Merge branch 'feat/pendientes'");

  const datos = recolectarGit(r.dir, "2026-10-08");
  const c = datos.commits.find((x) => x.sha === enRama);
  assert.equal(c?.rama, "feat/pendientes");
  assert.deepEqual(c?.archivos, ["src/a.ts"]);
  assert.equal(c?.asunto, "[Pendientes] detector");
  assert.equal(datos.ramaPrincipal, "main");
  assert.equal(datos.ramas.find((x) => x.nombre === "feat/pendientes")?.mergeada, true);
  assert.ok(datos.commits.some((x) => x.padres.length === 2 && x.rama === "main"));
  assert.equal(datos.urlBase, null);
});

test("un repo sin commits no rompe", () => {
  const datos = recolectarGit(crearRepo().dir, "2026-10-01");
  assert.deepEqual(datos.commits, []);
  assert.deepEqual(datos.ramas, []);
  assert.equal(datos.ramaPrincipal, "main");
});

test("la URL base nunca conserva credenciales", () => {
  assert.equal(urlBaseDe("git@github.com:flock/rastro.git"), "https://github.com/flock/rastro");
  assert.equal(urlBaseDe("https://usuario:ghp_secreto@github.com/flock/rastro.git"), "https://github.com/flock/rastro");
  assert.equal(urlBaseDe("/ruta/local/repo"), null);
});

test("las líneas agregadas de un commit", () => {
  const r = crearRepo();
  r.escribir("a.ts", "uno\n");
  r.commit("uno", "2026-10-09T10:00:00-03:00");
  r.escribir("a.ts", "uno\n// TODO: dos\n");
  const sha = r.commit("dos", "2026-10-09T10:05:00-03:00");
  assert.deepEqual(lineasAgregadas(r.dir, sha), ["// TODO: dos"]);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/git.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`src/git.ts`:

```ts
import { execFileSync } from "node:child_process";
import { ErrorUsuario } from "./errores.ts";

export type Commit = { sha: string; fecha: Date; padres: string[]; asunto: string; cuerpo: string; archivos: string[]; rama: string };
export type Rama = { nombre: string; ultimoCommit: Date; sha: string; mergeada: boolean };
export type DatosGit = { ramaPrincipal: string; commits: Commit[]; ramas: Rama[]; urlBase: string | null };

export function git(repo: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export function raizDelRepo(dir: string): string {
  try {
    return git(dir, ["rev-parse", "--show-toplevel"]).trim();
  } catch (e) {
    throw new ErrorUsuario(`${dir} no está dentro de un repo git.`, { cause: e });
  }
}

function lineas(s: string): string[] {
  return s.split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

export function ramaPrincipal(repo: string): string {
  try {
    return git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim().replace(/^origin\//, "");
  } catch {
    // Sin origin/HEAD (repo sin remoto o sin fetch): se decide con las ramas locales.
  }
  const locales = lineas(git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]));
  for (const candidata of ["main", "master"]) if (locales.includes(candidata)) return candidata;
  try {
    return git(repo, ["symbolic-ref", "--short", "HEAD"]).trim();
  } catch {
    return "HEAD"; // HEAD separado: no hay una rama actual para tomar como principal.
  }
}

export function urlBaseDe(remoto: string): string | null {
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(remoto);
  if (ssh !== null) return `https://${ssh[1]}/${ssh[2]}`;
  // El grupo opcional descarta "usuario:token@" para que las credenciales nunca lleguen a la evidencia.
  const https = /^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?\/?$/.exec(remoto);
  return https === null ? null : `https://${https[1]}`;
}

function urlRemota(repo: string): string | null {
  try {
    return git(repo, ["remote", "get-url", "origin"]).trim();
  } catch {
    return null; // Sin remoto origin: la evidencia va sin URL.
  }
}

/** Commits alcanzables desde `ref` desde `desdeGit` (cualquier fecha que acepte --since). */
export function commitsDe(repo: string, ref: string, desdeGit: string): Omit<Commit, "rama">[] {
  const salida = git(repo, ["log", ref, `--since=${desdeGit}`, "--name-only", "--format=%x1e%H%x1f%aI%x1f%P%x1f%s%x1f%b%x1d"]);
  return salida
    .split("\x1e")
    .filter((registro) => registro.trim() !== "")
    .map((registro) => {
      const [encabezado = "", archivos = ""] = registro.split("\x1d");
      const [sha = "", fecha = "", padres = "", asunto = "", cuerpo = ""] = encabezado.split("\x1f");
      return {
        sha,
        fecha: new Date(fecha),
        padres: padres.split(" ").filter((p) => p !== ""),
        asunto,
        cuerpo: cuerpo.trim(),
        archivos: lineas(archivos),
      };
    });
}

export function recolectarGit(repo: string, desdeGit: string): DatosGit {
  const principal = ramaPrincipal(repo);
  const ramasCrudas = lineas(git(repo, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:iso-strict)%09%(objectname)", "refs/heads"])).map(
    (linea) => {
      const [nombre = "", fecha = "", sha = ""] = linea.split("\t");
      return { nombre, ultimoCommit: new Date(fecha), sha };
    },
  );
  const existePrincipal = ramasCrudas.some((r) => r.nombre === principal);
  const mergeadas = existePrincipal ? new Set(lineas(git(repo, ["branch", "--merged", principal, "--format=%(refname:short)"]))) : new Set<string>();
  const ramas: Rama[] = ramasCrudas.map((r) => ({ ...r, mergeada: r.nombre !== principal && mergeadas.has(r.nombre) }));

  // Un commit mergeado aparece en su rama y en la principal: gana la rama de feature.
  const orden = [...ramas.filter((r) => r.nombre !== principal), ...ramas.filter((r) => r.nombre === principal)];
  const porSha = new Map<string, Commit>();
  for (const r of orden) {
    for (const c of commitsDe(repo, r.nombre, desdeGit)) if (!porSha.has(c.sha)) porSha.set(c.sha, { ...c, rama: r.nombre });
  }
  const url = urlRemota(repo);
  return {
    ramaPrincipal: principal,
    commits: [...porSha.values()].sort((a, b) => b.fecha.getTime() - a.fecha.getTime()),
    ramas,
    urlBase: url === null ? null : urlBaseDe(url),
  };
}

export function lineasAgregadas(repo: string, sha: string): string[] {
  return git(repo, ["show", "--format=", "--unified=0", "--no-color", sha])
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

export function diffResumido(repo: string, sha: string, maxBytes: number): string {
  const d = git(repo, ["show", "--format=", "--stat", "--patch", "--unified=1", "--no-color", sha]);
  return d.length > maxBytes ? `${d.slice(0, maxBytes)}\n[diff truncado]` : d;
}
```

- [ ] **Step 4: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/git.ts test/helpers/repo.ts test/git.test.ts
git commit -m "feat: colector de git con ramas, merges y URL sin credenciales" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Vínculo determinístico entre commit y tarea

**Files:**
- Create: `src/detectores/vinculo.ts`
- Test: `test/vinculo.test.ts`

**Interfaces:**
- Consumes: `Tarea` (Task 2); `normalizar`, `escaparRegex` (Task 3).
- Produces: `type Vinculo = { tarea: string | null; tipo: "nombre" | "inferido" | "sin-tarea"; razon?: string }`; `ramaContieneSlug(rama: string, slug: string): boolean`; `vincularPorNombre(c: { rama: string; asunto: string; cuerpo: string }, tareas: readonly Tarea[]): string | null`.

- [ ] **Step 1: Escribir el test que falla**

`test/vinculo.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tarea } from "../src/contract/snapshot.ts";
import { ramaContieneSlug, vincularPorNombre } from "../src/detectores/vinculo.ts";

const tareas: Tarea[] = [
  { slug: "plan", nombre: "Plan", objetivo: "", estado: "pendiente" },
  { slug: "docker-gui", nombre: "Docker GUI", objetivo: "", estado: "pendiente" },
  { slug: "bitacora", nombre: "Bitácora", objetivo: "", estado: "hecha" },
];

test("el slug tiene que ser un segmento completo de la rama", () => {
  assert.equal(ramaContieneSlug("feat/docker-gui", "docker-gui"), true);
  assert.equal(ramaContieneSlug("feat/planner", "plan"), false);
  assert.equal(ramaContieneSlug("fix/plan-semanal", "plan"), true);
});

test("vincula por [Nombre] en el mensaje, sin importar acentos ni mayúsculas", () => {
  assert.equal(vincularPorNombre({ rama: "main", asunto: "[bitacora] links", cuerpo: "" }, tareas), "bitacora");
  assert.equal(vincularPorNombre({ rama: "main", asunto: "arreglo", cuerpo: "Parte de [Docker GUI]" }, tareas), "docker-gui");
});

test("el [Nombre] del mensaje gana sobre la rama", () => {
  assert.equal(vincularPorNombre({ rama: "feat/plan", asunto: "[Bitácora] fix", cuerpo: "" }, tareas), "bitacora");
});

test("vincula por rama y, si no hay nada, devuelve null", () => {
  assert.equal(vincularPorNombre({ rama: "feat/docker-gui", asunto: "wip", cuerpo: "" }, tareas), "docker-gui");
  assert.equal(vincularPorNombre({ rama: "main", asunto: "fix parser", cuerpo: "" }, tareas), null);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/vinculo.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`src/detectores/vinculo.ts`:

```ts
import type { Tarea } from "../contract/snapshot.ts";
import { normalizar } from "../texto.ts";

export type Vinculo = { tarea: string | null; tipo: "nombre" | "inferido" | "sin-tarea"; razon?: string };

/** "feat/docker-gui" contiene "docker-gui", pero "feat/planner" no contiene "plan". */
export function ramaContieneSlug(rama: string, slug: string): boolean {
  const tokens = normalizar(rama).split(/[^a-z0-9]+/).filter((t) => t !== "");
  return `-${tokens.join("-")}-`.includes(`-${slug}-`);
}

export function vincularPorNombre(c: { rama: string; asunto: string; cuerpo: string }, tareas: readonly Tarea[]): string | null {
  const mensaje = normalizar(`${c.asunto}\n${c.cuerpo}`);
  // El slug más largo primero: "docker-gui" gana sobre "docker".
  const porLargo = [...tareas].sort((a, b) => b.slug.length - a.slug.length);
  return (
    porLargo.find((t) => mensaje.includes(`[${normalizar(t.nombre)}]`))?.slug ??
    porLargo.find((t) => ramaContieneSlug(c.rama, t.slug))?.slug ??
    null
  );
}
```

- [ ] **Step 4: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/detectores/vinculo.ts test/vinculo.test.ts
git commit -m "feat: vínculo determinístico entre commits y tareas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Detector de pendientes

**Files:**
- Create: `src/detectores/pendientes.ts`
- Test: `test/pendientes.test.ts`

**Interfaces:**
- Consumes: `Evidencia`, `Pendiente`, `Plan` (Task 2); `Commit`, `Rama` (Task 5); `diasEntre` (Task 3); `normalizar`, `escaparRegex` (Task 3); `ramaContieneSlug`, `vincularPorNombre`, `Vinculo` (Task 6).
- Produces: `type CommitVinculado = Commit & { vinculo: Vinculo }`; `type EntradaPendientes`; `ramaDeMerge(asunto: string): string | null`; `detectarPendientes(e: EntradaPendientes): Pendiente[]`.

- [ ] **Step 1: Escribir el test que falla**

`test/pendientes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Plan } from "../src/contract/snapshot.ts";
import { detectarPendientes, ramaDeMerge, type CommitVinculado, type EntradaPendientes } from "../src/detectores/pendientes.ts";
import type { Commit } from "../src/git.ts";

const plan: Plan = {
  semana: "2026-10-05",
  entregable: "Demo.",
  tareas: [
    { slug: "pendientes", nombre: "Pendientes", objetivo: "", estado: "pendiente" },
    { slug: "bitacora", nombre: "Bitácora", objetivo: "", estado: "hecha" },
    { slug: "central", nombre: "Central", objetivo: "", estado: "pendiente" },
  ],
};

const commit = (p: Partial<CommitVinculado> & { sha: string }): CommitVinculado => ({
  fecha: new Date("2026-10-09T15:00:00-03:00"),
  padres: ["p1"],
  asunto: "",
  cuerpo: "",
  archivos: [],
  rama: "main",
  vinculo: { tarea: null, tipo: "sin-tarea" },
  ...p,
});

const merge = (sha: string, asunto: string): Commit => ({
  sha, fecha: new Date("2026-10-09T16:00:00-03:00"), padres: ["a", "b"], asunto, cuerpo: "", archivos: [], rama: "main",
});

const entrada = (o: Partial<EntradaPendientes> = {}): EntradaPendientes => ({
  plan,
  commitsSemana: [],
  commitsPeriodo: [],
  merges: [],
  ramas: [],
  ramaPrincipal: "main",
  lineasAgregadas: () => [],
  evidenciaCommit: (sha) => ({ tipo: "commit", ref: sha.slice(0, 7) }),
  ahora: new Date("2026-10-09T18:00:00-03:00"),
  ramaQuietaDias: 3,
  ...o,
});

const deTipo = (e: EntradaPendientes, tipo: string) => detectarPendientes(e).filter((p) => p.tipo === tipo);

test("lee la rama de un merge local o de un PR de GitHub", () => {
  assert.equal(ramaDeMerge("Merge branch 'feat/pendientes'"), "feat/pendientes");
  assert.equal(ramaDeMerge("Merge pull request #12 from flock/feat/pendientes"), "feat/pendientes");
  assert.equal(ramaDeMerge("fix parser"), null);
});

test("resuelto sin cerrar: el merge de la rama de una tarea abierta", () => {
  const [p] = deTipo(entrada({ merges: [merge("abcdef1234", "Merge pull request #12 from flock/feat/pendientes")] }), "resuelto-sin-cerrar");
  assert.equal(p?.tarea, "pendientes");
  assert.equal(p?.proximoPaso, "Tildar Pendientes en el plan.");
  assert.deepEqual(p?.evidencia, [{ tipo: "commit", ref: "abcdef1" }]);
});

test("resuelto sin cerrar: un commit que dice cierra [Central]", () => {
  const c = commit({ sha: "1234567890", asunto: "Cierra [Central] con la API lista", vinculo: { tarea: "central", tipo: "nombre" } });
  const [p] = deTipo(entrada({ commitsSemana: [c] }), "resuelto-sin-cerrar");
  assert.equal(p?.tarea, "central");
});

test("cerrado sin evidencia: tarea hecha sin commits vinculados", () => {
  assert.deepEqual(deTipo(entrada(), "cerrado-sin-evidencia").map((p) => p.tarea), ["bitacora"]);
  const c = commit({ sha: "aaaaaaa1", vinculo: { tarea: "bitacora", tipo: "nombre" } });
  assert.equal(deTipo(entrada({ commitsSemana: [c] }), "cerrado-sin-evidencia").length, 0);
});

test("rama quieta: sin mergear y sin commits hace N días", () => {
  const ramas = [
    { nombre: "feat/central", ultimoCommit: new Date("2026-10-04T10:00:00-03:00"), sha: "bbbbbbb1", mergeada: false },
    { nombre: "feat/vieja-mergeada", ultimoCommit: new Date("2026-10-01T10:00:00-03:00"), sha: "ccccccc1", mergeada: true },
    { nombre: "feat/reciente", ultimoCommit: new Date("2026-10-08T10:00:00-03:00"), sha: "ddddddd1", mergeada: false },
  ];
  const quietas = deTipo(entrada({ ramas }), "rama-quieta");
  assert.deepEqual(quietas.map((p) => p.tarea), ["central"]);
  assert.match(quietas[0]?.texto ?? "", /hace 5 días/);
});

test("TODO o FIXME nuevo en el diff", () => {
  const c = commit({ sha: "eeeeeee1", vinculo: { tarea: "central", tipo: "nombre" } });
  const [p] = deTipo(entrada({ commitsPeriodo: [c], lineasAgregadas: () => ["// TODO: limitar el tamaño", "x"] }), "todo-nuevo");
  assert.equal(p?.tarea, "central");
  assert.match(p?.texto ?? "", /limitar el tamaño/);
});

test("código sin doc: por tarea, salvo que se toque README o docs/ o solo tests", () => {
  const conCodigo = commit({ sha: "fffffff1", archivos: ["src/a.ts"], vinculo: { tarea: "central", tipo: "nombre" } });
  assert.equal(deTipo(entrada({ commitsPeriodo: [conCodigo] }), "codigo-sin-doc").length, 1);
  const conDoc = commit({ sha: "fffffff2", archivos: ["src/a.ts", "README.md"], vinculo: { tarea: "central", tipo: "nombre" } });
  assert.equal(deTipo(entrada({ commitsPeriodo: [conDoc] }), "codigo-sin-doc").length, 0);
  const soloTests = commit({ sha: "fffffff3", archivos: ["test/a.test.ts"] });
  assert.equal(deTipo(entrada({ commitsPeriodo: [soloTests] }), "codigo-sin-doc").length, 0);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/pendientes.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`src/detectores/pendientes.ts`:

```ts
import type { Evidencia, Pendiente, Plan } from "../contract/snapshot.ts";
import { diasEntre } from "../fechas.ts";
import type { Commit, Rama } from "../git.ts";
import { escaparRegex, normalizar } from "../texto.ts";
import { ramaContieneSlug, vincularPorNombre, type Vinculo } from "./vinculo.ts";

export type CommitVinculado = Commit & { vinculo: Vinculo };

export type EntradaPendientes = {
  plan: Plan | null;
  /** Commits sin merges desde el lunes de la semana. */
  commitsSemana: readonly CommitVinculado[];
  /** Commits sin merges del período pedido. */
  commitsPeriodo: readonly CommitVinculado[];
  merges: readonly Commit[];
  ramas: readonly Rama[];
  ramaPrincipal: string;
  lineasAgregadas: (sha: string) => string[];
  evidenciaCommit: (sha: string) => Evidencia;
  ahora: Date;
  ramaQuietaDias: number;
};

const RE_MERGE = /^Merge (?:branch '([^']+)'|pull request #\d+ from [^/\s]+\/(\S+))/;
const RE_CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|c|cc|cpp|h|hpp|swift|sh)$/;
const RE_TEST = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[a-z]+$/;

const esCodigo = (a: string): boolean => RE_CODIGO.test(a) && !RE_TEST.test(a);
const esDoc = (a: string): boolean => /(^|\/)README[^/]*$/i.test(a) || a.startsWith("docs/");

export function ramaDeMerge(asunto: string): string | null {
  const m = RE_MERGE.exec(asunto);
  return m?.[1] ?? m?.[2] ?? null;
}

export function detectarPendientes(e: EntradaPendientes): Pendiente[] {
  return [...resueltosSinCerrar(e), ...cerradosSinEvidencia(e), ...ramasQuietas(e), ...todosNuevos(e), ...codigoSinDoc(e)];
}

function resueltosSinCerrar(e: EntradaPendientes): Pendiente[] {
  const res: Pendiente[] = [];
  for (const t of e.plan?.tareas ?? []) {
    if (t.estado !== "pendiente") continue;
    const evidencia: Evidencia[] = [];
    const motivos: string[] = [];
    for (const r of e.ramas) {
      if (r.mergeada && ramaContieneSlug(r.nombre, t.slug)) {
        evidencia.push({ tipo: "rama", ref: r.nombre }, e.evidenciaCommit(r.sha));
        motivos.push(`la rama ${r.nombre} está mergeada`);
      }
    }
    for (const m of e.merges) {
      const rama = ramaDeMerge(m.asunto);
      if (rama !== null && ramaContieneSlug(rama, t.slug)) {
        evidencia.push(e.evidenciaCommit(m.sha));
        motivos.push(`se mergeó ${rama}`);
      }
    }
    const reCierre = new RegExp(`\\b(cierra|closes|close|fixes)\\s+\\[${escaparRegex(normalizar(t.nombre))}\\]`);
    for (const c of e.commitsSemana) {
      if (reCierre.test(normalizar(`${c.asunto}\n${c.cuerpo}`))) {
        evidencia.push(e.evidenciaCommit(c.sha));
        motivos.push(`el commit ${c.sha.slice(0, 7)} la cierra`);
      }
    }
    if (motivos.length > 0) {
      res.push({
        tipo: "resuelto-sin-cerrar",
        tarea: t.slug,
        texto: `${t.nombre} está resuelta en el código (${motivos[0]}), pero sigue abierta en el plan.`,
        evidencia,
        proximoPaso: `Tildar ${t.nombre} en el plan.`,
      });
    }
  }
  return res;
}

function cerradosSinEvidencia(e: EntradaPendientes): Pendiente[] {
  const conCommits = new Set(e.commitsSemana.map((c) => c.vinculo.tarea));
  return (e.plan?.tareas ?? [])
    .filter((t) => t.estado === "hecha" && !conCommits.has(t.slug))
    .map(
      (t): Pendiente => ({
        tipo: "cerrado-sin-evidencia",
        tarea: t.slug,
        texto: `${t.nombre} figura como hecha, pero no hay commits vinculados esta semana.`,
        evidencia: [],
        proximoPaso: `Vincular la evidencia (un commit con [${t.nombre}]) o revisar si está hecha.`,
      }),
    );
}

function ramasQuietas(e: EntradaPendientes): Pendiente[] {
  const tareas = e.plan?.tareas ?? [];
  return e.ramas
    .filter((r) => r.nombre !== e.ramaPrincipal && !r.mergeada && diasEntre(r.ultimoCommit, e.ahora) >= e.ramaQuietaDias)
    .map(
      (r): Pendiente => ({
        tipo: "rama-quieta",
        tarea: vincularPorNombre({ rama: r.nombre, asunto: "", cuerpo: "" }, tareas),
        texto: `La rama ${r.nombre} no tiene commits hace ${diasEntre(r.ultimoCommit, e.ahora)} días y no está mergeada.`,
        evidencia: [{ tipo: "rama", ref: r.nombre }, e.evidenciaCommit(r.sha)],
        proximoPaso: `Mergear, retomar o borrar ${r.nombre}.`,
      }),
    );
}

function todosNuevos(e: EntradaPendientes): Pendiente[] {
  const res: Pendiente[] = [];
  for (const c of e.commitsPeriodo) {
    const todos = e.lineasAgregadas(c.sha).filter((l) => /\b(TODO|FIXME)\b/.test(l));
    const primera = todos[0];
    if (primera === undefined) continue;
    res.push({
      tipo: "todo-nuevo",
      tarea: c.vinculo.tarea,
      texto: `Se agregó ${todos.length === 1 ? "un TODO/FIXME" : `${todos.length} TODO/FIXME, por ejemplo`}: "${primera.trim().slice(0, 80)}".`,
      evidencia: [e.evidenciaCommit(c.sha)],
      proximoPaso: "Resolverlo o sumarlo como tarea al plan.",
    });
  }
  return res;
}

function codigoSinDoc(e: EntradaPendientes): Pendiente[] {
  const grupos = new Map<string, { tarea: string | null; etiqueta: string; commits: CommitVinculado[] }>();
  for (const c of e.commitsPeriodo) {
    const clave = c.vinculo.tarea ?? `rama:${c.rama}`;
    const nombre = e.plan?.tareas.find((t) => t.slug === c.vinculo.tarea)?.nombre;
    const grupo = grupos.get(clave) ?? { tarea: c.vinculo.tarea, etiqueta: nombre ?? `la rama ${c.rama}`, commits: [] };
    grupo.commits.push(c);
    grupos.set(clave, grupo);
  }
  return [...grupos.values()]
    .filter((g) => {
      const archivos = g.commits.flatMap((c) => c.archivos);
      return archivos.some(esCodigo) && !archivos.some(esDoc);
    })
    .map(
      (g): Pendiente => ({
        tipo: "codigo-sin-doc",
        tarea: g.tarea,
        texto: `Cambió código de ${g.etiqueta} y no se actualizó README ni docs/.`,
        evidencia: g.commits.slice(0, 3).map((c) => e.evidenciaCommit(c.sha)),
        proximoPaso: "Revisar si hace falta documentar el cambio.",
      }),
    );
}
```

- [ ] **Step 4: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/detectores/pendientes.ts test/pendientes.test.ts
git commit -m "feat: detector de pendientes con evidencia y próximo paso" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Desvíos del plan

**Files:**
- Create: `src/detectores/desvios.ts`
- Test: `test/desvios.test.ts`

**Interfaces:**
- Consumes: `Desvios`, `Plan` (Task 2); `Vinculo` (Task 6).
- Produces: `calcularDesvios(e: { plan: Plan | null; commitsPeriodo: readonly { vinculo: Vinculo }[]; commitsSemana: readonly { vinculo: Vinculo }[]; umbralPct: number }): Desvios`.

- [ ] **Step 1: Escribir el test que falla**

`test/desvios.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Plan } from "../src/contract/snapshot.ts";
import { calcularDesvios } from "../src/detectores/desvios.ts";
import type { Vinculo } from "../src/detectores/vinculo.ts";

const plan: Plan = {
  semana: "2026-10-05",
  entregable: "Demo.",
  tareas: [
    { slug: "pendientes", nombre: "Pendientes", objetivo: "", estado: "pendiente" },
    { slug: "central", nombre: "Central", objetivo: "", estado: "pendiente" },
    { slug: "jira", nombre: "Jira", objetivo: "", estado: "sacada" },
  ],
};
const v = (tarea: string | null, tipo: Vinculo["tipo"] = tarea === null ? "sin-tarea" : "nombre") => ({ vinculo: { tarea, tipo } });

test("porcentaje fuera del plan, alerta sobre el umbral y tareas sin actividad", () => {
  const periodo = [v("pendientes"), v(null), v(null), v(null)];
  assert.deepEqual(calcularDesvios({ plan, commitsPeriodo: periodo, commitsSemana: periodo, umbralPct: 50 }), {
    fueraDelPlanPct: 75,
    alerta: true,
    tareasSinActividad: ["central"],
  });
});

test("un vínculo inferido cuenta como dentro del plan", () => {
  const periodo = [v("central", "inferido"), v(null)];
  const d = calcularDesvios({ plan, commitsPeriodo: periodo, commitsSemana: periodo, umbralPct: 50 });
  assert.equal(d.fueraDelPlanPct, 50);
  assert.equal(d.alerta, false);
});

test("sin plan no hay desvío que medir", () => {
  assert.deepEqual(calcularDesvios({ plan: null, commitsPeriodo: [v(null)], commitsSemana: [], umbralPct: 50 }), {
    fueraDelPlanPct: 0,
    alerta: false,
    tareasSinActividad: [],
  });
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/desvios.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`src/detectores/desvios.ts`:

```ts
import type { Desvios, Plan } from "../contract/snapshot.ts";
import type { Vinculo } from "./vinculo.ts";

type ConVinculo = { vinculo: Vinculo };

export function calcularDesvios(e: {
  plan: Plan | null;
  commitsPeriodo: readonly ConVinculo[];
  commitsSemana: readonly ConVinculo[];
  umbralPct: number;
}): Desvios {
  if (e.plan === null) return { fueraDelPlanPct: 0, alerta: false, tareasSinActividad: [] };
  const total = e.commitsPeriodo.length;
  const fuera = e.commitsPeriodo.filter((c) => c.vinculo.tipo === "sin-tarea").length;
  const pct = total === 0 ? 0 : Math.round((fuera / total) * 100);
  const conActividad = new Set(e.commitsSemana.map((c) => c.vinculo.tarea));
  return {
    fueraDelPlanPct: pct,
    alerta: pct > e.umbralPct,
    tareasSinActividad: e.plan.tareas.filter((t) => t.estado === "pendiente" && !conActividad.has(t.slug)).map((t) => t.slug),
  };
}
```

- [ ] **Step 4: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/detectores/desvios.ts test/desvios.test.ts
git commit -m "feat: desvíos del plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Configuración, eventos, hooks e init

**Files:**
- Create: `src/config.ts`, `src/eventos.ts`, `src/hooks.ts`, `src/init.ts`
- Modify: `src/cli.ts` (mapa `comandos`)
- Test: `test/hooks.test.ts`

**Interfaces:**
- Consumes: `obj`, `objAbierto`, `arr`, `lit`, `nullable`, `bool`, `num`, `str`, `slug`, `Infer`, `Check`, `ErrorValidacion` (Task 2); `fechaLocal`, `sumarDias` (Task 3); `slugDe` (Task 3); `parsearPlan` (Task 4); `git`, `raizDelRepo`, `commitsDe` (Task 5); `vincularPorNombre` (Task 6); `ErrorUsuario` (Task 1).
- Produces (`config.ts`): `type Config`; `configPorDefecto(persona): Config`; `type Rutas = { dir; config; eventos; plan; planSugerido; state; errores; notionPreview }`; `rutas(repo): Rutas`; `leerConfig(repo): Config`; `escribirConfig(repo, config): void`; `expandirHome(ruta): string`.
- Produces (`eventos.ts`): `type Evento` (unión `commit` | `sesion`); `agregarEvento(archivo, evento): void`; `leerEventos(archivo): { eventos: Evento[]; descartados: number }`.
- Produces (`hooks.ts`): `hookCommit(repo, ahora): string | null`; `avisoDeDesvio(repo, rama, ahora): string | null`; `hookSesion(entrada: string, ahora: Date): void`; `cmdHook(args): Promise<number>`.
- Produces (`init.ts`): `BIN_RASTRO: string`; `inicializar(repo, { equipo, binRastro }): string[]`; `cmdInit(args): Promise<number>`.

- [ ] **Step 1: Escribir el test que falla**

`test/hooks.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leerEventos } from "../src/eventos.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { hookSesion } from "../src/hooks.ts";
import { BIN_RASTRO, inicializar } from "../src/init.ts";
import { crearRepo, ENV_GIT } from "./helpers/repo.ts";

const eventosDe = (dir: string) => leerEventos(join(dir, ".rastro", "events.jsonl")).eventos;

test("init encadena un post-commit existente y el commit registra el evento", () => {
  const r = crearRepo();
  r.escribir(".git/hooks/post-commit", "#!/bin/sh\necho original > .git/original.txt\nexit 0\n");
  chmodSync(join(r.dir, ".git/hooks/post-commit"), 0o755);
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const sha = r.commit("primero");
  assert.ok(existsSync(join(r.dir, ".git/original.txt")));
  assert.deepEqual(eventosDe(r.dir).map((e) => (e.tipo === "commit" ? e.sha : null)), [sha]);
  assert.match(readFileSync(join(r.dir, ".git/info/exclude"), "utf8"), /^\.rastro\/$/m);
});

test("init dos veces no duplica y respeta los settings existentes", () => {
  const r = crearRepo();
  r.escribir(".claude/settings.local.json", JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const ajustes = JSON.parse(readFileSync(join(r.dir, ".claude/settings.local.json"), "utf8")) as {
    permissions: unknown;
    hooks: { SessionEnd: unknown[] };
  };
  assert.deepEqual(ajustes.permissions, { allow: ["Bash(ls)"] });
  assert.equal(ajustes.hooks.SessionEnd.length, 1);
  assert.equal(readFileSync(join(r.dir, ".git/hooks/post-commit"), "utf8").split("# rastro").length - 1, 1);
});

test("init no toca un post-commit que no es de shell y lo avisa", () => {
  const r = crearRepo();
  const python = "#!/usr/bin/env python3\nprint('hola')\n";
  r.escribir(".git/hooks/post-commit", python);
  const hechos = inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  assert.equal(readFileSync(join(r.dir, ".git/hooks/post-commit"), "utf8"), python);
  assert.ok(hechos.some((h) => h.includes("agregá a mano")));
});

test("el commit se crea aunque events.jsonl no se pueda escribir", (t) => {
  if (process.getuid?.() === 0) {
    t.skip("como root los permisos de archivo no aplican");
    return;
  }
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  writeFileSync(join(r.dir, ".rastro/events.jsonl"), "");
  chmodSync(join(r.dir, ".rastro/events.jsonl"), 0o000);
  assert.match(r.commit("igual se crea"), /^[0-9a-f]{40}$/);
  assert.match(readFileSync(join(r.dir, ".rastro/errors.log"), "utf8"), /EACCES/);
});

test("session-end registra la sesión e ignora campos nuevos del payload", () => {
  const r = crearRepo();
  r.commit("inicio");
  const payload = { session_id: "abc12345-x", transcript_path: "/tmp/t.jsonl", cwd: r.dir, hook_event_name: "SessionEnd", reason: "exit", campo_nuevo: 1 };
  hookSesion(JSON.stringify(payload), new Date("2026-10-09T15:00:00Z"));
  assert.deepEqual(eventosDe(r.dir), [
    { tipo: "sesion", id: "abc12345-x", transcript: "/tmp/t.jsonl", rama: "main", en: "2026-10-09T15:00:00.000Z" },
  ]);
});

test("el post-commit avisa cuando el día ya se fue del plan", () => {
  const r = crearRepo();
  inicializar(r.dir, { equipo: "QA", binRastro: BIN_RASTRO });
  const hoy = fechaLocal(new Date(), "America/Argentina/Buenos_Aires");
  r.escribir(".rastro/plan.md", `## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Demo.\n- [ ] **Pendientes:** Detectar.\n`);
  r.commit("[Pendientes] uno");
  r.commit("fix a");
  r.commit("fix b");
  r.commit("fix c");
  const res = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "fix d"], { cwd: r.dir, env: ENV_GIT, encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.match(res.stderr, /4 de 5 commits de hoy están fuera del plan \(80%\)/);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/hooks.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar la configuración y los eventos**

`src/config.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { arr, bool, ErrorValidacion, lit, num, obj, slug, str, type Infer } from "./contract/validar.ts";
import { ErrorUsuario } from "./errores.ts";

const checkConfig = obj({
  persona: obj({ id: slug, nombre: str, equipo: str }),
  zonaHoraria: str,
  conectores: arr(lit("central", "notion")),
  central: obj({ url: str }),
  notion: obj({ modo: lit("mock", "claude") }),
  compartir: obj({ sugerencias: bool }),
  umbrales: obj({
    ramaQuietaDias: num,
    fueraDelPlanPct: num,
    repeticiones: obj({ veces: num, dias: num, ventanaMin: num }),
  }),
  llm: obj({ proveedor: lit("claude-cli", "ninguno"), modelo: str }),
  fuentes: obj({ zshHistory: str, claudeProjects: str }),
});

export type Config = Infer<typeof checkConfig>;

export function configPorDefecto(persona: Config["persona"]): Config {
  return {
    persona,
    zonaHoraria: "America/Argentina/Buenos_Aires",
    conectores: ["central", "notion"],
    central: { url: "http://127.0.0.1:4317" },
    notion: { modo: "mock" },
    compartir: { sugerencias: false },
    umbrales: { ramaQuietaDias: 3, fueraDelPlanPct: 50, repeticiones: { veces: 3, dias: 2, ventanaMin: 10 } },
    llm: { proveedor: "claude-cli", modelo: "haiku" },
    fuentes: { zshHistory: "~/.zsh_history", claudeProjects: "~/.claude/projects" },
  };
}

export type Rutas = {
  dir: string;
  config: string;
  eventos: string;
  plan: string;
  planSugerido: string;
  state: string;
  errores: string;
  notionPreview: string;
};

export function rutas(repo: string): Rutas {
  const dir = join(repo, ".rastro");
  return {
    dir,
    config: join(dir, "config.json"),
    eventos: join(dir, "events.jsonl"),
    plan: join(dir, "plan.md"),
    planSugerido: join(dir, "plan.sugerido.md"),
    state: join(dir, "state.json"),
    errores: join(dir, "errors.log"),
    notionPreview: join(dir, "notion-preview.md"),
  };
}

export function leerConfig(repo: string): Config {
  const archivo = rutas(repo).config;
  if (!existsSync(archivo)) throw new ErrorUsuario("Este repo no tiene .rastro/config.json: corré `rastro init`.");
  try {
    return checkConfig(JSON.parse(readFileSync(archivo, "utf8")), "config");
  } catch (e) {
    if (e instanceof ErrorValidacion || e instanceof SyntaxError) {
      throw new ErrorUsuario(`.rastro/config.json no es válido: ${e.message}`, { cause: e });
    }
    throw e;
  }
}

export function escribirConfig(repo: string, config: Config): void {
  mkdirSync(rutas(repo).dir, { recursive: true });
  writeFileSync(rutas(repo).config, `${JSON.stringify(config, null, 2)}\n`);
}

export function expandirHome(ruta: string): string {
  return ruta === "~" || ruta.startsWith("~/") ? join(homedir(), ruta.slice(1)) : ruta;
}
```

`src/eventos.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { lit, nullable, obj, str, type Check, type Infer } from "./contract/validar.ts";

const checkEventoCommit = obj({ tipo: lit("commit"), sha: str, rama: str, en: str });
const checkEventoSesion = obj({ tipo: lit("sesion"), id: str, transcript: str, rama: nullable(str), en: str });

export type Evento = Infer<typeof checkEventoCommit> | Infer<typeof checkEventoSesion>;

const checkEvento: Check<Evento> = (v, r) =>
  typeof v === "object" && v !== null && (v as { tipo?: unknown }).tipo === "commit" ? checkEventoCommit(v, r) : checkEventoSesion(v, r);

export function agregarEvento(archivo: string, evento: Evento): void {
  mkdirSync(dirname(archivo), { recursive: true });
  appendFileSync(archivo, `${JSON.stringify(evento)}\n`);
}

export function leerEventos(archivo: string): { eventos: Evento[]; descartados: number } {
  if (!existsSync(archivo)) return { eventos: [], descartados: 0 };
  const eventos: Evento[] = [];
  let descartados = 0;
  for (const linea of readFileSync(archivo, "utf8").split("\n")) {
    if (linea.trim() === "") continue;
    try {
      eventos.push(checkEvento(JSON.parse(linea), "evento"));
    } catch {
      descartados++; // Una línea rota (un hook cortado a mitad de escritura) no invalida el resto: se cuenta y se informa.
    }
  }
  return { eventos, descartados };
}
```

- [ ] **Step 4: Implementar los hooks**

`src/hooks.ts`:

```ts
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { leerConfig, rutas } from "./config.ts";
import { objAbierto, str } from "./contract/validar.ts";
import { vincularPorNombre } from "./detectores/vinculo.ts";
import { agregarEvento } from "./eventos.ts";
import { fechaLocal, sumarDias } from "./fechas.ts";
import { commitsDe, git, raizDelRepo } from "./git.ts";
import { parsearPlan } from "./plan.ts";

export function hookCommit(repo: string, ahora: Date): string | null {
  const sha = git(repo, ["rev-parse", "HEAD"]).trim();
  const rama = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  agregarEvento(rutas(repo).eventos, { tipo: "commit", sha, rama, en: ahora.toISOString() });
  return avisoDeDesvio(repo, rama, ahora);
}

/** REQ-8: una línea de aviso si el commit recién hecho no tiene tarea y el día ya supera el umbral. */
export function avisoDeDesvio(repo: string, rama: string, ahora: Date): string | null {
  const r = rutas(repo);
  if (!existsSync(r.config) || !existsSync(r.plan)) return null;
  const config = leerConfig(repo);
  const hoy = fechaLocal(ahora, config.zonaHoraria);
  const plan = parsearPlan(readFileSync(r.plan, "utf8"), hoy);
  if (plan === null) return null;
  const deHoy = commitsDe(repo, "HEAD", sumarDias(hoy, -1)).filter(
    (c) => c.padres.length < 2 && fechaLocal(c.fecha, config.zonaHoraria) === hoy,
  );
  const sinTarea = deHoy.filter((c) => vincularPorNombre({ rama, asunto: c.asunto, cuerpo: c.cuerpo }, plan.tareas) === null);
  const ultimo = deHoy[0];
  if (ultimo === undefined || !sinTarea.includes(ultimo)) return null;
  const pct = Math.round((sinTarea.length / deHoy.length) * 100);
  if (pct <= config.umbrales.fueraDelPlanPct) return null;
  return `rastro: ${sinTarea.length} de ${deHoy.length} commits de hoy están fuera del plan (${pct}%). Si es parte de una tarea, nombrala con [Tarea] en el mensaje.`;
}

const checkPayloadSesion = objAbierto({ session_id: str, transcript_path: str, cwd: str });

export function hookSesion(entrada: string, ahora: Date): void {
  const payload = checkPayloadSesion(JSON.parse(entrada), "SessionEnd");
  const repo = raizDelRepo(payload.cwd);
  let rama: string | null;
  try {
    rama = git(repo, ["symbolic-ref", "--short", "HEAD"]).trim();
  } catch {
    rama = null; // HEAD separado: la sesión queda sin rama.
  }
  agregarEvento(rutas(repo).eventos, { tipo: "sesion", id: payload.session_id, transcript: payload.transcript_path, rama, en: ahora.toISOString() });
}

function anotarError(error: unknown): void {
  const linea = `${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}\n`;
  try {
    appendFileSync(rutas(raizDelRepo(process.cwd())).errores, linea);
  } catch {
    process.stderr.write(`rastro (hook): ${linea}`); // Ni el log se pudo escribir: queda al menos en stderr.
  }
}

async function leerStdin(): Promise<string> {
  const partes: Buffer[] = [];
  for await (const parte of process.stdin) partes.push(parte as Buffer);
  return Buffer.concat(partes).toString("utf8");
}

export async function cmdHook(args: string[]): Promise<number> {
  try {
    if (args[0] === "commit") {
      const aviso = hookCommit(raizDelRepo(process.cwd()), new Date());
      if (aviso !== null) process.stderr.write(`${aviso}\n`);
    } else if (args[0] === "session-end") {
      hookSesion(await leerStdin(), new Date());
    } else {
      throw new Error(`hook desconocido: ${args[0] ?? "(ninguno)"}`);
    }
  } catch (e) {
    // Un hook nunca bloquea el commit ni la sesión (REQ-2): el error queda anotado y se sale con 0.
    anotarError(e);
  }
  return 0;
}
```

- [ ] **Step 5: Implementar init**

`src/init.ts`:

```ts
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { configPorDefecto, escribirConfig, rutas } from "./config.ts";
import { ErrorUsuario } from "./errores.ts";
import { git, raizDelRepo } from "./git.ts";
import { slugDe } from "./texto.ts";

const MARCA = "# rastro";
export const BIN_RASTRO = fileURLToPath(new URL("../bin/rastro.js", import.meta.url));

export function inicializar(repo: string, o: { equipo: string; binRastro: string }): string[] {
  const hechos: string[] = [];
  if (!existsSync(rutas(repo).config)) {
    const nombre = nombreDeGit(repo);
    escribirConfig(repo, configPorDefecto({ id: slugDe(nombre) || "yo", nombre, equipo: o.equipo }));
    hechos.push("Se creó .rastro/config.json");
  }
  hechos.push(excluir(repo, [".rastro/", ".claude/settings.local.json"]));
  hechos.push(instalarPostCommit(repo, o.binRastro));
  hechos.push(instalarSessionEnd(repo, o.binRastro));
  return hechos;
}

function nombreDeGit(repo: string): string {
  const pedido = 'Configurá tu nombre con `git config user.name "Tu Nombre"` y volvé a correr `rastro init`.';
  let nombre: string;
  try {
    nombre = git(repo, ["config", "user.name"]).trim();
  } catch (e) {
    throw new ErrorUsuario(pedido, { cause: e });
  }
  if (nombre === "") throw new ErrorUsuario(pedido);
  return nombre;
}

function excluir(repo: string, patrones: readonly string[]): string {
  const archivo = resolve(repo, git(repo, ["rev-parse", "--git-path", "info/exclude"]).trim());
  mkdirSync(dirname(archivo), { recursive: true });
  const actual = existsSync(archivo) ? readFileSync(archivo, "utf8") : "";
  const faltan = patrones.filter((p) => !actual.split("\n").includes(p));
  if (faltan.length === 0) return "Las exclusiones de git ya estaban";
  appendFileSync(archivo, `${actual === "" || actual.endsWith("\n") ? "" : "\n"}${faltan.join("\n")}\n`);
  return `Se excluyeron de git: ${faltan.join(", ")}`;
}

function instalarPostCommit(repo: string, bin: string): string {
  const dir = resolve(repo, git(repo, ["rev-parse", "--git-path", "hooks"]).trim());
  const archivo = join(dir, "post-commit");
  const linea = `node "${bin}" hook commit || true  ${MARCA}`;
  mkdirSync(dir, { recursive: true });
  if (!existsSync(archivo)) {
    writeFileSync(archivo, `#!/bin/sh\n${linea}\n`);
    chmodSync(archivo, 0o755);
    return "Se instaló el hook post-commit";
  }
  const actual = readFileSync(archivo, "utf8");
  if (actual.includes(MARCA)) return "El hook post-commit ya llamaba a rastro";
  const [primera = "", ...resto] = actual.split("\n");
  if (!/^#!.*\b(sh|bash|zsh|dash)\b/.test(primera)) {
    return `El post-commit existente no es un script de shell: agregá a mano esta línea: ${linea}`;
  }
  // Va justo después del shebang: si el hook original termina con `exit`, igual corre.
  writeFileSync(archivo, [primera, linea, ...resto].join("\n"));
  return "Se encadenó rastro al hook post-commit existente";
}

function instalarSessionEnd(repo: string, bin: string): string {
  const archivo = join(repo, ".claude", "settings.local.json");
  const comando = `node "${bin}" hook session-end`;
  let ajustes: Record<string, unknown> = {};
  if (existsSync(archivo)) {
    try {
      const leido: unknown = JSON.parse(readFileSync(archivo, "utf8"));
      if (typeof leido !== "object" || leido === null || Array.isArray(leido)) throw new Error("no es un objeto JSON");
      ajustes = leido as Record<string, unknown>;
    } catch (e) {
      throw new ErrorUsuario(".claude/settings.local.json no es JSON válido: no lo toco. Arreglalo y volvé a correr `rastro init`.", { cause: e });
    }
  }
  const hooks = (typeof ajustes["hooks"] === "object" && ajustes["hooks"] !== null ? ajustes["hooks"] : {}) as Record<string, unknown>;
  const sessionEnd = Array.isArray(hooks["SessionEnd"]) ? (hooks["SessionEnd"] as unknown[]) : [];
  if (JSON.stringify(sessionEnd).includes("hook session-end")) return "El hook SessionEnd de Claude Code ya llamaba a rastro";
  sessionEnd.push({ hooks: [{ type: "command", command: comando }] });
  hooks["SessionEnd"] = sessionEnd;
  ajustes["hooks"] = hooks;
  mkdirSync(dirname(archivo), { recursive: true });
  writeFileSync(archivo, `${JSON.stringify(ajustes, null, 2)}\n`);
  return "Se agregó el hook SessionEnd en .claude/settings.local.json";
}

export async function cmdInit(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { equipo: { type: "string", default: "AI Day" } } });
  const repo = raizDelRepo(process.cwd());
  for (const hecho of inicializar(repo, { equipo: values.equipo, binRastro: BIN_RASTRO })) process.stdout.write(`- ${hecho}\n`);
  process.stdout.write("Listo. Armá el plan con `rastro plan <propuesta.md>` y generá el día con `rastro daily`.\n");
  return 0;
}
```

- [ ] **Step 6: Registrar los comandos**

En `src/cli.ts`, reemplazar:

```ts
const comandos: Readonly<Record<string, () => Promise<Comando>>> = {};
```

por:

```ts
const comandos: Readonly<Record<string, () => Promise<Comando>>> = {
  init: async () => (await import("./init.ts")).cmdInit,
  hook: async () => (await import("./hooks.ts")).cmdHook,
};
```

- [ ] **Step 7: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS (el test de permisos se saltea solo si se corre como root).

- [ ] **Step 8: Commit**

```bash
git add src/config.ts src/eventos.ts src/hooks.ts src/init.ts src/cli.ts test/hooks.test.ts
git commit -m "feat: init, hooks post-commit y SessionEnd que solo anotan eventos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Interfaz LLM y `claude -p`

**Files:**
- Create: `src/llm/llm.ts`, `src/llm/claudeCli.ts`, `src/llm/crear.ts`, `test/helpers/fakeLlm.ts`
- Test: `test/claudeCli.test.ts`

**Interfaces:**
- Consumes: `Costo` (Task 2); `Check`, `objAbierto`, `bool`, `num`, `str`, `desconocido` (Task 2); `Config` (Task 9); `log` (Task 1).
- Produces (`llm.ts`): `type PedidoLlm<T> = { uso: string; sistema: string; prompt: string; esquema: Record<string, unknown>; validar: Check<T> }`; `interface Llm { completar<T>(p: PedidoLlm<T>): Promise<T>; costo(): Costo }`; `class ErrorLlm extends Error`.
- Produces (`claudeCli.ts`): `type Ejecutor = (bin: string, args: readonly string[], entrada: string, timeoutMs: number, cwd?: string) => Promise<{ codigo: number | null; stdout: string; stderr: string }>`; `ejecutarProceso: Ejecutor`; `class ClaudeCli implements Llm` con `constructor(o: { modelo: string; binario?: string; timeoutMs?: number; ejecutar?: Ejecutor })`.
- Produces (`crear.ts`): `crearLlm(config: Config): Llm | null`.
- Produces (`test/helpers/fakeLlm.ts`): `class FakeLlm implements Llm` con `constructor(respuestas: Record<uso, unknown> | "falla")`, `usos: string[]`, `prompts: string[]`.

- [ ] **Step 1: Escribir el test que falla**

`test/claudeCli.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { obj, str } from "../src/contract/validar.ts";
import { ClaudeCli, type Ejecutor } from "../src/llm/claudeCli.ts";
import { ErrorLlm, type PedidoLlm } from "../src/llm/llm.ts";

const pedido: PedidoLlm<{ respuesta: string }> = {
  uso: "prueba",
  sistema: "Respondés solo JSON.",
  prompt: "decí ok",
  esquema: { type: "object", properties: { respuesta: { type: "string" } }, required: ["respuesta"], additionalProperties: false },
  validar: obj({ respuesta: str }),
};

// Forma real de `claude -p --output-format json --json-schema` (medida el 2026-10-09).
const salidaOk = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: '{"respuesta":"ok"}',
  structured_output: { respuesta: "ok" },
  total_cost_usd: 0.00025,
  usage: { input_tokens: 2, output_tokens: 55, cache_creation_input_tokens: 1133, cache_read_input_tokens: 0 },
  session_id: "x",
});

test("devuelve la salida estructurada, acumula costo y usa los flags baratos y sin herramientas", async () => {
  const llamadas: { args: readonly string[]; entrada: string }[] = [];
  const ejecutar: Ejecutor = async (_bin, args, entrada) => {
    llamadas.push({ args, entrada });
    return { codigo: 0, stdout: salidaOk, stderr: "" };
  };
  const llm = new ClaudeCli({ modelo: "haiku", ejecutar });
  assert.deepEqual(await llm.completar(pedido), { respuesta: "ok" });
  assert.deepEqual(llm.costo(), { llamadas: 1, usd: 0.00025, tokens: 1190 });
  const args = llamadas[0]?.args ?? [];
  assert.equal(llamadas[0]?.entrada, "decí ok");
  for (const [flag, valor] of [["--tools", ""], ["--setting-sources", ""], ["--model", "haiku"], ["--output-format", "json"]] as const) {
    assert.equal(args[args.indexOf(flag) + 1], valor);
  }
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(args.includes("--strict-mcp-config"));
});

test("reintenta una vez si la primera respuesta no sirve", async () => {
  let n = 0;
  const ejecutar: Ejecutor = async () => (++n === 1 ? { codigo: 0, stdout: "no es json", stderr: "" } : { codigo: 0, stdout: salidaOk, stderr: "" });
  assert.deepEqual(await new ClaudeCli({ modelo: "haiku", ejecutar }).completar(pedido), { respuesta: "ok" });
  assert.equal(n, 2);
});

test("después de dos fallas lanza ErrorLlm", async () => {
  const ejecutar: Ejecutor = async () => ({ codigo: 1, stdout: "", stderr: "boom" });
  await assert.rejects(new ClaudeCli({ modelo: "haiku", ejecutar }).completar(pedido), ErrorLlm);
});

test("una salida que no cumple el esquema cuenta como falla", async () => {
  const mala = JSON.stringify({ ...(JSON.parse(salidaOk) as object), structured_output: { otra: 1 } });
  const ejecutar: Ejecutor = async () => ({ codigo: 0, stdout: mala, stderr: "" });
  await assert.rejects(new ClaudeCli({ modelo: "haiku", ejecutar }).completar(pedido), ErrorLlm);
});

test("si el binario de claude no existe, ErrorLlm", async () => {
  await assert.rejects(new ClaudeCli({ modelo: "haiku", binario: "/no/existe/claude" }).completar(pedido), ErrorLlm);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/claudeCli.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`src/llm/llm.ts`:

```ts
import type { Costo } from "../contract/snapshot.ts";
import type { Check } from "../contract/validar.ts";

export type PedidoLlm<T> = {
  /** Nombre del uso ("bitacora", "vinculos"...): aparece en logs y en el LLM falso de los tests. */
  uso: string;
  sistema: string;
  prompt: string;
  esquema: Record<string, unknown>;
  validar: Check<T>;
};

export interface Llm {
  completar<T>(pedido: PedidoLlm<T>): Promise<T>;
  costo(): Costo;
}

export class ErrorLlm extends Error {
  override name = "ErrorLlm";
}
```

`src/llm/claudeCli.ts`:

```ts
import { spawn } from "node:child_process";
import type { Costo } from "../contract/snapshot.ts";
import { bool, desconocido, num, objAbierto } from "../contract/validar.ts";
import { log } from "../log.ts";
import { ErrorLlm, type Llm, type PedidoLlm } from "./llm.ts";

export type Ejecutor = (
  bin: string,
  args: readonly string[],
  entrada: string,
  timeoutMs: number,
  cwd?: string,
) => Promise<{ codigo: number | null; stdout: string; stderr: string }>;

export const ejecutarProceso: Ejecutor = (bin, args, entrada, timeoutMs, cwd) =>
  new Promise((resolve, reject) => {
    const hijo = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], timeout: timeoutMs, ...(cwd === undefined ? {} : { cwd }) });
    let stdout = "";
    let stderr = "";
    hijo.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    hijo.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
    });
    hijo.on("error", reject); // ENOENT si claude no está instalado
    hijo.stdin.on("error", reject); // EPIPE si el proceso murió antes de leer el prompt
    hijo.on("close", (codigo) => resolve({ codigo, stdout, stderr }));
    hijo.stdin.end(entrada);
  });

// Salida de `claude -p --output-format json`: abierta porque Claude Code suma campos seguido.
const checkSalida = objAbierto(
  {
    is_error: bool,
    total_cost_usd: num,
    usage: objAbierto({ input_tokens: num, output_tokens: num }, { cache_creation_input_tokens: num, cache_read_input_tokens: num }),
  },
  { structured_output: desconocido },
);

export class ClaudeCli implements Llm {
  readonly #modelo: string;
  readonly #binario: string;
  readonly #timeoutMs: number;
  readonly #ejecutar: Ejecutor;
  #llamadas = 0;
  #usd = 0;
  #tokens = 0;

  constructor(o: { modelo: string; binario?: string; timeoutMs?: number; ejecutar?: Ejecutor }) {
    this.#modelo = o.modelo;
    this.#binario = o.binario ?? "claude";
    this.#timeoutMs = o.timeoutMs ?? 120_000;
    this.#ejecutar = o.ejecutar ?? ejecutarProceso;
  }

  costo(): Costo {
    return { llamadas: this.#llamadas, usd: Math.round(this.#usd * 1e6) / 1e6, tokens: this.#tokens };
  }

  async completar<T>(pedido: PedidoLlm<T>): Promise<T> {
    try {
      return await this.#intentar(pedido);
    } catch (e) {
      log("warn", "llm_reintento", { uso: pedido.uso, detalle: e instanceof Error ? e.message : String(e) });
    }
    try {
      return await this.#intentar(pedido);
    } catch (e) {
      throw new ErrorLlm(`${pedido.uso}: el LLM no respondió bien después de 2 intentos`, { cause: e });
    }
  }

  async #intentar<T>(pedido: PedidoLlm<T>): Promise<T> {
    // Sin settings, sin MCP y con system prompt corto: baja el costo por llamada de ~US$0.12 a ~US$0.0003
    // y evita que la sesión headless dispare los hooks del proyecto.
    const args = [
      "-p",
      "--output-format", "json",
      "--model", this.#modelo,
      "--tools", "",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--system-prompt", pedido.sistema,
      "--json-schema", JSON.stringify(pedido.esquema),
    ];
    const r = await this.#ejecutar(this.#binario, args, pedido.prompt, this.#timeoutMs);
    if (r.codigo !== 0) throw new ErrorLlm(`claude salió con ${String(r.codigo)}: ${r.stderr.slice(0, 200)}`);
    const salida = checkSalida(JSON.parse(r.stdout), "claude");
    const u = salida.usage;
    this.#llamadas++;
    this.#usd += salida.total_cost_usd;
    this.#tokens += u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    if (salida.is_error || salida.structured_output === undefined) throw new ErrorLlm(`${pedido.uso}: respuesta sin salida estructurada`);
    return pedido.validar(salida.structured_output, pedido.uso);
  }
}
```

`src/llm/crear.ts`:

```ts
import type { Config } from "../config.ts";
import { ClaudeCli } from "./claudeCli.ts";
import type { Llm } from "./llm.ts";

export function crearLlm(config: Config): Llm | null {
  return config.llm.proveedor === "ninguno" ? null : new ClaudeCli({ modelo: config.llm.modelo });
}
```

`test/helpers/fakeLlm.ts`:

```ts
import type { Costo } from "../../src/contract/snapshot.ts";
import { ErrorLlm, type Llm, type PedidoLlm } from "../../src/llm/llm.ts";

/** LLM falso: responde por nombre de uso, o falla siempre con "falla". */
export class FakeLlm implements Llm {
  readonly usos: string[] = [];
  readonly prompts: string[] = [];
  readonly #respuestas: Readonly<Record<string, unknown>> | "falla";

  constructor(respuestas: Readonly<Record<string, unknown>> | "falla") {
    this.#respuestas = respuestas;
  }

  async completar<T>(pedido: PedidoLlm<T>): Promise<T> {
    this.usos.push(pedido.uso);
    this.prompts.push(pedido.prompt);
    if (this.#respuestas === "falla") throw new ErrorLlm(`${pedido.uso}: falla simulada`);
    const respuesta = this.#respuestas[pedido.uso];
    if (respuesta === undefined) throw new ErrorLlm(`${pedido.uso}: sin respuesta simulada`);
    return pedido.validar(respuesta, pedido.uso);
  }

  costo(): Costo {
    return { llamadas: this.usos.length, usd: 0, tokens: 0 };
  }
}
```

- [ ] **Step 4: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm test/helpers/fakeLlm.ts test/claudeCli.test.ts
git commit -m "feat: interfaz LLM con implementación claude -p headless" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `rastro daily`

**Files:**
- Create: `src/llm/usos.ts`, `src/fuentes/claudeCode.ts`, `src/gantt.ts`, `src/daily.ts`
- Modify: `src/cli.ts` (mapa `comandos`)
- Test: `test/daily.test.ts`

**Interfaces:**
- Consumes: todo lo anterior. En particular `recolectarGit`, `diffResumido`, `lineasAgregadas` (Task 5); `detectarPendientes`, `CommitVinculado` (Task 7); `calcularDesvios` (Task 8); `leerConfig`, `rutas`, `leerEventos`, `Evento` (Task 9); `Llm`, `ErrorLlm`, `crearLlm`, `FakeLlm` (Task 10).
- Produces (`usos.ts`): `pedidoVinculos(d)`, `pedidoBitacora(d)`, `pedidoSugerencias(d)`, `pedidoPlan(propuesta, semana)`, `pedidoSugerirPlan(d)`, cada uno devuelve `PedidoLlm<...>` con `uso` = `"vinculos"`, `"bitacora"`, `"sugerencias"`, `"plan"`, `"sugerir-plan"`. Tipos `DatosVinculos`, `DatosBitacora`, `DatosSugerencias`.
- Produces (`claudeCode.ts`): `tituloDeSesion(transcript: string): string | null`.
- Produces (`gantt.ts`): `ganttMock(plan, commitsSemana, zona): Gantt`.
- Produces (`daily.ts`): `type ContextoDaily = { repo; config; llm: Llm | null; ahora: Date; desde?: Fecha }`; `generarSnapshot(ctx): Promise<{ snapshot: Snapshot; avisos: string[] }>`; `textoDelDia(s: Snapshot): string`; `cmdDaily(args)`.

- [ ] **Step 1: Escribir el test que falla**

`test/daily.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { configPorDefecto, escribirConfig } from "../src/config.ts";
import { generarSnapshot } from "../src/daily.ts";
import { agregarEvento } from "../src/eventos.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepo, type RepoTemporal } from "./helpers/repo.ts";

const ZONA = "America/Argentina/Buenos_Aires";
const config = configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" });
const resumenOk = { hice: ["Se hizo algo."], avance: [], sigue: ["Revisar algo."], bloqueos: [] };

function repoConPlan(): RepoTemporal {
  const r = crearRepo();
  escribirConfig(r.dir, config);
  const hoy = fechaLocal(new Date(), ZONA);
  r.escribir(".gitignore", ".rastro/\n");
  r.escribir(
    ".rastro/plan.md",
    [
      `## Plan semana ${ddmm(lunesDe(hoy))}`,
      "- **Entregable del viernes:** Demo.",
      "- [ ] **Pendientes:** Detectar lo resuelto.",
      "- [x] **Bitácora:** Registrar el día.",
      "- [ ] **Central:** Recibir snapshots.",
      "",
    ].join("\n"),
  );
  r.commit("inicio");
  return r;
}

test("resuelto sin cerrar de punta a punta, con la bitácora y su evidencia", async () => {
  const r = repoConPlan();
  r.git("checkout", "-q", "-b", "feat/pendientes");
  r.escribir("src/detector.ts", "export const x = 1;\n");
  const enRama = r.commit("[Pendientes] detector");
  r.git("checkout", "-q", "main");
  r.git("merge", "-q", "--no-ff", "feat/pendientes", "-m", "Merge branch 'feat/pendientes'");
  const merge = r.git("rev-parse", "HEAD");

  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date() });

  const p = snapshot.pendientes.find((x) => x.tipo === "resuelto-sin-cerrar");
  assert.equal(p?.tarea, "pendientes");
  assert.equal(p?.proximoPaso, "Tildar Pendientes en el plan.");
  assert.ok(p?.evidencia.some((e) => e.ref === merge.slice(0, 7)));
  const entrada = snapshot.bitacora.find((e) => e.evidencia.some((x) => x.ref === enRama.slice(0, 7)));
  assert.equal(entrada?.rama, "feat/pendientes");
  assert.equal(entrada?.vinculo, "nombre");
  assert.deepEqual(entrada?.evidencia[1], { tipo: "rama", ref: "feat/pendientes" });
  assert.equal(snapshot.resumen, null);
  assert.equal(snapshot.gantt.mock, true);
});

test("las sesiones de Claude Code entran a la bitácora con su título", async () => {
  const r = repoConPlan();
  const transcript = join(r.dir, ".rastro", "t.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ type: "ai-title", aiTitle: "Armar el detector de [Pendientes]", sessionId: "s1" })}\n`);
  agregarEvento(join(r.dir, ".rastro", "events.jsonl"), { tipo: "sesion", id: "s1234567890", transcript, rama: "main", en: new Date().toISOString() });
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date() });
  const sesion = snapshot.bitacora.find((e) => e.evidencia[0]?.tipo === "sesion");
  assert.equal(sesion?.texto, "Sesión de Claude Code: Armar el detector de [Pendientes].");
  assert.equal(sesion?.tarea, "pendientes");
  assert.deepEqual(sesion?.evidencia, [{ tipo: "sesion", ref: "s1234567" }]);
});

test("sin LLM un commit sin etiqueta queda sin tarea; con LLM se infiere y se marca", async () => {
  const r = repoConPlan();
  const sha = r.commit("fix parser");
  const sinLlm = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date() });
  assert.equal(sinLlm.snapshot.bitacora.find((e) => e.texto === "fix parser")?.vinculo, "sin-tarea");

  const llm = new FakeLlm({
    vinculos: { vinculos: [{ sha, tarea: "central", razon: "Toca el parser del central." }] },
    bitacora: { entradas: [], resumen: resumenOk },
  });
  const conLlm = await generarSnapshot({ repo: r.dir, config, llm, ahora: new Date() });
  const e = conLlm.snapshot.bitacora.find((x) => x.texto === "fix parser");
  assert.equal(e?.vinculo, "inferido");
  assert.equal(e?.tarea, "central");
  assert.equal(e?.razon, "Toca el parser del central.");
});

test("con LLM hay resumen, y lo que quedó sin actividad aparece en sigue", async () => {
  const r = repoConPlan();
  r.commit("[Pendientes] avance");
  const llm = new FakeLlm({
    vinculos: { vinculos: [] },
    bitacora: { entradas: [{ id: "0", texto: "Se avanzó con el detector." }], resumen: resumenOk },
  });
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm, ahora: new Date() });
  assert.deepEqual(snapshot.desvios.tareasSinActividad, ["central"]);
  assert.ok(snapshot.resumen?.sigue.includes("Central no tuvo actividad esta semana."));
  assert.ok(snapshot.resumen?.sigue.includes("Revisar algo."));
  assert.ok(snapshot.bitacora.some((e) => e.texto === "Se avanzó con el detector."));
  assert.equal(snapshot.costo.llamadas, 2);
});

test("con el LLM caído no hay resumen pero los pendientes salen completos", async () => {
  const r = repoConPlan();
  const { snapshot, avisos } = await generarSnapshot({ repo: r.dir, config, llm: new FakeLlm("falla"), ahora: new Date() });
  assert.equal(snapshot.resumen, null);
  assert.ok(snapshot.pendientes.some((p) => p.tipo === "cerrado-sin-evidencia" && p.tarea === "bitacora"));
  assert.ok(avisos.some((a) => a.startsWith("Sin vínculos inferidos")));
});

test("ningún secreto de un commit llega al prompt del LLM", async () => {
  const r = repoConPlan();
  const token = `ghp_${"b".repeat(36)}`;
  r.commit(`[Central] config con GITHUB_TOKEN=${token}`);
  const llm = new FakeLlm({ vinculos: { vinculos: [] }, bitacora: { entradas: [], resumen: resumenOk } });
  await generarSnapshot({ repo: r.dir, config, llm, ahora: new Date() });
  assert.ok(llm.prompts.length > 0);
  assert.ok(llm.prompts.every((p) => !p.includes(token)));
});

test("un repo sin commits ni plan produce un snapshot vacío y válido", async () => {
  const r = crearRepo();
  escribirConfig(r.dir, config);
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm: null, ahora: new Date() });
  assert.deepEqual([snapshot.bitacora, snapshot.pendientes, snapshot.plan], [[], [], null]);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/daily.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar los pedidos al LLM**

`src/llm/usos.ts`:

```ts
import { arr, lit, nullable, objAbierto, str, type Infer } from "../contract/validar.ts";
import type { Fecha } from "../fechas.ts";
import { redactar } from "../redactar.ts";
import type { PedidoLlm } from "./llm.ts";

const SISTEMA =
  "Sos el asistente de Rastro. Respondés solo con el JSON pedido, en español rioplatense neutro y técnico. No inventás nada que no esté en los datos.";

const TEXTO = { type: "string" };
const LISTA_TEXTO = { type: "array", items: TEXTO };

function objeto(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

function lista(items: Record<string, unknown>): Record<string, unknown> {
  return { type: "array", items };
}

/** Todo lo que va al LLM pasa por acá: los secretos se redactan en un solo lugar (REQ-13). */
function armarPrompt(instrucciones: string, datos: unknown): string {
  return redactar(`${instrucciones}\n\nDatos (JSON):\n${JSON.stringify(datos, null, 1)}`);
}

const checkVinculos = objAbierto({ vinculos: arr(objAbierto({ sha: str, tarea: nullable(str), razon: str })) });

export type DatosVinculos = {
  commits: { sha: string; asunto: string; archivos: string[] }[];
  tareas: { slug: string; nombre: string; objetivo: string }[];
};

export function pedidoVinculos(d: DatosVinculos): PedidoLlm<Infer<typeof checkVinculos>> {
  return {
    uso: "vinculos",
    sistema: SISTEMA,
    prompt: armarPrompt(
      "Para cada commit, elegí el slug de la tarea del plan a la que más probablemente pertenece, mirando el asunto y los archivos. Si ninguna encaja con claridad, tarea: null. razon: una oración que explique el vínculo. Usá solo slugs de la lista de tareas.",
      d,
    ),
    esquema: objeto({ vinculos: lista(objeto({ sha: TEXTO, tarea: { type: ["string", "null"] }, razon: TEXTO })) }),
    validar: checkVinculos,
  };
}

const checkBitacora = objAbierto({
  entradas: arr(objAbierto({ id: str, texto: str })),
  resumen: objAbierto({ hice: arr(str), avance: arr(str), sigue: arr(str), bloqueos: arr(str) }),
});

export type DatosBitacora = {
  entregable: string | null;
  entradas: { id: string; tarea: string | null; rama: string; asunto: string; diff: string }[];
  pendientes: { texto: string; proximoPaso: string }[];
  sinActividad: string[];
};

export function pedidoBitacora(d: DatosBitacora): PedidoLlm<Infer<typeof checkBitacora>> {
  return {
    uso: "bitacora",
    sistema: SISTEMA,
    prompt: armarPrompt(
      [
        "Escribí la bitácora y el resumen del día.",
        '- entradas: para cada entrada, devolvé su mismo id y un texto de una oración (menos de 25 palabras) en pasado impersonal ("Se agregó…", "Se corrigió…") que describa el resultado según el diff, no los pasos.',
        "- resumen.hice: lo que se completó. resumen.avance: avances parciales, hallazgos o decisiones. resumen.sigue: próximos pasos según los pendientes y las tareas sin actividad. resumen.bloqueos: solo si los datos los muestran.",
        "- Cada lista del resumen tiene de 0 a 5 ítems de una oración.",
      ].join("\n"),
      d,
    ),
    esquema: objeto({
      entradas: lista(objeto({ id: TEXTO, texto: TEXTO })),
      resumen: objeto({ hice: LISTA_TEXTO, avance: LISTA_TEXTO, sigue: LISTA_TEXTO, bloqueos: LISTA_TEXTO }),
    }),
    validar: checkBitacora,
  };
}

const TIPOS_AUTOMATIZACION = ["alias", "script", "hook", "skill"] as const;
const checkSugerencias = objAbierto({
  propuestas: arr(objAbierto({ id: str, tipo: lit(...TIPOS_AUTOMATIZACION), contenido: str, porque: str })),
});

export type DatosSugerencias = {
  patrones: { id: string; fuente: "zsh" | "claude-code"; patron: string; ocurrencias: number; dias: number }[];
};

export function pedidoSugerencias(d: DatosSugerencias): PedidoLlm<Infer<typeof checkSugerencias>> {
  return {
    uso: "sugerencias",
    sistema: SISTEMA,
    prompt: armarPrompt(
      "Para cada patrón repetido, proponé la automatización más simple que lo resuelva: alias o script para comandos de terminal (fuente zsh); hook o skill de Claude Code para pedidos repetidos a Claude (fuente claude-code). contenido: el código o el texto listo para usar. porque: una oración con el beneficio, citando las ocurrencias. Devolvé el mismo id. Omití los patrones que no vale la pena automatizar.",
      d,
    ),
    esquema: objeto({
      propuestas: lista(objeto({ id: TEXTO, tipo: { type: "string", enum: [...TIPOS_AUTOMATIZACION] }, contenido: TEXTO, porque: TEXTO })),
    }),
    validar: checkSugerencias,
  };
}

const checkTareaNueva = objAbierto({ nombre: str, objetivo: str });
const checkPlan = objAbierto({ entregable: str, tareas: arr(checkTareaNueva) });

export function pedidoPlan(propuesta: string, semana: Fecha): PedidoLlm<Infer<typeof checkPlan>> {
  return {
    uso: "plan",
    sistema: SISTEMA,
    prompt: armarPrompt(
      [
        `Armá el plan de la semana que empieza el ${semana} a partir de la propuesta.`,
        "- entregable: qué se va a poder mostrar o reproducir el viernes, concreto y verificable.",
        '- tareas: entre 2 y 7. nombre: de 1 a 3 palabras, sin el carácter ":" (se usa como etiqueta [Nombre] en los commits). objetivo: una oración en infinitivo.',
      ].join("\n"),
      { propuesta: propuesta.slice(0, 30_000) },
    ),
    esquema: objeto({ entregable: TEXTO, tareas: lista(objeto({ nombre: TEXTO, objetivo: TEXTO })) }),
    validar: checkPlan,
  };
}

const checkSugerirPlan = objAbierto({ tareas: arr(checkTareaNueva) });

export function pedidoSugerirPlan(d: {
  plan: { nombre: string; objetivo: string }[];
  trabajoFueraDelPlan: string[];
}): PedidoLlm<Infer<typeof checkSugerirPlan>> {
  return {
    uso: "sugerir-plan",
    sistema: SISTEMA,
    prompt: armarPrompt(
      'Proponé de 0 a 4 tareas nuevas para el plan a partir del trabajo que se hizo fuera de él. Solo tareas que no estén ya en el plan. nombre: de 1 a 3 palabras, sin ":". objetivo: una oración en infinitivo.',
      d,
    ),
    esquema: objeto({ tareas: lista(objeto({ nombre: TEXTO, objetivo: TEXTO })) }),
    validar: checkSugerirPlan,
  };
}
```

- [ ] **Step 4: Implementar el título de sesión y el Gantt mock**

`src/fuentes/claudeCode.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";

/** El título que Claude Code le pone a la sesión (línea "ai-title" del transcript); el último gana. */
export function tituloDeSesion(transcript: string): string | null {
  if (!existsSync(transcript)) return null;
  let titulo: string | null = null;
  for (const linea of readFileSync(transcript, "utf8").split("\n")) {
    if (!linea.includes('"ai-title"')) continue;
    let o: unknown;
    try {
      o = JSON.parse(linea);
    } catch {
      continue; // Línea cortada: el título se busca en las demás.
    }
    const r = o as { type?: unknown; aiTitle?: unknown };
    if (r.type === "ai-title" && typeof r.aiTitle === "string") titulo = r.aiTitle;
  }
  return titulo;
}
```

`src/gantt.ts`:

```ts
import type { Gantt, Plan } from "./contract/snapshot.ts";
import type { CommitVinculado } from "./detectores/pendientes.ts";
import { fechaLocal, sumarDias, type Fecha } from "./fechas.ts";
import { slugDe } from "./texto.ts";

function rango(fechas: readonly Fecha[] | undefined): { desde: Fecha; hasta: Fecha } | null {
  if (fechas === undefined || fechas.length === 0) return null;
  const orden = [...fechas].sort();
  return { desde: orden[0] ?? "", hasta: orden[orden.length - 1] ?? "" };
}

/** Mock: plan.md no tiene fechas por tarea, así que el plan de cada barra es la semana entera. Lo real sale de los commits. */
export function ganttMock(plan: Plan | null, commitsSemana: readonly CommitVinculado[], zona: string): Gantt {
  const fechas = new Map<string, Fecha[]>();
  for (const c of commitsSemana) {
    const clave = c.vinculo.tarea ?? `rama:${c.rama}`;
    fechas.set(clave, [...(fechas.get(clave) ?? []), fechaLocal(c.fecha, zona)]);
  }
  const barras: Gantt["barras"] = [];
  if (plan !== null) {
    for (const t of plan.tareas) {
      if (t.estado === "sacada") continue;
      barras.push({ tarea: t.slug, plan: { desde: plan.semana, hasta: sumarDias(plan.semana, 4) }, real: rango(fechas.get(t.slug)) });
    }
  }
  // Trabajo sin tarea: "tareas fantasma", con barra real y sin plan.
  for (const [clave, fs] of fechas) if (clave.startsWith("rama:")) barras.push({ tarea: slugDe(clave.slice(5)), plan: null, real: rango(fs) });
  return { mock: true, barras };
}
```

- [ ] **Step 5: Implementar daily**

`src/daily.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { leerConfig, rutas, type Config } from "./config.ts";
import {
  validarSnapshot,
  type EntradaBitacora,
  type Evidencia,
  type Pendiente,
  type Plan,
  type Resumen,
  type Snapshot,
  type Sugerencia,
  type Tarea,
} from "./contract/snapshot.ts";
import { calcularDesvios } from "./detectores/desvios.ts";
import { detectarPendientes, type CommitVinculado } from "./detectores/pendientes.ts";
import { vincularPorNombre, type Vinculo } from "./detectores/vinculo.ts";
import { ErrorUsuario } from "./errores.ts";
import { leerEventos, type Evento } from "./eventos.ts";
import { fechaLocal, horaLocal, lunesDe, sumarDias, type Fecha } from "./fechas.ts";
import { tituloDeSesion } from "./fuentes/claudeCode.ts";
import { ganttMock } from "./gantt.ts";
import { diffResumido, lineasAgregadas, raizDelRepo, recolectarGit, type Commit } from "./git.ts";
import { crearLlm } from "./llm/crear.ts";
import { ErrorLlm, type Llm } from "./llm/llm.ts";
import { pedidoBitacora, pedidoVinculos } from "./llm/usos.ts";
import { log } from "./log.ts";
import { parsearPlan } from "./plan.ts";

export type ContextoDaily = { repo: string; config: Config; llm: Llm | null; ahora: Date; desde?: Fecha };
export type ResultadoDaily = { snapshot: Snapshot; avisos: string[] };

type ItemBitacora = { entrada: EntradaBitacora; sha: string | null };

const MAX_DIFF_POR_COMMIT = 4_000;
const MAX_DIFF_TOTAL = 40_000;

export async function generarSnapshot(ctx: ContextoDaily): Promise<ResultadoDaily> {
  const { repo, config } = ctx;
  const zona = config.zonaHoraria;
  const hoy = fechaLocal(ctx.ahora, zona);
  const desde = ctx.desde ?? hoy;
  const inicio = desde < lunesDe(hoy) ? desde : lunesDe(hoy);
  const r = rutas(repo);
  const avisos: string[] = [];
  // Si el LLM falla una vez, no se vuelve a intentar en esta corrida.
  let llm = ctx.llm;

  const plan = existsSync(r.plan) ? parsearPlan(readFileSync(r.plan, "utf8"), hoy) : null;
  const tareas = plan?.tareas ?? [];
  const datos = recolectarGit(repo, sumarDias(inicio, -1));
  const { eventos, descartados } = leerEventos(r.eventos);
  if (descartados > 0) avisos.push(`Se descartaron ${descartados} eventos ilegibles de .rastro/events.jsonl.`);
  const ramaPorSha = new Map<string, string>();
  for (const e of eventos) if (e.tipo === "commit") ramaPorSha.set(e.sha, e.rama);

  const enRango = (c: Commit, d: Fecha): boolean => {
    const f = fechaLocal(c.fecha, zona);
    return f >= d && f <= hoy;
  };
  const vincular = (c: Commit): CommitVinculado => {
    const rama = ramaPorSha.get(c.sha) ?? c.rama;
    const tarea = vincularPorNombre({ rama, asunto: c.asunto, cuerpo: c.cuerpo }, tareas);
    return { ...c, rama, vinculo: tarea === null ? { tarea: null, tipo: "sin-tarea" } : { tarea, tipo: "nombre" } };
  };
  const deLaSemana = datos.commits.filter((c) => enRango(c, inicio));
  const merges = deLaSemana.filter((c) => c.padres.length > 1);
  let semana = deLaSemana.filter((c) => c.padres.length < 2).map(vincular);

  if (llm !== null && tareas.length > 0) {
    const sinTarea = semana.filter((c) => enRango(c, desde) && c.vinculo.tipo === "sin-tarea");
    const inferidos = await inferirVinculos(llm, sinTarea, tareas, avisos);
    if (inferidos === null) llm = null;
    else {
      semana = semana.map((c) => {
        const v = inferidos.get(c.sha);
        return v === undefined ? c : { ...c, vinculo: v };
      });
    }
  }
  const periodo = semana.filter((c) => enRango(c, desde));

  const evidenciaCommit = (sha: string): Evidencia =>
    datos.urlBase === null
      ? { tipo: "commit", ref: sha.slice(0, 7) }
      : { tipo: "commit", ref: sha.slice(0, 7), url: `${datos.urlBase}/commit/${sha}` };
  const pendientes = detectarPendientes({
    plan,
    commitsSemana: semana,
    commitsPeriodo: periodo,
    merges,
    ramas: datos.ramas,
    ramaPrincipal: datos.ramaPrincipal,
    lineasAgregadas: (sha) => lineasAgregadas(repo, sha),
    evidenciaCommit,
    ahora: ctx.ahora,
    ramaQuietaDias: config.umbrales.ramaQuietaDias,
  });
  const desvios = calcularDesvios({ plan, commitsPeriodo: periodo, commitsSemana: semana, umbralPct: config.umbrales.fueraDelPlanPct });

  const items: ItemBitacora[] = [
    ...periodo.map((c): ItemBitacora => ({ entrada: entradaDeCommit(c, zona, evidenciaCommit), sha: c.sha })),
    ...entradasDeSesiones(eventos, tareas, zona, desde, hoy).map((entrada): ItemBitacora => ({ entrada, sha: null })),
  ].sort((a, b) => `${b.entrada.fecha} ${b.entrada.hora}`.localeCompare(`${a.entrada.fecha} ${a.entrada.hora}`));

  const nombreDe = (slug: string): string => tareas.find((t) => t.slug === slug)?.nombre ?? slug;
  const sigue = [
    ...pendientes.map((p) => p.proximoPaso),
    ...desvios.tareasSinActividad.map((s) => `${nombreDe(s)} no tuvo actividad esta semana.`),
  ];
  let bitacora = items.map((i) => i.entrada);
  let resumen: Resumen | null = null;
  if (llm !== null) {
    const res = await resumirConLlm(llm, repo, plan, items, pendientes, desvios.tareasSinActividad.map(nombreDe), avisos);
    if (res === null) {
      llm = null;
    } else {
      bitacora = bitacora.map((e, i) => ({ ...e, texto: res.textos.get(i) ?? e.texto }));
      resumen = { ...res.resumen, sigue: [...new Set([...sigue, ...res.resumen.sigue])] };
    }
  }

  const sugerencias: Sugerencia[] = [];

  const snapshot = validarSnapshot({
    schemaVersion: 1,
    generadoEn: ctx.ahora.toISOString(),
    persona: config.persona,
    repo: datos.urlBase === null ? { nombre: basename(repo) } : { nombre: basename(repo), url: datos.urlBase },
    periodo: { desde, hasta: hoy },
    plan,
    bitacora,
    pendientes,
    desvios,
    resumen,
    sugerencias,
    gantt: ganttMock(plan, semana, zona),
    costo: ctx.llm?.costo() ?? { llamadas: 0, usd: 0, tokens: 0 },
  });
  return { snapshot, avisos };
}

async function inferirVinculos(
  llm: Llm,
  commits: readonly CommitVinculado[],
  tareas: readonly Tarea[],
  avisos: string[],
): Promise<Map<string, Vinculo> | null> {
  const res = new Map<string, Vinculo>();
  if (commits.length === 0) return res;
  try {
    const r = await llm.completar(
      pedidoVinculos({
        commits: commits.map((c) => ({ sha: c.sha, asunto: c.asunto, archivos: c.archivos.slice(0, 20) })),
        tareas: tareas.map((t) => ({ slug: t.slug, nombre: t.nombre, objetivo: t.objetivo })),
      }),
    );
    const slugs = new Set(tareas.map((t) => t.slug));
    // Un slug inventado por el LLM se descarta: el commit queda sin tarea.
    for (const v of r.vinculos) if (v.tarea !== null && slugs.has(v.tarea)) res.set(v.sha, { tarea: v.tarea, tipo: "inferido", razon: v.razon });
    return res;
  } catch (e) {
    if (!(e instanceof ErrorLlm)) throw e;
    avisos.push(`Sin vínculos inferidos: el LLM no está disponible (${e.message}).`);
    return null;
  }
}

async function resumirConLlm(
  llm: Llm,
  repo: string,
  plan: Plan | null,
  items: readonly ItemBitacora[],
  pendientes: readonly Pendiente[],
  sinActividad: string[],
  avisos: string[],
): Promise<{ textos: Map<number, string>; resumen: Resumen } | null> {
  let presupuesto = MAX_DIFF_TOTAL;
  const entradas = items.map((item, i) => {
    let diff = "";
    if (item.sha !== null && presupuesto > 0) {
      diff = diffResumido(repo, item.sha, Math.min(MAX_DIFF_POR_COMMIT, presupuesto));
      presupuesto -= diff.length;
    }
    return { id: String(i), tarea: item.entrada.tarea, rama: item.entrada.rama, asunto: item.entrada.texto, diff };
  });
  try {
    const res = await llm.completar(
      pedidoBitacora({
        entregable: plan?.entregable ?? null,
        entradas,
        pendientes: pendientes.map((p) => ({ texto: p.texto, proximoPaso: p.proximoPaso })),
        sinActividad,
      }),
    );
    return { textos: new Map(res.entradas.map((e): [number, string] => [Number(e.id), e.texto])), resumen: res.resumen };
  } catch (e) {
    if (!(e instanceof ErrorLlm)) throw e;
    avisos.push(`Sin resumen: el LLM no está disponible (${e.message}).`);
    return null;
  }
}

function entradaDeCommit(c: CommitVinculado, zona: string, evidenciaCommit: (sha: string) => Evidencia): EntradaBitacora {
  return {
    fecha: fechaLocal(c.fecha, zona),
    hora: horaLocal(c.fecha, zona),
    tarea: c.vinculo.tarea,
    rama: c.rama,
    texto: c.asunto,
    vinculo: c.vinculo.tipo,
    ...(c.vinculo.razon === undefined ? {} : { razon: c.vinculo.razon }),
    evidencia: [evidenciaCommit(c.sha), { tipo: "rama", ref: c.rama }],
  };
}

function entradasDeSesiones(eventos: readonly Evento[], tareas: readonly Tarea[], zona: string, desde: Fecha, hoy: Fecha): EntradaBitacora[] {
  const res: EntradaBitacora[] = [];
  for (const e of eventos) {
    if (e.tipo !== "sesion") continue;
    const en = new Date(e.en);
    const fecha = fechaLocal(en, zona);
    if (fecha < desde || fecha > hoy) continue;
    const titulo = tituloDeSesion(e.transcript);
    const tarea = vincularPorNombre({ rama: e.rama ?? "", asunto: titulo ?? "", cuerpo: "" }, tareas);
    res.push({
      fecha,
      hora: horaLocal(en, zona),
      tarea,
      rama: e.rama ?? "(sin rama)",
      texto: titulo === null ? "Sesión de Claude Code." : `Sesión de Claude Code: ${titulo}.`,
      vinculo: tarea === null ? "sin-tarea" : "nombre",
      evidencia: [{ tipo: "sesion", ref: e.id.slice(0, 8) }],
    });
  }
  return res;
}

export function textoDelDia(s: Snapshot): string {
  const l: string[] = [
    `Rastro · ${s.persona.nombre} · ${s.periodo.desde === s.periodo.hasta ? s.periodo.hasta : `${s.periodo.desde} a ${s.periodo.hasta}`}`,
    `Bitácora: ${s.bitacora.length} entradas · Pendientes: ${s.pendientes.length} · Fuera del plan: ${s.desvios.fueraDelPlanPct}%${s.desvios.alerta ? " (alerta)" : ""}`,
  ];
  if (s.pendientes.length > 0) {
    l.push("", "Pendientes:");
    for (const p of s.pendientes) l.push(`  - [${p.tipo}] ${p.texto} → ${p.proximoPaso}`);
  }
  if (s.resumen === null) {
    l.push("", "Sin resumen (LLM no disponible).");
  } else {
    const bloques = [["Hice", s.resumen.hice], ["Avancé", s.resumen.avance], ["Sigue", s.resumen.sigue], ["Bloqueos", s.resumen.bloqueos]] as const;
    for (const [titulo, items] of bloques) {
      if (items.length === 0) continue;
      l.push("", `${titulo}:`);
      for (const i of items) l.push(`  - ${i}`);
    }
  }
  if (s.sugerencias.length > 0) {
    l.push("", "Sugerencias de automatización:");
    for (const g of s.sugerencias) l.push(`  - ${g.patron} (${g.ocurrencias} veces en ${g.dias} días) → ${g.propuesta.tipo}`);
  }
  l.push(
    "",
    `Costo LLM: ${s.costo.llamadas} llamadas · US$${s.costo.usd.toFixed(4)} · ${s.costo.tokens} tokens`,
    "Guardado en .rastro/state.json. Revisalo y publicalo con `rastro publish`.",
    "",
  );
  return l.join("\n");
}

export async function cmdDaily(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { desde: { type: "string" } } });
  if (values.desde !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.desde)) throw new ErrorUsuario("--desde tiene que ser una fecha AAAA-MM-DD.");
  const repo = raizDelRepo(process.cwd());
  const config = leerConfig(repo);
  const ahora = new Date();
  const { snapshot, avisos } = await generarSnapshot({
    repo,
    config,
    llm: crearLlm(config),
    ahora,
    ...(values.desde === undefined ? {} : { desde: values.desde }),
  });
  writeFileSync(rutas(repo).state, `${JSON.stringify(snapshot, null, 2)}\n`);
  for (const aviso of avisos) log("warn", "daily_degradado", { detalle: aviso });
  process.stdout.write(textoDelDia(snapshot));
  return 0;
}
```

- [ ] **Step 6: Registrar el comando**

En `src/cli.ts`, agregar dentro del objeto `comandos`, después de la línea de `hook`:

```ts
  daily: async () => (await import("./daily.ts")).cmdDaily,
```

- [ ] **Step 7: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/llm/usos.ts src/fuentes/claudeCode.ts src/gantt.ts src/daily.ts src/cli.ts test/daily.test.ts
git commit -m "feat: rastro daily con bitácora, pendientes, desvíos y resumen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `rastro plan`

**Files:**
- Create: `src/planCmd.ts`
- Modify: `src/cli.ts` (mapa `comandos`)
- Test: `test/planCmd.test.ts`

**Interfaces:**
- Consumes: `pedidoPlan`, `pedidoSugerirPlan` (Task 11); `parsearPlan`, `renderizarPlan`, `TareaARenderizar` (Task 4); `recolectarGit`, `raizDelRepo` (Task 5); `vincularPorNombre` (Task 6); `leerConfig`, `rutas`, `Config` (Task 9); `crearLlm`, `ErrorLlm`, `Llm`, `PedidoLlm` (Task 10).
- Produces: `armarPlan(o: { repo; llm; propuesta: string; hoy: Fecha }): Promise<{ archivo: string; sugerido: boolean; tareas: number }>`; `sugerirTareas(o: { repo; config; llm; ahora: Date }): Promise<{ archivo: string; nuevas: number }>`; `cmdPlan(args)`.

- [ ] **Step 1: Escribir el test que falla**

`test/planCmd.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configPorDefecto, escribirConfig } from "../src/config.ts";
import { ErrorUsuario } from "../src/errores.ts";
import { ddmm, fechaLocal, lunesDe } from "../src/fechas.ts";
import { parsearPlan } from "../src/plan.ts";
import { armarPlan, sugerirTareas } from "../src/planCmd.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepo } from "./helpers/repo.ts";

const config = configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" });
const respuestaPlan = {
  plan: {
    entregable: "Demo el viernes.",
    tareas: [
      { nombre: "Bitácora", objetivo: "Registrar el día." },
      { nombre: "Central: API", objetivo: "Recibir snapshots." },
      { nombre: "bitacora", objetivo: "Duplicada." },
    ],
  },
};

test("arma plan.md desde una propuesta, con nombres saneados y sin duplicados", async () => {
  const r = crearRepo();
  const res = await armarPlan({ repo: r.dir, llm: new FakeLlm(respuestaPlan), propuesta: "# Propuesta", hoy: "2026-10-09" });
  assert.equal(res.sugerido, false);
  const plan = parsearPlan(readFileSync(join(r.dir, ".rastro/plan.md"), "utf8"), "2026-10-09");
  assert.equal(plan?.entregable, "Demo el viernes.");
  assert.deepEqual(plan?.tareas.map((t) => t.nombre), ["Bitácora", "Central API"]);
});

test("si ya hay plan no lo pisa: escribe plan.sugerido.md", async () => {
  const r = crearRepo();
  r.escribir(".rastro/plan.md", "mi plan\n");
  const res = await armarPlan({ repo: r.dir, llm: new FakeLlm(respuestaPlan), propuesta: "# Propuesta", hoy: "2026-10-09" });
  assert.equal(res.sugerido, true);
  assert.equal(readFileSync(join(r.dir, ".rastro/plan.md"), "utf8"), "mi plan\n");
  assert.ok(existsSync(join(r.dir, ".rastro/plan.sugerido.md")));
});

test("sin LLM disponible, el plan falla con un mensaje para el usuario", async () => {
  await assert.rejects(armarPlan({ repo: crearRepo().dir, llm: new FakeLlm("falla"), propuesta: "x", hoy: "2026-10-09" }), ErrorUsuario);
});

test("--sugerir propone tareas nuevas a partir del trabajo fuera del plan", async () => {
  const r = crearRepo();
  escribirConfig(r.dir, config);
  const hoy = fechaLocal(new Date(), "America/Argentina/Buenos_Aires");
  r.escribir(".gitignore", ".rastro/\n");
  r.escribir(".rastro/plan.md", `## Plan semana ${ddmm(lunesDe(hoy))}\n- **Entregable del viernes:** Demo.\n- [x] **Bitácora:** Registrar.\n`);
  r.commit("script de deploy a staging");
  const llm = new FakeLlm({
    "sugerir-plan": {
      tareas: [
        { nombre: "Deploy", objetivo: "Automatizar el deploy a staging." },
        { nombre: "Bitácora", objetivo: "Ya existe." },
      ],
    },
  });
  const res = await sugerirTareas({ repo: r.dir, config, llm, ahora: new Date() });
  assert.equal(res.nuevas, 1);
  const sugerido = readFileSync(join(r.dir, ".rastro/plan.sugerido.md"), "utf8");
  assert.match(sugerido, /- \[x\] \*\*Bitácora:\*\*/);
  assert.match(sugerido, /- \[ \] \*\*Deploy:\*\* Automatizar el deploy a staging\./);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/planCmd.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`src/planCmd.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { leerConfig, rutas, type Config } from "./config.ts";
import { vincularPorNombre } from "./detectores/vinculo.ts";
import { ErrorUsuario } from "./errores.ts";
import { fechaLocal, lunesDe, sumarDias, type Fecha } from "./fechas.ts";
import { raizDelRepo, recolectarGit } from "./git.ts";
import { crearLlm } from "./llm/crear.ts";
import { ErrorLlm, type Llm, type PedidoLlm } from "./llm/llm.ts";
import { pedidoPlan, pedidoSugerirPlan } from "./llm/usos.ts";
import { parsearPlan, renderizarPlan, type TareaARenderizar } from "./plan.ts";
import { slugDe } from "./texto.ts";

async function conLlm<T>(llm: Llm, pedido: PedidoLlm<T>, que: string): Promise<T> {
  try {
    return await llm.completar(pedido);
  } catch (e) {
    if (e instanceof ErrorLlm) throw new ErrorUsuario(`No se pudo ${que}: el LLM no está disponible (${e.message}).`, { cause: e });
    throw e;
  }
}

/** Nombres sin ":" ni "*" (rompen el formato de daily-flock) y sin slugs repetidos. */
function tareasValidas(tareas: readonly { nombre: string; objetivo: string }[]): TareaARenderizar[] {
  const vistos = new Set<string>();
  const res: TareaARenderizar[] = [];
  for (const t of tareas) {
    const nombre = t.nombre.replace(/[:*]/g, "").replace(/\s+/g, " ").trim();
    const slug = slugDe(nombre);
    if (slug === "" || vistos.has(slug)) continue;
    vistos.add(slug);
    res.push({ nombre, objetivo: t.objetivo.trim() });
  }
  return res;
}

export async function armarPlan(o: { repo: string; llm: Llm; propuesta: string; hoy: Fecha }): Promise<{ archivo: string; sugerido: boolean; tareas: number }> {
  const r = rutas(o.repo);
  const semana = lunesDe(o.hoy);
  const res = await conLlm(o.llm, pedidoPlan(o.propuesta, semana), "armar el plan");
  const tareas = tareasValidas(res.tareas);
  if (tareas.length === 0) throw new ErrorUsuario("El LLM no devolvió tareas válidas: probá de nuevo o armá el plan a mano.");
  const sugerido = existsSync(r.plan);
  const archivo = sugerido ? r.planSugerido : r.plan;
  mkdirSync(r.dir, { recursive: true });
  writeFileSync(archivo, renderizarPlan(semana, res.entregable, tareas));
  return { archivo, sugerido, tareas: tareas.length };
}

export async function sugerirTareas(o: { repo: string; config: Config; llm: Llm; ahora: Date }): Promise<{ archivo: string; nuevas: number }> {
  const r = rutas(o.repo);
  const hoy = fechaLocal(o.ahora, o.config.zonaHoraria);
  const plan = existsSync(r.plan) ? parsearPlan(readFileSync(r.plan, "utf8"), hoy) : null;
  if (plan === null) throw new ErrorUsuario("No hay plan para esta semana: armalo primero con `rastro plan <propuesta.md>`.");
  const fuera = recolectarGit(o.repo, sumarDias(plan.semana, -1))
    .commits.filter((c) => c.padres.length < 2 && vincularPorNombre(c, plan.tareas) === null)
    .map((c) => c.asunto);
  if (fuera.length === 0) return { archivo: r.planSugerido, nuevas: 0 };
  const res = await conLlm(
    o.llm,
    pedidoSugerirPlan({ plan: plan.tareas.map((t) => ({ nombre: t.nombre, objetivo: t.objetivo })), trabajoFueraDelPlan: fuera.slice(0, 50) }),
    "sugerir tareas",
  );
  const existentes = new Set(plan.tareas.map((t) => t.slug));
  const nuevas = tareasValidas(res.tareas).filter((t) => !existentes.has(slugDe(t.nombre)));
  writeFileSync(r.planSugerido, renderizarPlan(plan.semana, plan.entregable, [...plan.tareas, ...nuevas]));
  return { archivo: r.planSugerido, nuevas: nuevas.length };
}

export async function cmdPlan(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { sugerir: { type: "boolean", default: false } } });
  const repo = raizDelRepo(process.cwd());
  const config = leerConfig(repo);
  const llm = crearLlm(config);
  if (llm === null) throw new ErrorUsuario("El plan necesita un LLM: configurá llm.proveedor en .rastro/config.json.");
  if (values.sugerir) {
    const r = await sugerirTareas({ repo, config, llm, ahora: new Date() });
    process.stdout.write(
      r.nuevas === 0 ? "No hay tareas nuevas para sugerir.\n" : `Se sugirieron ${r.nuevas} tareas en ${r.archivo}. Pasá a plan.md las que quieras.\n`,
    );
    return 0;
  }
  const propuesta = positionals[0];
  if (propuesta === undefined) throw new ErrorUsuario("Uso: rastro plan <propuesta.md> | rastro plan --sugerir");
  if (!existsSync(propuesta)) throw new ErrorUsuario(`No existe ${propuesta}.`);
  const r = await armarPlan({ repo, llm, propuesta: readFileSync(propuesta, "utf8"), hoy: fechaLocal(new Date(), config.zonaHoraria) });
  process.stdout.write(
    r.sugerido ? `Ya había un plan y no lo toqué: la propuesta quedó en ${r.archivo}.\n` : `Plan con ${r.tareas} tareas en ${r.archivo}.\n`,
  );
  return 0;
}
```

- [ ] **Step 4: Registrar el comando**

En `src/cli.ts`, agregar dentro de `comandos`, después de `daily`:

```ts
  plan: async () => (await import("./planCmd.ts")).cmdPlan,
```

- [ ] **Step 5: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/planCmd.ts src/cli.ts test/planCmd.test.ts
git commit -m "feat: rastro plan desde una propuesta y --sugerir" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Central (`rastro serve`)

**Files:**
- Create: `src/contract/equipo.ts`, `src/central/almacen.ts`, `src/central/servidor.ts`, `src/central/cmd.ts`
- Modify: `src/cli.ts` (mapa `comandos`)
- Test: `test/central.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `validarSnapshot` (Task 2); `ErrorValidacion`, `RE_SLUG`, `obj`, `arr`, `num`, `bool`, `str`, `slug` (Task 2); `log`, `ErrorUsuario` (Task 1).
- Produces (`equipo.ts`): `checkFilaEquipo`, `checkEquipo`, `type FilaEquipo`, `filaDe(s: Snapshot): FilaEquipo`.
- Produces (`almacen.ts`): `class Almacen { constructor(dir); guardar(s): void; leer(id): Snapshot | null; todos(): Snapshot[] }`.
- Produces (`servidor.ts`): `crearCentral(o: { almacen: Almacen; estaticos: string }): Server`.
- Produces (`cmd.ts`): `ESTATICOS: string` (ruta absoluta a `frontend/dist`); `cmdServe(args)`.

- [ ] **Step 1: Escribir el test que falla**

`test/central.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Almacen } from "../src/central/almacen.ts";
import { crearCentral } from "../src/central/servidor.ts";
import { checkEquipo } from "../src/contract/equipo.ts";

const ejemplo = (nombre: string): unknown => JSON.parse(readFileSync(new URL(`../frontend/ejemplos/${nombre}`, import.meta.url), "utf8"));

async function levantar(estaticos = join(tmpdir(), "rastro-sin-dist")) {
  const servidor = crearCentral({ almacen: new Almacen(mkdtempSync(join(tmpdir(), "rastro-central-"))), estaticos });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, port, cerrar: () => new Promise<void>((resolve) => servidor.close(() => resolve())) };
}

/** GET con la ruta tal cual: fetch normaliza "/../" y no sirve para probar recorridos de directorio. */
function getCrudo(port: number, ruta: string): Promise<{ estado: number; cuerpo: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: ruta, method: "GET" }, (res) => {
      let cuerpo = "";
      res.setEncoding("utf8").on("data", (d: string) => {
        cuerpo += d;
      });
      res.on("end", () => resolve({ estado: res.statusCode ?? 0, cuerpo }));
    });
    req.on("error", reject);
    req.end();
  });
}

const publicar = (url: string, cuerpo: unknown) =>
  fetch(`${url}/api/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

test("publica un snapshot válido, lo devuelve por persona y calcula la fila del equipo", async (t) => {
  const c = await levantar();
  t.after(c.cerrar);
  assert.equal((await publicar(c.url, ejemplo("persona-denis.json"))).status, 201);
  assert.deepEqual(await (await fetch(`${c.url}/api/persona/denis`)).json(), ejemplo("persona-denis.json"));
  const equipo = checkEquipo(await (await fetch(`${c.url}/api/equipo`)).json(), "equipo");
  const filaDelEjemplo = checkEquipo(ejemplo("equipo.json"), "ejemplo").equipo[0];
  assert.deepEqual(equipo.equipo, [filaDelEjemplo]);
});

test("rechaza campos no admitidos y no guarda nada", async (t) => {
  const c = await levantar();
  t.after(c.cerrar);
  const res = await publicar(c.url, { ...(ejemplo("persona-denis.json") as object), extra: true });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /snapshot\.extra/);
  assert.equal((await fetch(`${c.url}/api/persona/denis`)).status, 404);
});

test("JSON roto da 400 y un cuerpo de más de 1 MB da 413", async (t) => {
  const c = await levantar();
  t.after(c.cerrar);
  assert.equal((await fetch(`${c.url}/api/publish`, { method: "POST", body: "{no" })).status, 400);
  assert.equal((await fetch(`${c.url}/api/publish`, { method: "POST", body: "x".repeat(1_100_000) })).status, 413);
});

test("rutas hostiles nunca salen de sus directorios", async (t) => {
  const dist = mkdtempSync(join(tmpdir(), "rastro-dist-"));
  writeFileSync(join(dist, "index.html"), "<h1>ui</h1>");
  const c = await levantar(dist);
  t.after(c.cerrar);
  assert.deepEqual(await getCrudo(c.port, "/"), { estado: 200, cuerpo: "<h1>ui</h1>" });
  assert.equal((await getCrudo(c.port, "/..%2f..%2fetc%2fpasswd")).estado, 404);
  assert.ok(!(await getCrudo(c.port, "/../../etc/passwd")).cuerpo.includes("root:"));
  assert.equal((await getCrudo(c.port, "/api/persona/..%2F..%2Fetc")).estado, 404);
  assert.equal((await getCrudo(c.port, "/%E0%A4%A")).estado, 400);
});

test("sin UI construida, la raíz dice dónde está el pedido", async (t) => {
  const c = await levantar();
  t.after(c.cerrar);
  const res = await fetch(c.url);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /frontend\/README\.md/);
});

test("el ejemplo de equipo de frontend cumple el contrato", () => {
  assert.equal(checkEquipo(ejemplo("equipo.json"), "ejemplo").equipo.length, 3);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/central.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar el contrato de equipo y el almacén**

`src/contract/equipo.ts`:

```ts
import type { Snapshot } from "./snapshot.ts";
import { arr, bool, num, obj, slug, str, type Infer } from "./validar.ts";

export const checkFilaEquipo = obj({
  persona: obj({ id: slug, nombre: str, equipo: str }),
  repo: str,
  ultimoUpdate: str,
  tareasHechas: num,
  tareasTotales: num,
  pendientesAbiertos: num,
  fueraDelPlanPct: num,
  alerta: bool,
});

export const checkEquipo = obj({ equipo: arr(checkFilaEquipo) });

export type FilaEquipo = Infer<typeof checkFilaEquipo>;

/** Campos elegidos uno por uno: lo que se agregue al snapshot no aparece solo en la vista de equipo. */
export function filaDe(s: Snapshot): FilaEquipo {
  const tareas = s.plan?.tareas ?? [];
  return {
    persona: { id: s.persona.id, nombre: s.persona.nombre, equipo: s.persona.equipo },
    repo: s.repo.nombre,
    ultimoUpdate: s.generadoEn,
    tareasHechas: tareas.filter((t) => t.estado === "hecha").length,
    tareasTotales: tareas.filter((t) => t.estado !== "sacada").length,
    pendientesAbiertos: s.pendientes.length,
    fueraDelPlanPct: s.desvios.fueraDelPlanPct,
    alerta: s.desvios.alerta,
  };
}
```

`src/central/almacen.ts`:

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validarSnapshot, type Snapshot } from "../contract/snapshot.ts";
import { RE_SLUG } from "../contract/validar.ts";

/** Último snapshot de cada persona, un archivo JSON por persona. */
export class Almacen {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  guardar(s: Snapshot): void {
    // persona.id ya pasó por el contrato como slug: no puede apuntar fuera del directorio.
    const destino = join(this.#dir, `${s.persona.id}.json`);
    const temporal = `${destino}.tmp`;
    writeFileSync(temporal, JSON.stringify(s));
    renameSync(temporal, destino); // Una lectura simultánea nunca ve un archivo a medio escribir.
  }

  leer(id: string): Snapshot | null {
    if (!RE_SLUG.test(id)) return null;
    const archivo = join(this.#dir, `${id}.json`);
    return existsSync(archivo) ? validarSnapshot(JSON.parse(readFileSync(archivo, "utf8"))) : null;
  }

  todos(): Snapshot[] {
    return readdirSync(this.#dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        const s = this.leer(f.slice(0, -".json".length));
        return s === null ? [] : [s];
      });
  }
}
```

- [ ] **Step 4: Implementar el servidor y el comando**

`src/central/servidor.ts`:

```ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { filaDe } from "../contract/equipo.ts";
import { validarSnapshot, type Snapshot } from "../contract/snapshot.ts";
import { ErrorValidacion } from "../contract/validar.ts";
import { log } from "../log.ts";
import type { Almacen } from "./almacen.ts";

const LIMITE_CUERPO = 1_000_000;
const TIPOS: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Error del cliente: se responde con su estado y su mensaje, sin detalles internos. */
class ErrorPedido extends Error {
  override name = "ErrorPedido";
  readonly estado: number;

  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.estado = estado;
  }
}

type Opciones = { almacen: Almacen; estaticos: string };

export function crearCentral(o: Opciones): Server {
  return createServer((req, res) => {
    atender(req, res, o).catch((e: unknown) => {
      if (e instanceof ErrorPedido) {
        responderJson(res, e.estado, { error: e.message });
        return;
      }
      log("error", "central_fallo", { ruta: req.url ?? "", detalle: e instanceof Error ? e.message : String(e) });
      responderJson(res, 500, { error: "error interno del central" });
    });
  });
}

async function atender(req: IncomingMessage, res: ServerResponse, o: Opciones): Promise<void> {
  const ruta = new URL(req.url ?? "/", "http://central").pathname;
  if (req.method === "POST" && ruta === "/api/publish") {
    const snapshot = validarCuerpo(await leerCuerpo(req));
    o.almacen.guardar(snapshot);
    log("info", "snapshot_recibido", { persona: snapshot.persona.id, equipo: snapshot.persona.equipo });
    responderJson(res, 201, { ok: true });
    return;
  }
  if (req.method !== "GET") throw new ErrorPedido(405, "método no permitido");
  if (ruta === "/api/equipo") {
    const filas = o.almacen
      .todos()
      .map(filaDe)
      .sort((a, b) => Number(b.alerta) - Number(a.alerta) || a.persona.nombre.localeCompare(b.persona.nombre));
    responderJson(res, 200, { equipo: filas });
    return;
  }
  const persona = /^\/api\/persona\/([^/]+)$/.exec(ruta)?.[1];
  if (persona !== undefined) {
    const s = o.almacen.leer(decodificar(persona));
    if (s === null) throw new ErrorPedido(404, "persona no encontrada");
    responderJson(res, 200, s);
    return;
  }
  if (ruta.startsWith("/api/")) throw new ErrorPedido(404, "ruta no encontrada");
  servirEstatico(res, o.estaticos, decodificar(ruta));
}

function decodificar(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new ErrorPedido(400, "ruta mal codificada");
  }
}

function validarCuerpo(cuerpo: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(cuerpo);
  } catch {
    throw new ErrorPedido(400, "el cuerpo no es JSON válido");
  }
  try {
    return validarSnapshot(raw);
  } catch (e) {
    if (e instanceof ErrorValidacion) throw new ErrorPedido(400, e.message);
    throw e;
  }
}

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on("data", (parte: Buffer) => {
      total += parte.length;
      if (total <= LIMITE_CUERPO) partes.push(parte);
    });
    // Se drena el cuerpo entero antes de responder 413 para que el cliente reciba la respuesta.
    req.on("end", () =>
      total > LIMITE_CUERPO ? reject(new ErrorPedido(413, "el snapshot supera 1 MB")) : resolve(Buffer.concat(partes).toString("utf8")),
    );
    req.on("error", reject);
  });
}

function servirEstatico(res: ServerResponse, raiz: string, ruta: string): void {
  const base = resolve(raiz);
  if (!existsSync(base)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Central de Rastro: la UI todavía no está construida (el pedido está en frontend/README.md). La API está en /api/equipo.\n");
    return;
  }
  let archivo = resolve(base, `.${ruta}`);
  if (archivo !== base && !archivo.startsWith(base + sep)) throw new ErrorPedido(404, "no encontrado");
  // Las rutas sin extensión van a index.html para que la UI pueda tener su propio ruteo.
  if (archivo === base || extname(archivo) === "") archivo = join(base, "index.html");
  if (!existsSync(archivo) || !statSync(archivo).isFile()) throw new ErrorPedido(404, "no encontrado");
  res.writeHead(200, { "content-type": TIPOS[extname(archivo)] ?? "application/octet-stream" });
  res.end(readFileSync(archivo));
}

function responderJson(res: ServerResponse, estado: number, cuerpo: unknown): void {
  res.writeHead(estado, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(cuerpo));
}
```

`src/central/cmd.ts`:

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ErrorUsuario } from "../errores.ts";
import { Almacen } from "./almacen.ts";
import { crearCentral } from "./servidor.ts";

export const ESTATICOS = fileURLToPath(new URL("../../frontend/dist", import.meta.url));

export async function cmdServe(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      puerto: { type: "string", default: "4317" },
      datos: { type: "string", default: join(homedir(), ".local", "share", "rastro-central") },
    },
  });
  const puerto = Number(values.puerto);
  if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) throw new ErrorUsuario("--puerto tiene que ser un número entre 0 y 65535.");
  const servidor = crearCentral({ almacen: new Almacen(values.datos), estaticos: ESTATICOS });
  try {
    // Solo localhost: el central no tiene autenticación (ver Concerns del spec).
    await new Promise<void>((resolve, reject) => {
      servidor.once("error", reject);
      servidor.listen(puerto, "127.0.0.1", resolve);
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") throw new ErrorUsuario(`El puerto ${puerto} está ocupado: probá con --puerto.`, { cause: e });
    throw e;
  }
  process.stdout.write(`Central de Rastro en http://127.0.0.1:${puerto} (datos en ${values.datos}). Ctrl+C para salir.\n`);
  await new Promise<void>((resolve) => {
    const cerrar = (): void => {
      servidor.close(() => resolve());
    };
    process.once("SIGINT", cerrar);
    process.once("SIGTERM", cerrar);
  });
  return 0;
}
```

- [ ] **Step 5: Registrar el comando**

En `src/cli.ts`, agregar dentro de `comandos`, después de `plan`:

```ts
  serve: async () => (await import("./central/cmd.ts")).cmdServe,
```

- [ ] **Step 6: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/contract/equipo.ts src/central src/cli.ts test/central.test.ts
git commit -m "feat: central con API de equipo y persona, y UI estática" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Conectores, `rastro publish` y `rastro seed-demo`

**Files:**
- Create: `src/conectores/conector.ts`, `src/conectores/central.ts`, `src/conectores/notion.ts`, `src/conectores/crear.ts`, `src/publish.ts`, `src/central/demo.ts`, `src/central/seed.ts`
- Modify: `src/cli.ts` (mapa `comandos`)
- Test: `test/publish.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `Pendiente`, `Tarea`, `validarSnapshot` (Task 2); `ddmm`, `fechaLocal`, `lunesDe`, `sumarDias` (Task 3); `slugDe` (Task 3); `Config`, `leerConfig`, `rutas` (Task 9); `raizDelRepo` (Task 5); `Almacen`, `crearCentral` (Task 13).
- Produces (`conector.ts`): `interface Conector { readonly nombre: string; publicar(s: Snapshot): Promise<string> }`.
- Produces (`central.ts`): `class ConectorCentral implements Conector` con `constructor(url: string)`.
- Produces (`notion.ts`): `entradasDailyFlock(s: Snapshot): string`; `class ConectorNotionMock implements Conector` con `constructor(archivo: string)`.
- Produces (`crear.ts`): `crearConectores(config: Config, repo: string): Conector[]`.
- Produces (`publish.ts`): `paraCompartir(s, config): Snapshot`; `vistaPrevia(s, destinos): string`; `type ResultadoConector = { conector: string; ok: boolean; detalle: string }`; `publicar(s, conectores): Promise<ResultadoConector[]>`; `publicarConConfirmacion(o): Promise<ResultadoConector[] | null>`; `cmdPublish(args)`.
- Produces (`demo.ts`): `snapshotsDemo(hoy: Fecha, ahora: Date): Snapshot[]`. (`seed.ts`): `cmdSeedDemo(args)`.

- [ ] **Step 1: Escribir el test que falla**

`test/publish.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Almacen } from "../src/central/almacen.ts";
import { snapshotsDemo } from "../src/central/demo.ts";
import { crearCentral } from "../src/central/servidor.ts";
import { configPorDefecto } from "../src/config.ts";
import { ConectorCentral } from "../src/conectores/central.ts";
import type { Conector } from "../src/conectores/conector.ts";
import { ConectorNotionMock } from "../src/conectores/notion.ts";
import { validarSnapshot, type Snapshot } from "../src/contract/snapshot.ts";
import { paraCompartir, publicar, publicarConConfirmacion } from "../src/publish.ts";

const snapshot = (): Snapshot =>
  validarSnapshot(JSON.parse(readFileSync(new URL("../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8")));
const config = configPorDefecto({ id: "denis", nombre: "Denis", equipo: "AI Day" });

class ConectorFalso implements Conector {
  readonly nombre: string;
  readonly recibidos: Snapshot[] = [];
  readonly #falla: boolean;

  constructor(nombre: string, falla = false) {
    this.nombre = nombre;
    this.#falla = falla;
  }

  async publicar(s: Snapshot): Promise<string> {
    if (this.#falla) throw new Error("caído");
    this.recibidos.push(s);
    return "ok";
  }
}

const sinSalida = (): void => {
  // La vista previa no interesa en este test.
};

test("si la respuesta no es sí, no se envía nada", async () => {
  const c = new ConectorFalso("central");
  const r = await publicarConConfirmacion({ snapshot: snapshot(), config, conectores: [c], yes: false, preguntar: async () => "n", mostrar: sinSalida });
  assert.equal(r, null);
  assert.equal(c.recibidos.length, 0);
});

test("con --yes publica sin preguntar y la vista previa dice adónde va", async () => {
  const c = new ConectorFalso("central");
  let mostrado = "";
  await publicarConConfirmacion({
    snapshot: snapshot(),
    config,
    conectores: [c],
    yes: true,
    preguntar: async () => {
      throw new Error("no debería preguntar");
    },
    mostrar: (t) => {
      mostrado += t;
    },
  });
  assert.equal(c.recibidos.length, 1);
  assert.match(mostrado, /Se va a publicar en: central/);
});

test("las sugerencias no se comparten salvo que la config lo habilite", () => {
  const s = snapshot();
  assert.deepEqual(paraCompartir(s, config).sugerencias, []);
  assert.equal(s.sugerencias.length, 2);
  assert.equal(paraCompartir(s, { ...config, compartir: { sugerencias: true } }).sugerencias.length, 2);
});

test("un conector caído no frena a los demás y se informa", async () => {
  const bien = new ConectorFalso("central");
  const r = await publicar(snapshot(), [new ConectorFalso("notion", true), bien]);
  assert.deepEqual(r.map((x) => [x.conector, x.ok]), [["notion", false], ["central", true]]);
  assert.equal(bien.recibidos.length, 1);
});

test("el conector central publica de verdad, con los compañeros demo, y avisa si el central no responde", async (t) => {
  const servidor = crearCentral({ almacen: new Almacen(mkdtempSync(join(tmpdir(), "rastro-central-"))), estaticos: join(tmpdir(), "rastro-sin-dist") });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => servidor.close(() => resolve())));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  await new ConectorCentral(url).publicar(snapshot());
  for (const s of snapshotsDemo("2026-10-09", new Date("2026-10-09T21:00:00Z"))) await new ConectorCentral(url).publicar(s);
  const equipo = (await (await fetch(`${url}/api/equipo`)).json()) as { equipo: unknown[] };
  assert.equal(equipo.equipo.length, 4);
  await assert.rejects(new ConectorCentral("http://127.0.0.1:9").publicar(snapshot()), /no se pudo conectar/);
});

test("los datos demo cumplen el contrato y son tres personas distintas", () => {
  const demo = snapshotsDemo("2026-10-09", new Date("2026-10-09T21:00:00Z"));
  assert.equal(new Set(demo.map((s) => s.persona.id)).size, 3);
});

test("el conector de Notion en modo mock deja la vista previa con el formato de daily-flock", async () => {
  const archivo = join(mkdtempSync(join(tmpdir(), "rastro-notion-")), "preview.md");
  await new ConectorNotionMock(archivo).publicar(snapshot());
  const md = readFileSync(archivo, "utf8");
  assert.match(md, /^### 09\/10$/m);
  assert.match(md, /^- 17\.52hs \*\*Pendientes:\*\* Se incorporó la detección/m);
  assert.match(md, /^- 14\.35hs \*\*main:\*\* Se ajustó/m);
  assert.ok(md.indexOf("11.20hs") < md.indexOf("17.52hs"));
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/publish.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar los conectores**

`src/conectores/conector.ts`:

```ts
import type { Snapshot } from "../contract/snapshot.ts";

export interface Conector {
  readonly nombre: string;
  /** Publica el snapshot. Devuelve qué hizo; si falla, lanza. */
  publicar(s: Snapshot): Promise<string>;
}
```

`src/conectores/central.ts`:

```ts
import type { Snapshot } from "../contract/snapshot.ts";
import type { Conector } from "./conector.ts";

export class ConectorCentral implements Conector {
  readonly nombre = "central";
  readonly #url: string;

  constructor(url: string) {
    this.#url = url.replace(/\/+$/, "");
  }

  async publicar(s: Snapshot): Promise<string> {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.#url}/api/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
      });
    } catch (e) {
      throw new Error(`no se pudo conectar con el central en ${this.#url}`, { cause: e });
    }
    if (respuesta.status !== 201) throw new Error(`el central respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 200)}`);
    return `publicado en ${this.#url}`;
  }
}
```

`src/conectores/notion.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Snapshot } from "../contract/snapshot.ts";
import { ddmm } from "../fechas.ts";
import type { Conector } from "./conector.ts";

/** Formato de la página Daily de daily-flock: "### DD/MM" y "- HH.MMhs **Tarea:** texto", en orden de hora. */
export function entradasDailyFlock(s: Snapshot): string {
  const nombreDe = (slug: string | null, rama: string): string => s.plan?.tareas.find((t) => t.slug === slug)?.nombre ?? rama;
  const porDia = new Map<string, string[]>();
  const enOrden = [...s.bitacora].sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
  for (const e of enOrden) {
    porDia.set(e.fecha, [...(porDia.get(e.fecha) ?? []), `- ${e.hora.replace(":", ".")}hs **${nombreDe(e.tarea, e.rama)}:** ${e.texto}`]);
  }
  const bloques = [...porDia.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([fecha, lineas]) => [`### ${ddmm(fecha)}`, ...lineas].join("\n"));
  return `${bloques.join("\n\n")}\n`;
}

export class ConectorNotionMock implements Conector {
  readonly nombre = "notion";
  readonly #archivo: string;

  constructor(archivo: string) {
    this.#archivo = archivo;
  }

  async publicar(s: Snapshot): Promise<string> {
    mkdirSync(dirname(this.#archivo), { recursive: true });
    writeFileSync(this.#archivo, entradasDailyFlock(s));
    return `vista previa en ${this.#archivo} (modo mock)`;
  }
}
```

`src/conectores/crear.ts`:

```ts
import { rutas, type Config } from "../config.ts";
import { ConectorCentral } from "./central.ts";
import type { Conector } from "./conector.ts";
import { ConectorNotionMock } from "./notion.ts";

export function crearConectores(config: Config, repo: string): Conector[] {
  return config.conectores.map(
    (nombre): Conector => (nombre === "central" ? new ConectorCentral(config.central.url) : new ConectorNotionMock(rutas(repo).notionPreview)),
  );
}
```

- [ ] **Step 4: Implementar publish**

`src/publish.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { leerConfig, rutas, type Config } from "./config.ts";
import type { Conector } from "./conectores/conector.ts";
import { crearConectores } from "./conectores/crear.ts";
import { validarSnapshot, type Snapshot } from "./contract/snapshot.ts";
import { ErrorValidacion } from "./contract/validar.ts";
import { ErrorUsuario } from "./errores.ts";
import { raizDelRepo } from "./git.ts";

/** REQ-12: las sugerencias salen de la terminal de cada persona; por defecto no se comparten. */
export function paraCompartir(s: Snapshot, config: Config): Snapshot {
  return config.compartir.sugerencias ? s : { ...s, sugerencias: [] };
}

export function vistaPrevia(s: Snapshot, destinos: readonly string[]): string {
  return [
    `Se va a publicar en: ${destinos.join(", ")}`,
    `- Persona: ${s.persona.nombre} (${s.persona.equipo}) · repo ${s.repo.nombre}`,
    `- Bitácora: ${s.bitacora.length} entradas · Pendientes: ${s.pendientes.length} · Plan: ${s.plan === null ? "sin plan" : `${s.plan.tareas.length} tareas`}`,
    `- Resumen: ${s.resumen === null ? "no" : "sí"} · Sugerencias: ${s.sugerencias.length}`,
    "",
  ].join("\n");
}

export type ResultadoConector = { conector: string; ok: boolean; detalle: string };

export async function publicar(s: Snapshot, conectores: readonly Conector[]): Promise<ResultadoConector[]> {
  const resultados: ResultadoConector[] = [];
  for (const c of conectores) {
    try {
      resultados.push({ conector: c.nombre, ok: true, detalle: await c.publicar(s) });
    } catch (e) {
      // Cada conector es independiente: la falla se informa en su resultado y se sigue con el próximo.
      resultados.push({ conector: c.nombre, ok: false, detalle: e instanceof Error ? e.message : String(e) });
    }
  }
  return resultados;
}

export async function publicarConConfirmacion(o: {
  snapshot: Snapshot;
  config: Config;
  conectores: readonly Conector[];
  yes: boolean;
  preguntar: (texto: string) => Promise<string>;
  mostrar: (texto: string) => void;
}): Promise<ResultadoConector[] | null> {
  const s = paraCompartir(o.snapshot, o.config);
  o.mostrar(vistaPrevia(s, o.conectores.map((c) => c.nombre)));
  if (!o.yes) {
    const respuesta = (await o.preguntar("¿Publicar? [s/N] ")).trim().toLowerCase();
    if (!["s", "si", "sí", "y", "yes"].includes(respuesta)) return null;
  }
  return publicar(s, o.conectores);
}

function preguntarEnTerminal(texto: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.once("close", () => resolve("")); // stdin cerrado sin respuesta cuenta como "no"
    rl.question(texto, (respuesta) => {
      resolve(respuesta);
      rl.close();
    });
  });
}

export async function cmdPublish(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { yes: { type: "boolean", default: false } } });
  const repo = raizDelRepo(process.cwd());
  const config = leerConfig(repo);
  const archivo = rutas(repo).state;
  if (!existsSync(archivo)) throw new ErrorUsuario("No hay .rastro/state.json: corré `rastro daily` primero.");
  let snapshot: Snapshot;
  try {
    snapshot = validarSnapshot(JSON.parse(readFileSync(archivo, "utf8")));
  } catch (e) {
    if (e instanceof ErrorValidacion || e instanceof SyntaxError) {
      throw new ErrorUsuario(`.rastro/state.json no cumple el contrato (${e.message}): volvé a correr \`rastro daily\`.`, { cause: e });
    }
    throw e;
  }
  const resultados = await publicarConConfirmacion({
    snapshot,
    config,
    conectores: crearConectores(config, repo),
    yes: values.yes,
    preguntar: preguntarEnTerminal,
    mostrar: (t) => process.stdout.write(t),
  });
  if (resultados === null) {
    process.stdout.write("No se publicó nada.\n");
    return 0;
  }
  for (const r of resultados) process.stdout.write(`${r.ok ? "✓" : "✗"} ${r.conector}: ${r.detalle}\n`);
  return resultados.every((r) => r.ok) ? 0 : 1;
}
```

- [ ] **Step 5: Implementar los compañeros demo y seed-demo**

`src/central/demo.ts`:

```ts
import { createHash } from "node:crypto";
import { validarSnapshot, type Pendiente, type Resumen, type Snapshot, type Tarea } from "../contract/snapshot.ts";
import { lunesDe, sumarDias, type Fecha } from "../fechas.ts";
import { slugDe } from "../texto.ts";

type DatosDemo = {
  id: string;
  nombre: string;
  repo: string;
  entregable: string;
  tareas: [string, string, Tarea["estado"]][];
  /** [hora, tarea o null, rama, texto] */
  bitacora: [string, string | null, string, string][];
  pendientes: Pendiente[];
  fueraDelPlanPct: number;
  sinActividad: string[];
  resumen: Resumen | null;
};

const shaFalso = (semilla: string): string => createHash("sha1").update(semilla).digest("hex").slice(0, 7);

function armar(hoy: Fecha, ahora: Date, d: DatosDemo): Snapshot {
  const lunes = lunesDe(hoy);
  const tareas = d.tareas.map(([nombre, objetivo, estado]) => ({ slug: slugDe(nombre), nombre, objetivo, estado }));
  const sinActividad = d.sinActividad.map(slugDe);
  return validarSnapshot({
    schemaVersion: 1,
    generadoEn: ahora.toISOString(),
    persona: { id: d.id, nombre: d.nombre, equipo: "AI Day" },
    repo: { nombre: d.repo },
    periodo: { desde: hoy, hasta: hoy },
    plan: { semana: lunes, entregable: d.entregable, tareas },
    bitacora: d.bitacora.map(([hora, tarea, rama, texto], i) => ({
      fecha: hoy,
      hora,
      tarea: tarea === null ? null : slugDe(tarea),
      rama,
      texto,
      vinculo: tarea === null ? "sin-tarea" : "nombre",
      evidencia: [{ tipo: "commit", ref: shaFalso(`${d.id}-${i}`) }, { tipo: "rama", ref: rama }],
    })),
    pendientes: d.pendientes,
    desvios: { fueraDelPlanPct: d.fueraDelPlanPct, alerta: d.fueraDelPlanPct > 50, tareasSinActividad: sinActividad },
    resumen: d.resumen,
    sugerencias: [],
    gantt: {
      mock: true,
      barras: tareas
        .filter((t) => t.estado !== "sacada")
        .map((t) => ({ tarea: t.slug, plan: { desde: lunes, hasta: sumarDias(lunes, 4) }, real: sinActividad.includes(t.slug) ? null : { desde: lunes, hasta: hoy } })),
    },
    costo: { llamadas: 3, usd: 0.0021, tokens: 9800 },
  });
}

/** Tres compañeros ficticios para la vista de equipo de la demo (REQ-17). */
export function snapshotsDemo(hoy: Fecha, ahora: Date): Snapshot[] {
  return [
    armar(hoy, ahora, {
      id: "lucia",
      nombre: "Lucía Gómez",
      repo: "portal-clientes",
      entregable: "Login con SSO funcionando en staging.",
      tareas: [
        ["SSO", "Integrar el login con el proveedor SSO.", "hecha"],
        ["Perfil", "Permitir editar los datos del perfil.", "pendiente"],
        ["Auditoría", "Registrar los accesos en el log de auditoría.", "pendiente"],
      ],
      bitacora: [
        ["10:15", "SSO", "feat/sso", "Se integró el login con el proveedor SSO en staging."],
        ["15:40", "Perfil", "feat/perfil", "Se agregó la edición de email y teléfono en el perfil."],
      ],
      pendientes: [
        {
          tipo: "resuelto-sin-cerrar",
          tarea: "perfil",
          texto: "Perfil está resuelta en el código (se mergeó feat/perfil), pero sigue abierta en el plan.",
          evidencia: [{ tipo: "rama", ref: "feat/perfil" }],
          proximoPaso: "Tildar Perfil en el plan.",
        },
      ],
      fueraDelPlanPct: 0,
      sinActividad: ["Auditoría"],
      resumen: {
        hice: ["Se integró el login con SSO en staging."],
        avance: ["Se agregó la edición del perfil."],
        sigue: ["Tildar Perfil en el plan.", "Auditoría no tuvo actividad esta semana."],
        bloqueos: [],
      },
    }),
    armar(hoy, ahora, {
      id: "tomas",
      nombre: "Tomás Ríos",
      repo: "pipeline-datos",
      entregable: "Carga diaria de ventas automatizada.",
      tareas: [
        ["Ingesta", "Leer los archivos de ventas del bucket.", "pendiente"],
        ["Validación", "Rechazar filas con montos inválidos.", "pendiente"],
        ["Alertas", "Avisar por Slack si la carga falla.", "pendiente"],
      ],
      bitacora: [
        ["09:30", null, "main", "Se ajustó la configuración del cluster de pruebas."],
        ["11:05", null, "hotfix/timeout", "Se aumentó el timeout de la conexión a la base."],
        ["14:20", "Ingesta", "feat/ingesta", "Se leyó el primer lote de archivos del bucket."],
      ],
      pendientes: [
        {
          tipo: "rama-quieta",
          tarea: "validacion",
          texto: "La rama feat/validacion no tiene commits hace 6 días y no está mergeada.",
          evidencia: [{ tipo: "rama", ref: "feat/validacion" }],
          proximoPaso: "Mergear, retomar o borrar feat/validacion.",
        },
        {
          tipo: "todo-nuevo",
          tarea: null,
          texto: 'Se agregó un TODO/FIXME: "// TODO: reintentos".',
          evidencia: [{ tipo: "commit", ref: shaFalso("tomas-todo") }],
          proximoPaso: "Resolverlo o sumarlo como tarea al plan.",
        },
      ],
      fueraDelPlanPct: 67,
      sinActividad: ["Alertas"],
      resumen: {
        hice: [],
        avance: ["Se leyó el primer lote de archivos del bucket."],
        sigue: ["Retomar feat/validacion.", "Alertas no tuvo actividad esta semana."],
        bloqueos: ["Bloqueado por falta de credenciales del bucket de producción."],
      },
    }),
    armar(hoy, ahora, {
      id: "sofia",
      nombre: "Sofía Paz",
      repo: "app-mobile",
      entregable: "Pantalla de pagos lista para QA.",
      tareas: [
        ["Pagos", "Armar la pantalla de pagos.", "pendiente"],
        ["Tests e2e", "Cubrir el flujo de compra.", "hecha"],
      ],
      bitacora: [["12:00", "Pagos", "feat/pagos", "Se armó el formulario de tarjeta con validaciones."]],
      pendientes: [
        {
          tipo: "cerrado-sin-evidencia",
          tarea: "tests-e2e",
          texto: "Tests e2e figura como hecha, pero no hay commits vinculados esta semana.",
          evidencia: [],
          proximoPaso: "Vincular la evidencia (un commit con [Tests e2e]) o revisar si está hecha.",
        },
      ],
      fueraDelPlanPct: 0,
      sinActividad: [],
      resumen: null,
    }),
  ];
}
```

`src/central/seed.ts`:

```ts
import { parseArgs } from "node:util";
import { ConectorCentral } from "../conectores/central.ts";
import { fechaLocal } from "../fechas.ts";
import { snapshotsDemo } from "./demo.ts";

const ZONA_DEMO = "America/Argentina/Buenos_Aires";

export async function cmdSeedDemo(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { central: { type: "string", default: "http://127.0.0.1:4317" } } });
  const ahora = new Date();
  const conector = new ConectorCentral(values.central);
  for (const s of snapshotsDemo(fechaLocal(ahora, ZONA_DEMO), ahora)) process.stdout.write(`✓ ${s.persona.nombre}: ${await conector.publicar(s)}\n`);
  return 0;
}
```

- [ ] **Step 6: Registrar los comandos**

En `src/cli.ts`, agregar dentro de `comandos`, después de `serve`:

```ts
  publish: async () => (await import("./publish.ts")).cmdPublish,
  "seed-demo": async () => (await import("./central/seed.ts")).cmdSeedDemo,
```

- [ ] **Step 7: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/conectores src/publish.ts src/central/demo.ts src/central/seed.ts src/cli.ts test/publish.test.ts
git commit -m "feat: conectores, publish con confirmación y compañeros demo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Repeticiones y sugerencias de automatización

**Files:**
- Create: `src/fuentes/zsh.ts`, `src/detectores/repeticiones.ts`
- Modify: `src/fuentes/claudeCode.ts` (agregar prompts y listado de transcripts), `src/daily.ts` (fuentes, sugerencias y lectura en `cmdDaily`)
- Test: `test/repeticiones.test.ts`

**Interfaces:**
- Consumes: `fechaLocal`, `Fecha` (Task 3); `normalizar` (Task 3); `redactar` (Task 3); `pedidoSugerencias` (Task 11); `generarSnapshot` (Task 11); `expandirHome`, `Config` (Task 9).
- Produces (`zsh.ts`): `type Comando = { en: Date; texto: string }`; `desmetaficar(b: Buffer): Buffer`; `parsearHistorialZsh(contenido: Buffer): { comandos: Comando[]; descartadas: number }`.
- Produces (`claudeCode.ts`): `type PromptUsuario = { en: Date; texto: string; sesion: string }`; `promptsDeTranscript(contenido: string): { prompts: PromptUsuario[]; descartadas: number }`; `transcriptsRecientes(dir: string, desde: Date): string[]`.
- Produces (`repeticiones.ts`): `type Umbrales = { veces: number; dias: number; ventanaMin: number }`; `type Patron = { fuente: "zsh" | "claude-code"; patron: string; ocurrencias: number; dias: number }`; `normalizarComando(c): string | null`; `patronesDeComandos(cmds, u, zona): Patron[]`; `patronesDePrompts(prompts, u, zona): Patron[]`.
- Produces (`daily.ts`): `ContextoDaily` suma `fuentes?: { comandos: readonly Comando[]; prompts: readonly PromptUsuario[] }`.

- [ ] **Step 1: Escribir el test que falla**

`test/repeticiones.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { configPorDefecto, escribirConfig } from "../src/config.ts";
import { generarSnapshot } from "../src/daily.ts";
import { normalizarComando, patronesDeComandos, patronesDePrompts } from "../src/detectores/repeticiones.ts";
import { promptsDeTranscript } from "../src/fuentes/claudeCode.ts";
import { parsearHistorialZsh } from "../src/fuentes/zsh.ts";
import { FakeLlm } from "./helpers/fakeLlm.ts";
import { crearRepo } from "./helpers/repo.ts";

const ZONA = "America/Argentina/Buenos_Aires";
const u = { veces: 3, dias: 2, ventanaMin: 10 };
const config = configPorDefecto({ id: "test", nombre: "Test", equipo: "QA" });

test("normaliza rutas, hashes y números, y descarta comandos triviales", () => {
  assert.equal(normalizarComando("git rebase origin/main"), "git rebase <ruta>");
  assert.equal(normalizarComando("git show 3f9c2ab7"), "git show <hash>");
  assert.equal(normalizarComando("kill 4312"), "kill <n>");
  assert.equal(normalizarComando("ls -la"), null);
  assert.equal(normalizarComando("git status -s"), null);
});

test("la misma secuencia 3 veces en 2 días es un patrón, y sus partes no se repiten", () => {
  const secuencia = (dia: string, hora: string) => [
    { en: new Date(`${dia}T${hora}:00-03:00`), texto: "git fetch origin" },
    { en: new Date(`${dia}T${hora}:30-03:00`), texto: "git rebase origin/main" },
    { en: new Date(`${dia}T${hora}:59-03:00`), texto: "npm test" },
  ];
  const comandos = [...secuencia("2026-10-07", "10:00"), ...secuencia("2026-10-08", "15:00"), ...secuencia("2026-10-08", "18:00")];
  assert.deepEqual(patronesDeComandos(comandos, u, ZONA), [
    { fuente: "zsh", patron: "git fetch origin → git rebase <ruta> → npm test", ocurrencias: 3, dias: 2 },
  ]);
});

test("comandos separados por más de la ventana no forman una secuencia", () => {
  const comandos = ["2026-10-07", "2026-10-08", "2026-10-09"].flatMap((d) => [
    { en: new Date(`${d}T10:00:00-03:00`), texto: "docker compose up -d" },
    { en: new Date(`${d}T10:30:00-03:00`), texto: "npm run seed" },
  ]);
  const patrones = patronesDeComandos(comandos, u, ZONA);
  assert.ok(!patrones.some((p) => p.patron.includes("→")));
  assert.ok(patrones.some((p) => p.patron === "docker compose up -d"));
});

test("prompts parecidos de Claude Code se agrupan; las confirmaciones cortas no cuentan", () => {
  const p = (iso: string, texto: string) => ({ en: new Date(iso), texto, sesion: "s" });
  const prompts = [
    p("2026-10-06T10:00:00-03:00", "armá el update de la daily con lo que hice hoy"),
    p("2026-10-07T10:00:00-03:00", "Armá el update de la daily con lo que hice hoy!"),
    p("2026-10-08T10:00:00-03:00", "armá el update de la daily con lo que hice hoy por favor"),
    ...["dale", "dale", "dale", "sí, acepto"].map((t, i) => p(`2026-10-0${6 + i}T11:00:00-03:00`, t)),
  ];
  const patrones = patronesDePrompts(prompts, u, ZONA);
  assert.equal(patrones.length, 1);
  assert.equal(patrones[0]?.ocurrencias, 3);
  assert.equal(patrones[0]?.dias, 3);
});

test("historial de zsh: timestamps, comandos multilínea, bytes metaficados y líneas sin fecha", () => {
  const contenido = Buffer.concat([
    Buffer.from(": 1760000000:0;git status\n: 1760000060:0;echo uno \\\ndos\nsin fecha vieja\n: 1760000120:0;echo m"),
    Buffer.from([0xc3, 0x83, 0x81]), // "á" metaficada por zsh: 0x83 seguido de 0xA1 ^ 0x20
    Buffer.from("s\n"),
  ]);
  const { comandos, descartadas } = parsearHistorialZsh(contenido);
  assert.deepEqual(comandos.map((c) => c.texto), ["git status", "echo uno \ndos", "echo más"]);
  assert.equal(comandos[0]?.en.getTime(), 1760000000 * 1000);
  assert.equal(descartadas, 1);
});

test("del transcript solo cuentan los prompts del usuario; lo ilegible se cuenta", () => {
  const lineas = [
    JSON.stringify({ type: "user", message: { role: "user", content: "armá el plan de la semana" }, timestamp: "2026-10-09T13:00:00.000Z", sessionId: "s1", isSidechain: false }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "x" }] }, timestamp: "2026-10-09T13:01:00.000Z", sessionId: "s1" }),
    JSON.stringify({ type: "user", message: { role: "user", content: "<command-name>/effort</command-name>" }, timestamp: "2026-10-09T13:02:00.000Z", sessionId: "s1" }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: "hola" }, timestamp: "2026-10-09T13:03:00.000Z", sessionId: "s1" }),
    '{"type":"user", cortado',
  ];
  const { prompts, descartadas } = promptsDeTranscript(lineas.join("\n"));
  assert.deepEqual(prompts.map((p) => p.texto), ["armá el plan de la semana"]);
  assert.equal(descartadas, 1);
});

test("daily suma las sugerencias con su propuesta y nunca deja pasar un secreto", async () => {
  const r = crearRepo();
  escribirConfig(r.dir, config);
  r.escribir(".gitignore", ".rastro/\n");
  r.commit("inicio");
  const token = `ghp_${"c".repeat(36)}`;
  const comandos = ["2026-10-07", "2026-10-08", "2026-10-08"].map((d, i) => ({
    en: new Date(`${d}T1${i}:00:00-03:00`),
    texto: `deploy --token=${token} --env staging`,
  }));
  const llm = new FakeLlm({
    bitacora: { entradas: [], resumen: { hice: [], avance: [], sigue: [], bloqueos: [] } },
    sugerencias: { propuestas: [{ id: "0", tipo: "alias", contenido: "alias deploy-staging='deploy --env staging'", porque: "Se repitió 3 veces en 2 días." }] },
  });
  const { snapshot } = await generarSnapshot({ repo: r.dir, config, llm, ahora: new Date(), fuentes: { comandos, prompts: [] } });
  assert.equal(snapshot.sugerencias.length, 1);
  assert.equal(snapshot.sugerencias[0]?.propuesta.tipo, "alias");
  assert.ok(!snapshot.sugerencias[0]?.patron.includes(token));
  assert.ok(llm.prompts.every((p) => !p.includes(token)));
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/repeticiones.test.ts`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar las fuentes**

`src/fuentes/zsh.ts`:

```ts
export type Comando = { en: Date; texto: string };

const META = 0x83;
const RE_LINEA = /^: (\d+):\d+;(.*)$/;

/** zsh guarda algunos bytes no ASCII "metaficados": 0x83 seguido del byte original XOR 0x20. */
export function desmetaficar(b: Buffer): Buffer {
  const salida = Buffer.alloc(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    const byte = b[i] ?? 0;
    if (byte === META && i + 1 < b.length) {
      i++;
      salida[j++] = (b[i] ?? 0) ^ 0x20;
    } else {
      salida[j++] = byte;
    }
  }
  return salida.subarray(0, j);
}

/** Formato EXTENDED_HISTORY (": <epoch>:<duración>;<comando>"). Las líneas sin fecha se descartan y se cuentan. */
export function parsearHistorialZsh(contenido: Buffer): { comandos: Comando[]; descartadas: number } {
  const comandos: Comando[] = [];
  let descartadas = 0;
  let actual: Comando | null = null;
  for (const linea of desmetaficar(contenido).toString("utf8").split("\n")) {
    if (actual !== null && actual.texto.endsWith("\\")) {
      actual.texto = `${actual.texto.slice(0, -1)}\n${linea}`;
      continue;
    }
    const m = RE_LINEA.exec(linea);
    if (m !== null && m[1] !== undefined) {
      actual = { en: new Date(Number(m[1]) * 1000), texto: m[2] ?? "" };
      comandos.push(actual);
    } else if (linea.trim() !== "") {
      descartadas++;
      actual = null;
    }
  }
  return { comandos, descartadas };
}
```

En `src/fuentes/claudeCode.ts`, reemplazar la primera línea:

```ts
import { existsSync, readFileSync } from "node:fs";
```

por:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type PromptUsuario = { en: Date; texto: string; sesion: string };

/** Prompts escritos por la persona. Se excluyen tool results, comandos y avisos (empiezan con "<") y subagentes. */
export function promptsDeTranscript(contenido: string): { prompts: PromptUsuario[]; descartadas: number } {
  const prompts: PromptUsuario[] = [];
  let descartadas = 0;
  for (const linea of contenido.split("\n")) {
    if (linea.trim() === "") continue;
    let o: unknown;
    try {
      o = JSON.parse(linea);
    } catch {
      descartadas++; // Línea cortada (sesión abierta escribiendo): se cuenta y se sigue.
      continue;
    }
    const p = promptDe(o);
    if (p !== null) prompts.push(p);
  }
  return { prompts, descartadas };
}

function promptDe(o: unknown): PromptUsuario | null {
  if (typeof o !== "object" || o === null) return null;
  const r = o as Record<string, unknown>;
  const mensaje = r["message"];
  if (r["type"] !== "user" || r["isSidechain"] === true || r["isMeta"] === true || typeof mensaje !== "object" || mensaje === null) return null;
  const texto = (mensaje as Record<string, unknown>)["content"];
  const ts = r["timestamp"];
  const sesion = r["sessionId"];
  if (typeof texto !== "string" || texto.trimStart().startsWith("<") || typeof ts !== "string" || typeof sesion !== "string") return null;
  const en = new Date(ts);
  return Number.isNaN(en.getTime()) ? null : { en, texto, sesion };
}

/** Transcripts (`<dir>/<proyecto>/<sesion>.jsonl`) modificados desde `desde`. */
export function transcriptsRecientes(dir: string, desde: Date): string[] {
  if (!existsSync(dir)) return [];
  const res: string[] = [];
  for (const proyecto of readdirSync(dir, { withFileTypes: true })) {
    if (!proyecto.isDirectory()) continue;
    for (const f of readdirSync(join(dir, proyecto.name), { withFileTypes: true })) {
      const ruta = join(dir, proyecto.name, f.name);
      if (f.isFile() && f.name.endsWith(".jsonl") && statSync(ruta).mtime >= desde) res.push(ruta);
    }
  }
  return res;
}
```

- [ ] **Step 4: Implementar el detector**

`src/detectores/repeticiones.ts`:

```ts
import { fechaLocal, type Fecha } from "../fechas.ts";
import type { PromptUsuario } from "../fuentes/claudeCode.ts";
import type { Comando } from "../fuentes/zsh.ts";
import { normalizar } from "../texto.ts";

export type Umbrales = { veces: number; dias: number; ventanaMin: number };
export type Patron = { fuente: "zsh" | "claude-code"; patron: string; ocurrencias: number; dias: number };

const TRIVIALES = new Set(["ls", "ll", "la", "l", "cd", "pwd", "clear", "exit", "history", "git status", "git diff", "git log"]);
const MAX_SECUENCIA = 4;
const MAX_PATRONES = 5;

function normalizarToken(t: string): string {
  if (/^https?:\/\//.test(t)) return "<url>";
  if (/^[0-9a-f]{7,40}$/.test(t)) return "<hash>";
  if (/^\d+$/.test(t)) return "<n>";
  if (t.includes("/") || t.startsWith("~")) return "<ruta>";
  return t;
}

export function normalizarComando(comando: string): string | null {
  const tokens = comando.trim().split(/\s+/).filter((t) => t !== "").map(normalizarToken);
  const texto = tokens.join(" ");
  if (texto === "" || TRIVIALES.has(tokens[0] ?? "") || TRIVIALES.has(tokens.slice(0, 2).join(" "))) return null;
  return texto;
}

export function patronesDeComandos(comandos: readonly Comando[], u: Umbrales, zona: string): Patron[] {
  const normalizados = comandos
    .map((c) => ({ en: c.en, t: normalizarComando(c.texto) }))
    .filter((c): c is { en: Date; t: string } => c.t !== null)
    .sort((a, b) => a.en.getTime() - b.en.getTime());
  // Una "sesión" de terminal se corta cuando pasan más de ventanaMin minutos entre comandos.
  const sesiones: { en: Date; t: string }[][] = [];
  for (const c of normalizados) {
    const actual = sesiones.at(-1);
    const previo = actual?.at(-1);
    if (actual !== undefined && previo !== undefined && c.en.getTime() - previo.en.getTime() <= u.ventanaMin * 60_000) actual.push(c);
    else sesiones.push([c]);
  }
  const conteo = new Map<string, { ocurrencias: number; dias: Set<Fecha>; largo: number }>();
  for (const s of sesiones) {
    for (let n = 1; n <= MAX_SECUENCIA; n++) {
      for (let i = 0; i + n <= s.length; i++) {
        const ventana = s.slice(i, i + n);
        const primero = ventana[0];
        if (primero === undefined) continue;
        // Un comando suelto solo vale la pena si es largo; "a → a" no es una secuencia.
        if (n === 1 && primero.t.split(" ").length < 3) continue;
        if (new Set(ventana.map((v) => v.t)).size < n) continue;
        const clave = ventana.map((v) => v.t).join(" → ");
        const e = conteo.get(clave) ?? { ocurrencias: 0, dias: new Set<Fecha>(), largo: n };
        e.ocurrencias++;
        e.dias.add(fechaLocal(primero.en, zona));
        conteo.set(clave, e);
      }
    }
  }
  const candidatos = [...conteo]
    .filter(([, e]) => e.ocurrencias >= u.veces && e.dias.size >= u.dias)
    .sort(([, a], [, b]) => b.largo - a.largo || b.ocurrencias - a.ocurrencias);
  const elegidos: [string, { ocurrencias: number; dias: Set<Fecha> }][] = [];
  for (const [clave, e] of candidatos) {
    // Si la secuencia está contenida en una más larga que se repite igual o más, ya está cubierta.
    const cubierta = elegidos.some(([k, x]) => ` → ${k} → `.includes(` → ${clave} → `) && x.ocurrencias >= e.ocurrencias);
    if (!cubierta) elegidos.push([clave, e]);
  }
  return elegidos.slice(0, MAX_PATRONES).map(([patron, e]): Patron => ({ fuente: "zsh", patron, ocurrencias: e.ocurrencias, dias: e.dias.size }));
}

function palabrasDe(s: string): Set<string> {
  return new Set(normalizar(s).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((p) => p !== ""));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes++;
  return comunes / (a.size + b.size - comunes);
}

export function patronesDePrompts(prompts: readonly PromptUsuario[], u: Umbrales, zona: string): Patron[] {
  const grupos: { palabras: Set<string>; ejemplo: string; ocurrencias: number; dias: Set<Fecha> }[] = [];
  for (const p of prompts) {
    const palabras = palabrasDe(p.texto);
    if (palabras.size < 4) continue; // "dale", "sí, acepto": confirmaciones, no pedidos que valga automatizar.
    const dia = fechaLocal(p.en, zona);
    const grupo = grupos.find((g) => jaccard(g.palabras, palabras) >= 0.8);
    if (grupo === undefined) {
      grupos.push({ palabras, ejemplo: p.texto, ocurrencias: 1, dias: new Set([dia]) });
    } else {
      grupo.ocurrencias++;
      grupo.dias.add(dia);
    }
  }
  return grupos
    .filter((g) => g.ocurrencias >= u.veces && g.dias.size >= u.dias)
    .sort((a, b) => b.ocurrencias - a.ocurrencias)
    .slice(0, MAX_PATRONES)
    .map((g): Patron => ({ fuente: "claude-code", patron: g.ejemplo.replace(/\s+/g, " ").trim().slice(0, 120), ocurrencias: g.ocurrencias, dias: g.dias.size }));
}
```

- [ ] **Step 5: Conectar las sugerencias en daily**

En `src/daily.ts`:

1. Reemplazar `import { leerConfig, rutas, type Config } from "./config.ts";` por `import { expandirHome, leerConfig, rutas, type Config } from "./config.ts";`.
2. Reemplazar `import { tituloDeSesion } from "./fuentes/claudeCode.ts";` por:

```ts
import { patronesDeComandos, patronesDePrompts, type Patron } from "./detectores/repeticiones.ts";
import { promptsDeTranscript, tituloDeSesion, transcriptsRecientes, type PromptUsuario } from "./fuentes/claudeCode.ts";
import { parsearHistorialZsh, type Comando } from "./fuentes/zsh.ts";
```

3. Reemplazar `import { pedidoBitacora, pedidoVinculos } from "./llm/usos.ts";` por:

```ts
import { pedidoBitacora, pedidoSugerencias, pedidoVinculos } from "./llm/usos.ts";
import { redactar } from "./redactar.ts";
```

4. Reemplazar la definición de `ContextoDaily` por:

```ts
export type ContextoDaily = {
  repo: string;
  config: Config;
  llm: Llm | null;
  ahora: Date;
  desde?: Fecha;
  fuentes?: { comandos: readonly Comando[]; prompts: readonly PromptUsuario[] };
};
```

5. Reemplazar `  const sugerencias: Sugerencia[] = [];` por:

```ts
  let sugerencias: Sugerencia[] = [];
  if (llm !== null && ctx.fuentes !== undefined) {
    const u = config.umbrales.repeticiones;
    const patrones = [...patronesDeComandos(ctx.fuentes.comandos, u, zona), ...patronesDePrompts(ctx.fuentes.prompts, u, zona)];
    sugerencias = await sugerirAutomatizaciones(llm, patrones, avisos);
  }
```

6. Agregar, después de la función `resumirConLlm`:

```ts
async function sugerirAutomatizaciones(llm: Llm, patrones: readonly Patron[], avisos: string[]): Promise<Sugerencia[]> {
  if (patrones.length === 0) return [];
  try {
    const r = await llm.completar(pedidoSugerencias({ patrones: patrones.map((p, i) => ({ id: String(i), ...p })) }));
    return r.propuestas.flatMap((x): Sugerencia[] => {
      const p = patrones[Number(x.id)];
      // El patrón queda en el snapshot: se redacta igual que lo que va al LLM.
      return p === undefined ? [] : [{ ...p, patron: redactar(p.patron), propuesta: { tipo: x.tipo, contenido: x.contenido, porque: x.porque } }];
    });
  } catch (e) {
    if (!(e instanceof ErrorLlm)) throw e;
    avisos.push(`Sin sugerencias: el LLM no está disponible (${e.message}).`);
    return [];
  }
}

const DIAS_DE_HISTORIA = 14;

function leerFuentes(config: Config, ahora: Date, avisos: string[]): { comandos: Comando[]; prompts: PromptUsuario[] } {
  const desde = new Date(ahora.getTime() - DIAS_DE_HISTORIA * 86_400_000);
  const zsh = expandirHome(config.fuentes.zshHistory);
  let comandos: Comando[] = [];
  if (existsSync(zsh)) {
    const r = parsearHistorialZsh(readFileSync(zsh));
    comandos = r.comandos.filter((c) => c.en >= desde);
    if (r.descartadas > 0) avisos.push(`${r.descartadas} líneas del historial de zsh no tienen fecha: con \`setopt EXTENDED_HISTORY\` empiezan a contar.`);
  }
  const prompts: PromptUsuario[] = [];
  let ilegibles = 0;
  for (const t of transcriptsRecientes(expandirHome(config.fuentes.claudeProjects), desde)) {
    const r = promptsDeTranscript(readFileSync(t, "utf8"));
    prompts.push(...r.prompts.filter((p) => p.en >= desde));
    ilegibles += r.descartadas;
  }
  if (ilegibles > 0) avisos.push(`${ilegibles} líneas ilegibles en los transcripts de Claude Code.`);
  return { comandos, prompts };
}
```

7. En `cmdDaily`, reemplazar desde `  const ahora = new Date();` hasta `  for (const aviso of avisos) log("warn", "daily_degradado", { detalle: aviso });` por:

```ts
  const ahora = new Date();
  const avisosFuentes: string[] = [];
  const fuentes = leerFuentes(config, ahora, avisosFuentes);
  const { snapshot, avisos } = await generarSnapshot({
    repo,
    config,
    llm: crearLlm(config),
    ahora,
    fuentes,
    ...(values.desde === undefined ? {} : { desde: values.desde }),
  });
  writeFileSync(rutas(repo).state, `${JSON.stringify(snapshot, null, 2)}\n`);
  for (const aviso of [...avisosFuentes, ...avisos]) log("warn", "daily_degradado", { detalle: aviso });
```

- [ ] **Step 6: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS (todos los tests, incluidos los de daily de la Task 11).

- [ ] **Step 7: Commit**

```bash
git add src/fuentes src/detectores/repeticiones.ts src/daily.ts test/repeticiones.test.ts
git commit -m "feat: repeticiones en zsh y Claude Code con sugerencias de automatización" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Notion real con daily-flock (condicional a la prueba)

**Files:**
- Modify: `src/conectores/notion.ts` (agregar `ConectorNotionClaude`), `src/conectores/crear.ts`
- Test: `test/notion.test.ts`

**Interfaces:**
- Consumes: `Ejecutor`, `ejecutarProceso` (Task 10); `entradasDailyFlock`, `Conector` (Task 14); `objAbierto`, `bool`, `str` (Task 2); `redactar` (Task 3).
- Produces: `class ConectorNotionClaude implements Conector` con `constructor(o: { modelo: string; ejecutar?: Ejecutor })`.

- [ ] **Step 1: Prueba rápida (solo lectura) de acceso headless a Notion y a la skill**

```bash
cd "$(mktemp -d)" && claude -p "Usá notion-fetch para leer la página 3e53c686-b3db-8016-8983-db165bedf5b4 y respondé solo con su título. Después decí si tenés disponible la skill daily-flock." \
  --output-format json --model haiku --no-session-persistence --allowedTools "mcp__claude_ai_Notion__notion-fetch" \
  | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{const o=JSON.parse(s);console.log(o.is_error, String(o.result).slice(0,300), JSON.stringify(o.permission_denials))})'
```

Expected si es viable: `false`, un resultado que nombra "Daily 2026" y confirma la skill, sin `permission_denials`.
**Si no es viable: no seguir con esta tarea.** El conector queda en modo mock (REQ-15 lo permite), se le avisa a Denis y se pasa a la Task 17.

- [ ] **Step 2: Escribir el test que falla**

`test/notion.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ConectorNotionClaude } from "../src/conectores/notion.ts";
import { validarSnapshot, type Snapshot } from "../src/contract/snapshot.ts";
import type { Ejecutor } from "../src/llm/claudeCli.ts";

const snapshot = (): Snapshot =>
  validarSnapshot(JSON.parse(readFileSync(new URL("../frontend/ejemplos/persona-denis.json", import.meta.url), "utf8")));

test("con claude usa solo herramientas de Notion, corre fuera del repo y manda las entradas", async () => {
  const llamadas: { args: readonly string[]; entrada: string; cwd: string | undefined }[] = [];
  const ejecutar: Ejecutor = async (_bin, args, entrada, _timeout, cwd) => {
    llamadas.push({ args, entrada, cwd });
    return { codigo: 0, stdout: JSON.stringify({ is_error: false, result: "listo" }), stderr: "" };
  };
  assert.match(await new ConectorNotionClaude({ modelo: "sonnet", ejecutar }).publicar(snapshot()), /Daily de Notion/);
  const l = llamadas[0];
  assert.equal(l?.cwd, tmpdir());
  const args = l?.args ?? [];
  assert.equal(args[args.indexOf("--allowedTools") + 1], "Skill,mcp__claude_ai_Notion__notion-fetch,mcp__claude_ai_Notion__notion-update-page");
  assert.match(l?.entrada ?? "", /^### 09\/10$/m);
});

test("si claude informa error, el conector falla con el motivo", async () => {
  const ejecutar: Ejecutor = async () => ({ codigo: 0, stdout: JSON.stringify({ is_error: true, result: "sin acceso a Notion" }), stderr: "" });
  await assert.rejects(new ConectorNotionClaude({ modelo: "sonnet", ejecutar }).publicar(snapshot()), /sin acceso a Notion/);
});
```

- [ ] **Step 3: Correrlo y ver que falla**

Run: `node --test test/notion.test.ts`
Expected: FAIL (`ConectorNotionClaude` no existe).

- [ ] **Step 4: Implementar**

En `src/conectores/notion.ts`, reemplazar el bloque de imports por:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import type { Snapshot } from "../contract/snapshot.ts";
import { bool, objAbierto, str } from "../contract/validar.ts";
import { ddmm } from "../fechas.ts";
import { ejecutarProceso, type Ejecutor } from "../llm/claudeCli.ts";
import { redactar } from "../redactar.ts";
import type { Conector } from "./conector.ts";
```

y agregar al final del archivo:

```ts
const HERRAMIENTAS_NOTION = ["Skill", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-update-page"];
const checkSalidaNotion = objAbierto({ is_error: bool, result: str });

/** Publica en la Daily de Notion delegando en la skill daily-flock, como ya hace Denis a mano. */
export class ConectorNotionClaude implements Conector {
  readonly nombre = "notion";
  readonly #modelo: string;
  readonly #ejecutar: Ejecutor;

  constructor(o: { modelo: string; ejecutar?: Ejecutor }) {
    this.#modelo = o.modelo;
    this.#ejecutar = o.ejecutar ?? ejecutarProceso;
  }

  async publicar(s: Snapshot): Promise<string> {
    const prompt = redactar(
      [
        "Usá la skill daily-flock (Flujo A: registrar entradas) para agregar a la página Daily estas entradas, respetando la fecha y la hora de cada una. No agregues nada más ni cambies lo que ya está.",
        "",
        entradasDailyFlock(s),
      ].join("\n"),
    );
    const args = ["-p", "--output-format", "json", "--model", this.#modelo, "--no-session-persistence", "--allowedTools", HERRAMIENTAS_NOTION.join(",")];
    // Corre en un directorio temporal para no cargar los settings del repo ni su hook SessionEnd.
    const r = await this.#ejecutar("claude", args, prompt, 300_000, tmpdir());
    if (r.codigo !== 0) throw new Error(`claude salió con ${String(r.codigo)}: ${r.stderr.slice(0, 200)}`);
    const salida = checkSalidaNotion(JSON.parse(r.stdout), "claude");
    if (salida.is_error) throw new Error(`claude no pudo escribir en Notion: ${salida.result.slice(0, 200)}`);
    return "registrado en la Daily de Notion con daily-flock";
  }
}
```

En `src/conectores/crear.ts`, reemplazar el contenido por:

```ts
import { rutas, type Config } from "../config.ts";
import { ConectorCentral } from "./central.ts";
import type { Conector } from "./conector.ts";
import { ConectorNotionClaude, ConectorNotionMock } from "./notion.ts";

export function crearConectores(config: Config, repo: string): Conector[] {
  return config.conectores.map((nombre): Conector => {
    if (nombre === "central") return new ConectorCentral(config.central.url);
    return config.notion.modo === "claude" ? new ConectorNotionClaude({ modelo: config.llm.modelo }) : new ConectorNotionMock(rutas(repo).notionPreview);
  });
}
```

- [ ] **Step 5: Correr tests y typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/conectores test/notion.test.ts
git commit -m "feat: conector de Notion con claude -p y la skill daily-flock" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Primera publicación real (solo con OK de Denis)**

Escribir en la Daily real es una acción hacia afuera: pedirle confirmación a Denis antes de poner `"notion": { "modo": "claude" }` en `.rastro/config.json` y correr `rastro publish`.

---

### Task 17: Demo de punta a punta sobre el propio repo, y README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: todos los comandos de la CLI.

- [ ] **Step 1: Escribir `README.md`**

````markdown
# Rastro

Memoria de equipo con evidencia. Rastro cruza lo que pasó en el código con el plan de la semana y muestra qué está resuelto, qué está pendiente y con qué evidencia: *"Está resuelto en el código; nadie cerró el ticket."*

No corre todo el tiempo. Se activa en momentos concretos: un post-commit que solo anota el evento, el fin de una sesión de Claude Code y `rastro daily`, a demanda o por cron. Nada sale de tu máquina sin `rastro publish`.

## Requisitos

Node ≥ 22.18 (ejecuta TypeScript sin compilar) y, para el resumen, `claude` en el PATH.

## Uso

```bash
node bin/rastro.js init --equipo "AI Day"            # .rastro/, post-commit y hook SessionEnd
node bin/rastro.js plan propuesta.md                 # arma .rastro/plan.md (formato daily-flock)
git commit -m "[Pendientes] detector"                # [Tarea] vincula el commit con la tarea
node bin/rastro.js daily                             # bitácora, pendientes, desvíos y resumen
node bin/rastro.js serve                             # central en http://127.0.0.1:4317
node bin/rastro.js seed-demo                         # compañeros de ejemplo para la vista de equipo
node bin/rastro.js publish                           # muestra qué sale, pide confirmación y publica
```

## Privacidad

- Los secretos (`sk-…`, `ghp_…`, `AKIA…`, `Bearer …`, `*_TOKEN=`, `password=`) se redactan antes de llamar al LLM o a un conector.
- Las sugerencias de automatización salen de tu terminal y no se comparten salvo que pongas `compartir.sugerencias: true` en `.rastro/config.json`.
- El central escucha solo en localhost: no tiene autenticación todavía.

## Configuración

`.rastro/config.json` (lo crea `init`): persona, zona horaria, conectores (`central`, `notion` con `modo` `mock` o `claude`), umbrales de pendientes, desvíos y repeticiones, y el LLM (`claude-cli` con `haiku` por defecto, o `ninguno`).

## Desarrollo

```bash
npm install
npm run check    # tsc estricto + node --test
```

El contrato entre el motor y la UI está en `intent/spec.md` (sección "Contrato") y en `src/contract/snapshot.ts`. El pedido de la UI está en `frontend/README.md`.
````

- [ ] **Step 2: Demo sobre el propio repo**

```bash
cd /home/denis-legion/Documentos/AI-Day/Rastro
node bin/rastro.js init --equipo "AI Day"
node bin/rastro.js plan "Memoria de equipo con evidencia — Propuesta de producto.md"
cat .rastro/plan.md
```

Expected: `plan.md` con `## Plan semana 05/10`, un entregable y de 2 a 7 tareas. Mostrárselo a Denis antes de seguir: es su plan. (Esta llamada a `claude -p` cuesta centavos.)

```bash
git add README.md
git commit -m "[<una tarea del plan>] README de uso"
node bin/rastro.js daily
```

Expected: el resumen del día con la bitácora (incluido el commit del README con su vínculo `nombre`), los pendientes y el costo del LLM; `.rastro/state.json` escrito.

En otra terminal:

```bash
node bin/rastro.js serve --datos /tmp/rastro-central-demo
```

Y en la primera:

```bash
node bin/rastro.js seed-demo
node bin/rastro.js publish --yes
curl -s http://127.0.0.1:4317/api/equipo
```

Expected: `seed-demo` publica a Lucía, Tomás y Sofía; `publish` muestra la vista previa y `✓ central` (Notion en mock deja `.rastro/notion-preview.md`); `/api/equipo` devuelve 4 personas con Tomás primero por la alerta.

- [ ] **Step 3: Pasos que dependen de Denis (pedir OK, no hacerlos solo)**

- Activar `setopt EXTENDED_HISTORY` en `~/.zshrc` (está fuera del proyecto) para que el historial de terminal empiece a contar.
- Publicar en la Daily real de Notion (Task 16, Step 7).

- [ ] **Step 4: Verificación final y commit**

Run: `npm run check`
Expected: PASS de todos los tests y `tsc` sin errores.

```bash
git add README.md
git commit -m "docs: README de uso de Rastro" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Si el commit del README ya se hizo en el Step 2, este paso solo corre la verificación.)
