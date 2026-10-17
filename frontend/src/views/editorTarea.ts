import { esNombreDeRepo, type Cambio } from "../../../backend/src/contract/cambios.ts";
import type { Snapshot, Tarea } from "../../../backend/src/contract/snapshot.ts";
import { duracion } from "../../../backend/src/contract/validar.ts";
import { h } from "../ui/dom.ts";
import type { Edicion } from "../ui/edicion.ts";
import { aMs } from "../ui/fecha.ts";
import { reposDelSnapshot } from "../ui/repos.ts";

const DIA_CORTO = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric" });
const ESTADOS: readonly Tarea["estado"][] = ["pendiente", "hecha", "sacada"];
const DIA_MS = 86_400_000;

/** Los siete días de la semana del plan; sale del snapshot y no del reloj del navegador. */
function diasDeLaSemana(semana: string): string[] {
  const inicio = aMs(semana);
  if (Number.isNaN(inicio)) return [];
  return Array.from({ length: 7 }, (_, i) => new Date(inicio + i * DIA_MS).toISOString().slice(0, 10));
}

const mismosDias = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((d, i) => d === b[i]);

/** Botón "Editar" y el formulario que abre. El formulario no manda nada: arma los `Cambio` y los entrega a la edición. */
export function editorDeTarea(snapshot: Snapshot, t: Tarea, edicion: Edicion, registrados: readonly string[]): { boton: HTMLButtonElement; formulario: HTMLElement } {
  const semana = snapshot.plan?.semana ?? "";

  const valor = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal", class: "edicion-numero" });
  const unidad = h("select", {}, h("option", { value: "h" }, "horas"), h("option", { value: "d" }, "días"));
  const sinEstimar = h("input", { type: "checkbox" });
  const casillas = diasDeLaSemana(semana).map((dia) => {
    const casilla = h("input", { type: "checkbox", value: dia });
    casilla.checked = t.dias.includes(dia);
    return { dia, casilla };
  });
  const estado = h("select", {}, ...ESTADOS.map((e) => h("option", { value: e }, e)));

  // El valor vacío es "sin repo". Se ofrecen los registrados (un repo recién sumado todavía no sale en el snapshot) y los del snapshot, que incluyen el actual;
  // un nombre que no pase el contrato del cambio `repo` no se ofrece.
  const repos = [...new Set([...registrados, ...reposDelSnapshot(snapshot)])].filter(esNombreDeRepo).sort((a, b) => a.localeCompare(b));
  const repo = h("select", {}, h("option", { value: "" }, "sin repo"), ...repos.map((r) => h("option", { value: r }, r)));
  repo.value = t.repo ?? "";

  valor.value = t.duracion === null ? "" : String(t.duracion.valor);
  unidad.value = t.duracion?.unidad ?? "d";
  sinEstimar.checked = t.duracion === null;
  estado.value = t.estado;
  const alternarDuracion = (): void => {
    valor.disabled = sinEstimar.checked;
    unidad.disabled = sinEstimar.checked;
  };
  sinEstimar.addEventListener("change", alternarDuracion);
  alternarDuracion();

  const aviso = h("p", { class: "edicion-error", role: "alert" });
  const lugar = h("div", { class: "edicion-lugar" });
  // La clave de foco es la del botón "Editar": tras aplicar, el repintado reemplaza ambos y el foco vuelve a ese.
  const clave = `editar:${t.slug}`;
  const verCambio = h("button", { type: "button", class: "boton", "data-foco": clave }, "Ver cambio");

  function armarCambios(): Cambio[] | string {
    const cambios: Cambio[] = [];
    if (sinEstimar.checked ? t.duracion !== null : t.duracion?.valor !== Number(valor.value) || t.duracion.unidad !== unidad.value) {
      const unidadElegida: "h" | "d" = unidad.value === "h" ? "h" : "d";
      const nueva = sinEstimar.checked ? null : { valor: Number(valor.value), unidad: unidadElegida };
      try {
        duracion(nueva, "duración");
      } catch {
        // La regla es la del contrato; el motivo técnico no le sirve a quien edita, que recibe el aviso del formulario.
        return "Poné una duración mayor que 0 o marcá sin estimar.";
      }
      cambios.push({ tipo: "duracion", tarea: t.slug, duracion: nueva });
    }
    const dias = casillas.filter((c) => c.casilla.checked).map((c) => c.dia);
    if (!mismosDias(dias, t.dias)) {
      if (dias.length === 0) return "Elegí al menos un día.";
      cambios.push({ tipo: "dia", tarea: t.slug, dias });
    }
    const nuevoEstado = ESTADOS.find((e) => e === estado.value);
    if (nuevoEstado !== undefined && nuevoEstado !== t.estado) cambios.push({ tipo: "estado", tarea: t.slug, estado: nuevoEstado });
    if (repo.value !== (t.repo ?? "")) cambios.push({ tipo: "repo", tarea: t.slug, repo: repo.value === "" ? null : repo.value });
    return cambios.length === 0 ? "No cambiaste nada." : cambios;
  }

  function pedir(): void {
    const cambios = armarCambios();
    aviso.textContent = typeof cambios === "string" ? cambios : "";
    if (typeof cambios !== "string") edicion.proponer(cambios, lugar, verCambio);
  }
  verCambio.addEventListener("click", pedir);
  const alCambiar = (): void => {
    aviso.textContent = "";
    edicion.cancelar(lugar);
  };

  const formulario = h(
    "form",
    {
      class: "edicion-form",
      role: "group",
      "aria-label": `Editar ${t.nombre}`,
      hidden: true,
      // Una vista previa de valores que el formulario ya no tiene confunde: se pide otra con "Ver cambio".
      oninput: alCambiar,
      onchange: alCambiar,
      onsubmit: (e: Event) => {
        e.preventDefault();
        pedir();
      },
    },
    h(
      "fieldset",
      { class: "edicion-campo" },
      h("legend", { class: "etiqueta meta" }, "Duración"),
      h("label", { class: "edicion-etiqueta" }, h("span", {}, "Cantidad"), valor),
      h("label", { class: "edicion-etiqueta" }, h("span", {}, "Unidad"), unidad),
      h("label", { class: "edicion-casilla" }, sinEstimar, h("span", {}, "Sin estimar")),
    ),
    ...(casillas.length === 0
      ? []
      : [
          h(
            "fieldset",
            { class: "edicion-campo" },
            h("legend", { class: "etiqueta meta" }, "Días"),
            ...casillas.map(({ dia, casilla }) => h("label", { class: "edicion-casilla edicion-dia" }, casilla, h("span", {}, DIA_CORTO.format(aMs(dia))))),
          ),
        ]),
    ...(repos.length === 0 ? [] : [h("div", { class: "edicion-campo" }, h("label", { class: "edicion-etiqueta" }, h("span", { class: "etiqueta meta" }, "Repo"), repo))]),
    h("div", { class: "edicion-campo" }, h("label", { class: "edicion-etiqueta" }, h("span", { class: "etiqueta meta" }, "Estado"), estado)),
    aviso,
    verCambio,
    lugar,
  );

  const boton = h("button", { type: "button", class: "boton-discreto", "aria-expanded": "false", "aria-label": `Editar ${t.nombre}`, "data-foco": clave }, "Editar");
  boton.addEventListener("click", () => {
    formulario.hidden = !formulario.hidden;
    boton.setAttribute("aria-expanded", String(!formulario.hidden));
    if (formulario.hidden) alCambiar();
  });
  return { boton, formulario };
}
