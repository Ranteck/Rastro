import type { Plan } from "./contract/snapshot.ts";
import { arr, lit, nullable, objAbierto, str, type Infer } from "./contract/validar.ts";
import { ddmm, lunesDe, lunesQueViene, type Fecha } from "./fechas.ts";
import { log } from "./log.ts";
import { duracionEnRango, parsearDias, parsearDuracion, renderizarPlan, textoDias, textoDuracion, type TareaARenderizar } from "./plan.ts";
import { redactar } from "./redactar.ts";
import { normalizar } from "./texto.ts";

const TEXTO_O_NULL = { type: ["string", "null"] };

const ESQUEMA_PLAN = {
  type: ["object", "null"],
  properties: {
    semana: TEXTO_O_NULL,
    entregable: TEXTO_O_NULL,
    tareas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nombre: { type: "string" },
          objetivo: { type: "string" },
          estado: { enum: ["pendiente", "hecha", "sacada"] },
          duracion: TEXTO_O_NULL,
          dias: TEXTO_O_NULL,
          repo: TEXTO_O_NULL,
        },
        required: ["nombre", "objetivo", "estado", "duracion", "dias", "repo"],
        additionalProperties: false,
      },
    },
  },
  required: ["semana", "entregable", "tareas"],
  additionalProperties: false,
};

/** El esquema que se le pasa a `claude --json-schema`: el plan de esta semana y el de la que viene, esté como esté escrita la página. */
export const ESQUEMA_EXTRACCION = {
  type: "object",
  properties: { plan: ESQUEMA_PLAN, planProxima: ESQUEMA_PLAN },
  required: ["plan", "planProxima"],
  additionalProperties: false,
};

// La respuesta del LLM es dato no confiable: se descartan los campos de más y los valores se vuelven a leer con los parsers del plan.
const checkPlanExtraido = objAbierto(
  {
    entregable: nullable(str),
    tareas: arr(objAbierto({ nombre: str, objetivo: str, estado: lit("pendiente", "hecha", "sacada"), duracion: nullable(str), dias: nullable(str), repo: nullable(str) })),
  },
  { semana: nullable(str) },
);

// `planProxima` es opcional: una respuesta que solo trae `plan` sigue siendo válida.
export const checkExtraccion = objAbierto({ plan: nullable(checkPlanExtraido) }, { planProxima: nullable(checkPlanExtraido) });

export type Extraccion = Infer<typeof checkExtraccion>;

export function instruccionDeExtraccion(o: { donde: string; hoy: Fecha; repos: readonly string[]; conocido: Plan | null; conocidoProxima?: Plan | null }): string {
  const lunes = ddmm(lunesDe(o.hoy));
  const lunesProximo = ddmm(lunesQueViene(o.hoy));
  const conocidoProxima = o.conocidoProxima ?? null;
  return [
    o.donde,
    "Es solo lectura: no modifiques, crees ni borres nada en Notion.",
    `Buscá el plan semanal de la semana que empieza el lunes ${lunes}. La página puede escribirlo en cualquier formato (lista, tabla, un título por tarea, el proyecto en negrita, etc.): leelo como esté y devolvelo en "plan", o null si esa semana no tiene plan.`,
    `Buscá también el plan de la semana siguiente, la que empieza el lunes ${lunesProximo}, y devolvelo en "planProxima", o null si todavía no tiene plan. Nunca pongas el plan de una semana en el campo de la otra: en cada uno, "semana" es el lunes de esa semana como DD/MM (por ejemplo ${lunes} y ${lunesProximo}).`,
    '- entregable: lo que se entrega el viernes, o null si no lo dice.',
    "- tareas: una por cada tarea del plan, con:",
    '  - nombre: la tarea en sí, no el proyecto, de 1 a 3 palabras y sin ":". Si una línea tiene un proyecto como etiqueta (en negrita antes de la tarea, por ejemplo), el proyecto va en repo y el nombre sale del resto de la línea. Que no haya dos tareas con el mismo nombre.',
    "  - objetivo: lo que hay que lograr, en una oración, con las palabras de la página.",
    '  - estado: "hecha" si está marcada como hecha, "sacada" si está tachada o dada de baja, y "pendiente" en cualquier otro caso.',
    '  - duracion: la estimación como texto, por ejemplo "4h" (horas) o "2d" (días), o null si no la dice.',
    '  - dias: los días de la semana en que se hace, por ejemplo "lun–mié, vie" (lun, mar, mié, jue, vie, sáb, dom), o "no entra" si la página dice que no entra en la semana, o null si no los dice.',
    o.repos.length === 0
      ? "  - repo: null (todavía no hay repos registrados)."
      : `  - repo: si la tarea nombra un proyecto que se parece a uno de los repos registrados (${redactar(o.repos.join(", "))}), ese nombre exacto; si no, null.`,
    "Completá duracion, dias y repo solo con lo que el plan de esa semana dice de forma explícita. No los deduzcas de las entradas de la bitácora, de otras semanas ni de lo que parezca razonable: si no lo dice, null.",
    ...(o.conocido === null || o.conocido.tareas.length === 0
      ? []
      : [
          // Sin esto el LLM nombra y reformula distinto la misma tarea en cada lectura, y contra la base eso se vería como cambios que no hubo.
          `Rastro ya conoce este plan de la semana: ${redactar(JSON.stringify(conocidoParaLlm(o.conocido)))}. Si una tarea de la página es la misma que una de estas, usá exactamente ese nombre; y si la página no dice otra cosa de un campo, devolvé el valor que Rastro ya tiene, sin reformularlo. Inventá un nombre solo para las tareas que no estén en la lista.`,
        ]),
    ...(conocidoProxima === null || conocidoProxima.tareas.length === 0
      ? []
      : [`Rastro ya conoce el plan de la semana que empieza el lunes ${lunesProximo}: ${redactar(JSON.stringify(conocidoParaLlm(conocidoProxima)))}. Para "planProxima" valen las mismas reglas: mismo nombre para la misma tarea y, si la página no dice otra cosa de un campo, el valor que Rastro ya tiene.`]),
    "No inventes tareas ni valores que la página no diga.",
  ].join("\n");
}

