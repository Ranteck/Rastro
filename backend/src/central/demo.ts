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
