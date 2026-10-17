import { arr, duracion, ErrorValidacion, fechasOrdenadas, lit, nullable, obj, objAbierto, patron, slug, type Check, type Infer } from "./validar.ts";

const sha = patron(/^[0-9a-f]{7,40}$/i, "un SHA de 7 a 40 caracteres hexadecimales");

// Sin espacios ni "·": el nombre se escribe en el sufijo de plan.md y tiene que releerse igual.
const PATRON_REPO = /^[^\s·]+$/;
const nombreRepo = patron(PATRON_REPO, "un nombre de repo sin espacios");

/** Lo mismo que valida el cambio `repo`: el editor del frontend solo ofrece nombres que el central aceptaría. */
export const esNombreDeRepo = (texto: string): boolean => PATRON_REPO.test(texto);

/** Convierte un texto (el basename de un repo) en un nombre que cumple `nombreRepo`. */
export function nombreDeRepoValido(texto: string): string {
  return texto.replace(/[\s·]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
}

const diasFijados: Check<string[]> = (v, r) => {
  const dias = fechasOrdenadas(v, r);
  if (dias.length === 0) throw new ErrorValidacion(r, "se esperaba al menos un día");
  return dias;
};

const porTipo = {
  duracion: obj({ tipo: lit("duracion"), tarea: slug, duracion }),
  dia: obj({ tipo: lit("dia"), tarea: slug, dias: diasFijados }),
  estado: obj({ tipo: lit("estado"), tarea: slug, estado: lit("pendiente", "hecha", "sacada") }),
  repo: obj({ tipo: lit("repo"), tarea: slug, repo: nullable(nombreRepo) }),
  vinculo: obj({ tipo: lit("vinculo"), commit: sha, tarea: nullable(slug) }),
  ofrecimiento: obj({ tipo: lit("ofrecimiento"), id: slug, accion: lit("aceptar", "descartar") }),
};

/** Módulo puro, sin Node: lo importan la CLI, el central y el frontend. */
export type Cambio = Infer<(typeof porTipo)[keyof typeof porTipo]>;

export const checkCambios = arr<Cambio>((v, r) => {
  const { tipo } = objAbierto({ tipo: lit("duracion", "dia", "estado", "repo", "vinculo", "ofrecimiento") })(v, r);
  return porTipo[tipo](v, r);
});
