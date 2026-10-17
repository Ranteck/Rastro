import type { EntradaBitacora, Resumen, Snapshot } from "../../../backend/src/contract/snapshot.ts";
import type { SinDaily } from "../api.ts";
import { hashDe } from "../router.ts";
import { decile, enLaTerminal, FRASES_CLAUDE } from "../ui/claude.ts";
import { h } from "../ui/dom.ts";
import { SOLO_LECTURA, type ContextoVista } from "../ui/edicion.ts";
import { vacio } from "../ui/estado.ts";
import { listaEvidencia } from "../ui/evidencia.ts";
import { formatearDia } from "../ui/fecha.ts";
import { placaFueraDelPlan } from "../ui/placa.ts";
import { reposDelSnapshot } from "../ui/repos.ts";
import { crearSello } from "../ui/sello.ts";
import { nombreDeTarea } from "../ui/tarea.ts";
import { formatearTiempo } from "../ui/tiempos.ts";
import { commitDe, corregirTarea } from "./corregirTarea.ts";

const FECHA = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const NUMERO = new Intl.NumberFormat("es-AR");
const USD = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const MARCAS: Record<EntradaBitacora["vinculo"], { clase: string; texto: string }> = {
  nombre: { clase: "marca-lleno", texto: "por nombre" },
  inferido: { clase: "marca-hueco", texto: "inferido" },
  "sin-tarea": { clase: "marca-raya", texto: "sin tarea" },
  corregido: { clase: "marca-rombo", texto: "corregido" },
};

const COLUMNAS: ReadonlyArray<{ clave: keyof Resumen; titulo: string }> = [
  { clave: "hice", titulo: "Hice" },
  { clave: "avance", titulo: "Avancé" },
  { clave: "sigue", titulo: "Sigue" },
  { clave: "bloqueos", titulo: "Bloqueos" },
];

function formatearPeriodo(desde: string, hasta: string): string {
  const dia = (iso: string): string => formatearDia(FECHA, iso);
  return desde === hasta ? dia(desde) : `${dia(desde)} – ${dia(hasta)}`;
}

function formatearCosto(costo: Snapshot["costo"]): string {
  const llamadas = `${NUMERO.format(costo.llamadas)} ${costo.llamadas === 1 ? "llamada" : "llamadas"}`;
  return `${llamadas} · US$${USD.format(costo.usd)} · ${NUMERO.format(costo.tokens)} tokens`;
}

/** Sin plan el backend manda 0%, pero eso es una ausencia y no un dato. */
function fueraDelPlan(snapshot: Snapshot): HTMLElement {
  if (snapshot.plan === null) return h("p", { class: "fuera-del-plan sin-plan" }, "Sin plan esta semana");
  return placaFueraDelPlan(snapshot.desvios);
}

function resueltosSinCerrar(snapshot: Snapshot): HTMLElement | null {
  const cantidad = snapshot.pendientes.filter((p) => p.tipo === "resuelto-sin-cerrar").length;
  if (cantidad === 0) return null;
  return h(
    "aside",
    { class: "lamina sin-cerrar" },
    h("div", { class: "sello-posicion sello-grande" }, crearSello()),
    h("p", { class: "sin-cerrar-cantidad" }, `${cantidad} ${cantidad === 1 ? "resuelto" : "resueltos"} sin cerrar`),
    h("a", { class: "boton boton-primario", href: hashDe({ tipo: "persona", id: snapshot.persona.id, vista: "pendientes" }) }, "Ver pendientes"),
  );
}

/** `foco` apunta por slug: una tarea que ya no está en el plan se nombra por su slug y no rompe la vista. */
function filaDeFoco(snapshot: Snapshot, etiqueta: string, slug: string, conTiempo: boolean): HTMLElement {
  const tarea = snapshot.plan?.tareas.find((t) => t.slug === slug);
  return h(
    "p",
    { class: "foco-fila" },
    h("span", { class: "etiqueta foco-etiqueta" }, `${etiqueta}:`),
    " ",
    h("span", { class: "foco-tarea" }, nombreDeTarea(snapshot, slug)),
    ...(conTiempo && tarea !== undefined ? [" · ", h("span", { class: "dato foco-tiempo" }, formatearTiempo(tarea))] : []),
    ...(conTiempo && tarea?.noEntra === true ? [" · ", h("span", { class: "etiqueta" }, "no entra esta semana")] : []),
  );
}

function foco(snapshot: Snapshot): HTMLElement | null {
  const { actual = null, siguiente = null } = snapshot.foco ?? {};
  const atrasadas = snapshot.desvios.tareasAtrasadas;
  const filas = [
    ...(actual === null ? [] : [filaDeFoco(snapshot, "Ahora", actual, false)]),
    ...(siguiente === null ? [] : [filaDeFoco(snapshot, "Sigue", siguiente, true)]),
    ...(atrasadas.length === 0
      ? []
      : [
          h(
            "p",
            { class: "foco-fila" },
            h("span", { class: "etiqueta foco-etiqueta" }, "Atrasadas:"),
            ` ${atrasadas.map((t) => nombreDeTarea(snapshot, t)).join(", ")}`,
          ),
        ]),
  ];
  return filas.length === 0 ? null : h("div", { class: "foco", role: "group", "aria-label": "Foco" }, ...filas);
}

