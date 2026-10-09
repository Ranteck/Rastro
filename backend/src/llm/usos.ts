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