function conocidoParaLlm(plan: Plan): unknown {
  return {
    entregable: plan.entregable,
    tareas: plan.tareas.map((t) => ({
      nombre: t.nombre,
      estado: t.estado,
      duracion: t.duracion === null ? null : textoDuracion(t.duracion),
      dias: t.noEntra ? "no entra" : t.dias.length === 0 ? null : textoDias(t.dias),
      repo: t.repo,
    })),
  };
}

const comoLog = (texto: string): string => redactar(texto).replace(/\s+/g, " ").trim().slice(0, 60);

function leerDias(texto: string | null, semana: Fecha): { dias: Fecha[]; noEntra: boolean } | null {
  if (texto === null || texto.trim() === "") return null;
  if (normalizar(texto.trim()) === "no entra") return { dias: [], noEntra: true };
  const dias = parsearDias(texto, semana);
  return dias === null || dias.some((f, i) => i > 0 && f <= (dias[i - 1] ?? "")) ? null : { dias, noEntra: false };
}

/**
 * Arma el bloque normalizado de la semana de `hoy` con lo que el LLM extrajo de la página, o null si no hay plan o no tiene tareas.
 * Lo que no se puede leer queda null y se avisa, por el log y por `avisar`: la duración o los días ilegibles, y un repo que no está registrado.
 */
export function bloqueDeExtraccion(extraccion: Extraccion, o: { hoy: Fecha; repos: readonly string[]; avisar: (aviso: string) => void }): string | null {
  const plan = extraccion.plan;
  if (plan === null || plan.tareas.length === 0) return null;
  const semana = lunesDe(o.hoy);
  const tareas = plan.tareas.map((t): TareaARenderizar => {
    const duracion = t.duracion === null ? null : parsearDuracion(t.duracion);
    if (t.duracion !== null && t.duracion.trim() !== "" && (duracion === null || !duracionEnRango(duracion))) {
      log("warn", "notion_duracion_ilegible", { tarea: comoLog(t.nombre), valor: comoLog(t.duracion) });
      o.avisar(`La duración "${comoLog(t.duracion)}" de la tarea "${comoLog(t.nombre)}" no se entiende: queda sin duración.`);
    }
    const dias = leerDias(t.dias, semana);
    if (t.dias !== null && t.dias.trim() !== "" && dias === null) {
      log("warn", "notion_dias_ilegibles", { tarea: comoLog(t.nombre), valor: comoLog(t.dias) });
      o.avisar(`Los días "${comoLog(t.dias)}" de la tarea "${comoLog(t.nombre)}" no se entienden: queda sin días.`);
    }
    const pedido = t.repo?.trim() ?? "";
    const repo = o.repos.find((r) => r === pedido) ?? o.repos.find((r) => r.toLowerCase() === pedido.toLowerCase()) ?? null;
    if (repo === null && pedido !== "") {
      log("warn", "notion_repo_no_registrado", { tarea: comoLog(t.nombre), repo: comoLog(pedido) });
      o.avisar(`El repo "${comoLog(pedido)}" de la tarea "${comoLog(t.nombre)}" no está registrado: la tarea queda sin repo.`);
    }
    return {
      nombre: t.nombre,
      objetivo: t.objetivo,
      estado: t.estado,
      duracion: duracion !== null && duracionEnRango(duracion) ? duracion : null,
      dias: dias?.dias ?? [],
      noEntra: dias?.noEntra ?? false,
      repo,
    };
  });
  return renderizarPlan(semana, plan.entregable ?? "", tareas);
}

/**
 * Los bloques normalizados de esta semana y de la que viene, uno detrás del otro, con lo que el LLM extrajo de la página.
 * Un plan que el LLM rotuló con otra semana que la pedida no se adopta: se avisa y esa semana queda sin plan.
 */
export function bloquesDeExtraccion(extraccion: Extraccion, o: { hoy: Fecha; repos: readonly string[]; avisar: (aviso: string) => void }): string | null {
  const semanas = [
    { hoy: o.hoy, plan: extraccion.plan ?? null },
    { hoy: lunesQueViene(o.hoy), plan: extraccion.planProxima ?? null },
  ];
  const bloques = semanas.flatMap(({ hoy, plan }) => {
    const esperada = ddmm(lunesDe(hoy));
    const rotulo = plan?.semana?.trim() ?? "";
    // "5/10", "05/10" o "lunes 05/10": lo que importa es el día y el mes.
    const dicho = /(\d{1,2})\/(\d{1,2})/.exec(rotulo);
    if (plan !== null && rotulo !== "" && `${(dicho?.[1] ?? "").padStart(2, "0")}/${(dicho?.[2] ?? "").padStart(2, "0")}` !== esperada) {
      log("warn", "notion_semana_distinta", { esperada, recibida: comoLog(rotulo) });
      o.avisar(`El plan que leí de Notion como el de la semana del ${esperada} dice ser de la del ${comoLog(rotulo)}: no lo adopto.`);
      return [];
    }
    const bloque = bloqueDeExtraccion({ plan }, { ...o, hoy });
    return bloque === null ? [] : [bloque];
  });
  return bloques.length === 0 ? null : bloques.join("\n");
}
