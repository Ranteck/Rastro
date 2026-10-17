import { arr, ErrorValidacion, lit, nullable, num, objAbierto, str, type Check, type Infer } from "../contract/validar.ts";
import type { Fecha } from "../fechas.ts";
import { log } from "../log.ts";
import { duracionEnRango, type Duracion } from "../plan.ts";
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
  // Se redacta cada texto antes de serializar: redactar el JSON ya armado podría romperlo.
  const json = JSON.stringify(datos, (_clave, v: unknown) => (typeof v === "string" ? redactar(v) : v), 1);
  return `${instrucciones}\n\nDatos (JSON):\n${json}`;
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

const checkDuracionEstricta = objAbierto({ valor: num, unidad: lit("h", "d") });

/** Una estimación inválida no tira el plan entero: la tarea queda sin duración y se avisa. */
const duracionDelLlm: Check<Duracion | null> = (v, r) => {
  try {
    const d = checkDuracionEstricta(v, r);
    if (duracionEnRango(d)) return d;
  } catch (e) {
    if (!(e instanceof ErrorValidacion)) throw e;
  }
  log("warn", "duracion_invalida", { ruta: r });
  return null;
};

const checkTareaNueva = objAbierto({ nombre: str, objetivo: str, duracion: duracionDelLlm });
const ESQUEMA_DURACION = objeto({ valor: { type: "number" }, unidad: { type: "string", enum: ["h", "d"] } });
const ESQUEMA_TAREA = objeto({ nombre: TEXTO, objetivo: TEXTO, duracion: ESQUEMA_DURACION });
const CONSIGNA_DURACION =
  "duracion: { valor, unidad } con unidad h (de 0,25 a 80) o d (de 0,25 a 10, días de trabajo). Estimá a grandes rasgos según la descripción de la tarea.";
const checkPlan = objAbierto({ entregable: str, tareas: arr(checkTareaNueva) });

export function pedidoPlan(propuesta: string, semana: Fecha): PedidoLlm<Infer<typeof checkPlan>> {
  return {
    uso: "plan",
    sistema: SISTEMA,
    prompt: armarPrompt(
      [
        `Armá el plan de la semana que empieza el ${semana} a partir de la propuesta.`,
        "- entregable: qué se va a poder mostrar o reproducir el viernes, en una o dos oraciones cortas (35 palabras como máximo), concreto y verificable. Nombrá lo esencial del resultado, sin repetir las tareas una por una.",
        '- tareas: entre 2 y 7. nombre: de 1 a 3 palabras, sin el carácter ":" (se usa como etiqueta [Nombre] en los commits). objetivo: una oración en infinitivo.',
        `- ${CONSIGNA_DURACION}`,
      ].join("\n"),
      { propuesta: redactar(propuesta).slice(0, 30_000) },
    ),
    esquema: objeto({ entregable: TEXTO, tareas: lista(ESQUEMA_TAREA) }),
    validar: checkPlan,
  };
}

const checkTareaSugerida = objAbierto({ nombre: str, objetivo: str, duracion: duracionDelLlm, porque: str });
const ESQUEMA_TAREA_SUGERIDA = objeto({ nombre: TEXTO, objetivo: TEXTO, duracion: ESQUEMA_DURACION, porque: TEXTO });
const checkSugerirPlan = objAbierto({ tareas: arr(checkTareaSugerida) });

export function pedidoSugerirPlan(d: {
  plan: { nombre: string; objetivo: string }[];
  trabajoFueraDelPlan: string[];
}): PedidoLlm<Infer<typeof checkSugerirPlan>> {
  return {
    uso: "sugerir-plan",
    sistema: SISTEMA,
    prompt: armarPrompt(
      `Proponé de 0 a 4 tareas nuevas para el plan a partir del trabajo que se hizo fuera de él. Solo tareas que no estén ya en el plan. nombre: de 1 a 3 palabras, sin ":". objetivo: una oración en infinitivo. porque: una oración que explique por qué conviene sumarla, según el trabajo fuera del plan. ${CONSIGNA_DURACION}`,
      d,
    ),
    esquema: objeto({ tareas: lista(ESQUEMA_TAREA_SUGERIDA) }),
    validar: checkSugerirPlan,
  };
}

const checkDuraciones = objAbierto({ duraciones: arr(objAbierto({ slug: str, duracion: duracionDelLlm })) });

export function pedidoDuraciones(tareas: { slug: string; nombre: string; objetivo: string }[]): PedidoLlm<Infer<typeof checkDuraciones>> {
  return {
    uso: "duraciones",
    sistema: SISTEMA,
    prompt: armarPrompt(`Estimá la duración de cada tarea del plan, que todavía no tiene una. Devolvé el mismo slug de cada tarea. ${CONSIGNA_DURACION}`, { tareas }),
    esquema: objeto({ duraciones: lista(objeto({ slug: TEXTO, duracion: ESQUEMA_DURACION })) }),
    validar: checkDuraciones,
  };
}

const ESTADOS_PROYECTO = ["hecha", "en-curso", "pendiente"] as const;
const checkTareaDeProyecto = objAbierto({ nombre: str, objetivo: str, duracion: duracionDelLlm, estado: lit(...ESTADOS_PROYECTO), porque: str });
const checkDesdeProyecto = objAbierto({ entregable: str, tareas: arr(checkTareaDeProyecto) });

export type DatosProyecto = {
  propuesta: string | null;
  sdlc: { feature: string; intent: string | null; spec: string | null; plan: string | null }[];
  casillas: { texto: string; marcada: boolean }[];
  commits: string[];
  /** Lo que falta de la cadena intent -> spec -> plan: se estiman también, con el mismo nombre. */
  pasosDelProceso: { nombre: string; objetivo: string }[];
};

export function pedidoDesdeProyecto(d: DatosProyecto): PedidoLlm<Infer<typeof checkDesdeProyecto>> {
  return {
    uso: "desde-proyecto",
    sistema: SISTEMA,
    prompt: armarPrompt(
      [
        "Proponé las tareas del plan de este proyecto a partir de su propuesta, el estado de su proceso (intent, spec, plan), las casillas de sus planes y los asuntos de sus últimos commits.",
        "- entregable: qué se va a poder mostrar o reproducir al cerrar la semana, en una o dos oraciones cortas (35 palabras como máximo).",
        '- tareas: de 3 a 8 tareas del proyecto, más cada paso de pasosDelProceso con su mismo nombre. nombre: de 1 a 3 palabras, sin el carácter ":". objetivo: una oración en infinitivo.',
        "- estado: hecha, en-curso o pendiente, según los commits y las casillas. Marcá hecha solo si hay un commit o una casilla marcada que la nombre; si dudás, pendiente.",
        "- porque: una oración que cite la evidencia (commit, casilla o parte de la propuesta) o diga que no la hay.",
        `- ${CONSIGNA_DURACION}`,
      ].join("\n"),
      { ...d, propuesta: d.propuesta === null ? null : redactar(d.propuesta).slice(0, 30_000) },
    ),
    esquema: objeto({
      entregable: TEXTO,
      tareas: lista(objeto({ nombre: TEXTO, objetivo: TEXTO, duracion: ESQUEMA_DURACION, estado: { type: "string", enum: [...ESTADOS_PROYECTO] }, porque: TEXTO })),
    }),
    validar: checkDesdeProyecto,
  };
}