function columna(titulo: string, items: readonly string[]): HTMLElement {
  return h(
    "section",
    { class: "resumen-columna" },
    h("h2", { class: "etiqueta resumen-titulo" }, titulo),
    items.length === 0
      ? h("p", { class: "meta" }, "—")
      : h("ul", { class: "resumen-lista" }, ...items.map((texto) => h("li", {}, texto))),
  );
}

function resumen(valor: Resumen | null): HTMLElement {
  if (valor === null) {
    return h("p", { class: "cuerpo meta resumen-ausente" }, "Sin resumen: el LLM no estuvo disponible en esta corrida.");
  }
  return h("div", { class: "resumen" }, ...COLUMNAS.map(({ clave, titulo }) => columna(titulo, valor[clave])));
}

function entrada(snapshot: Snapshot, e: EntradaBitacora, { edicion }: ContextoVista, variosRepos: boolean): HTMLElement {
  const marca = MARCAS[e.vinculo];
  const commit = commitDe(e);
  return h(
    "li",
    { class: "entrada" },
    h("span", { class: "dato entrada-hora" }, e.hora),
    h(
      "span",
      { class: "entrada-marca" },
      h("span", { class: `marca-estado ${marca.clase}`, "aria-hidden": "true" }),
      h("span", { class: "etiqueta meta" }, marca.texto),
    ),
    h(
      "div",
      { class: "entrada-cuerpo" },
      ...(e.tarea === null ? [] : [h("p", { class: "entrada-tarea" }, nombreDeTarea(snapshot, e.tarea))]),
      h("p", { class: "entrada-texto" }, e.texto),
      h("p", { class: "dato meta" }, variosRepos && e.repo !== null ? `${e.repo} · ${e.rama}` : e.rama),
    ),
    h(
      "div",
      { class: "entrada-margen" },
      ...listaEvidencia(e.evidencia),
      ...(e.razon === undefined ? [] : [h("p", { class: "razon" }, e.razon)]),
      ...(edicion === null || commit === null ? [] : [corregirTarea(snapshot, e, commit, edicion)]),
    ),
  );
}

/** Lo más reciente arriba: fecha y hora son strings de ancho fijo, así que se comparan como texto. */
function masRecientePrimero(bitacora: readonly EntradaBitacora[]): EntradaBitacora[] {
  return [...bitacora].sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`));
}

function bitacora(snapshot: Snapshot, contexto: ContextoVista): HTMLElement {
  if (snapshot.bitacora.length === 0) return vacio("Hoy no hay actividad registrada.");
  // Con un solo repo el nombre se repetiría en cada entrada sin distinguir nada.
  const variosRepos = reposDelSnapshot(snapshot).length > 1;
  return h("ol", { class: "bitacora" }, ...masRecientePrimero(snapshot.bitacora).map((e) => entrada(snapshot, e, contexto, variosRepos)));
}

const COMANDO_DAILY = "rastro daily";

/** Antes del primer daily no hay día que mostrar: se explica por qué y se dice qué pedirle a Claude (el comando queda de alternativa), en vez de una bitácora vacía. */
function miDiaSinDaily(snapshot: Snapshot, { proximoDaily }: SinDaily): HTMLElement {
  return h(
    "section",
    { class: "mi-dia", "aria-label": "Mi día" },
    h("header", { class: "cabecera-dia" }, h("h1", { class: "titulo" }, snapshot.persona.nombre)),
    h(
      "div",
      { class: "estado lamina" },
      h("p", { class: "cuerpo" }, "Todavía no corrió el daily, así que no hay nada de tu día para mostrar."),
      h(
        "p",
        { class: "cuerpo" },
        ...decile(FRASES_CLAUDE.cerrarElDia),
        ...(proximoDaily === null ? ["."] : [", o esperá al automático de las ", h("span", { class: "dato" }, proximoDaily), " (de lunes a viernes)."]),
      ),
      ...enLaTerminal(COMANDO_DAILY),
    ),
  );
}

export function vistaMiDia(snapshot: Snapshot, contexto: ContextoVista = SOLO_LECTURA): Node {
  if (contexto.sinDaily !== undefined) return miDiaSinDaily(snapshot, contexto.sinDaily);
  const sello = resueltosSinCerrar(snapshot);
  const bloqueFoco = foco(snapshot);
  return h(
    "section",
    { class: "mi-dia", "aria-label": "Mi día" },
    h(
      "header",
      { class: "cabecera-dia" },
      h("h1", { class: "titulo" }, snapshot.persona.nombre),
      h("p", { class: "cuerpo meta cabecera-fecha" }, formatearPeriodo(snapshot.periodo.desde, snapshot.periodo.hasta)),
      fueraDelPlan(snapshot),
      ...(sello === null ? [] : [sello]),
      ...(bloqueFoco === null ? [] : [bloqueFoco]),
    ),
    resumen(snapshot.resumen),
    h("h2", { class: "etiqueta bitacora-titulo" }, "Bitácora"),
    bitacora(snapshot, contexto),
    h("p", { class: "dato meta costo" }, formatearCosto(snapshot.costo)),
  );
}
