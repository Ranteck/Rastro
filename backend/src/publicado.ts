import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rutasGlobales } from "./config.ts";
import type { Plan } from "./contract/snapshot.ts";
import { ErrorValidacion, fecha, type Infer, lit, obj, str } from "./contract/validar.ts";
import { ErrorUsuario } from "./errores.ts";

// El modo se guarda porque publicar en el mock no deja el plan en Notion: al pasar a "claude" hay que publicarlo de nuevo.
// `queViene` es lo que Notion ya tiene del plan de la semana que viene: cuando llega el lunes y pasa a ser el vigente, `publish` no lo vuelve a ofrecer.
const checkPublicado = obj({ planHuella: str }, { modo: lit("mock", "claude"), queViene: obj({ semana: fecha, planHuella: str, modo: lit("mock", "claude") }) });
export type Publicado = Infer<typeof checkPublicado>;

/** El plan se publica solo cuando cambió: se compara la huella de lo que ya salió con la del plan vigente. */
export function huellaDelPlan(plan: Plan | null): string | null {
  return plan === null ? null : createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function leerPublicado(): Publicado | null {
  const archivo = rutasGlobales().publicado;
  if (!existsSync(archivo)) return null;
  try {
    return checkPublicado(JSON.parse(readFileSync(archivo, "utf8")), "publicado.json");
  } catch (e) {
    if (e instanceof ErrorValidacion || e instanceof SyntaxError) {
      throw new ErrorUsuario(`${archivo} no es válido (${e.message}): borralo y volvé a publicar.`, { cause: e });
    }
    throw e;
  }
}

export function guardarPublicado(planHuella: string, modo: "mock" | "claude"): void {
  const r = rutasGlobales();
  mkdirSync(r.dir, { recursive: true });
  const queViene = leerPublicado()?.queViene;
  writeFileSync(r.publicado, `${JSON.stringify({ planHuella, modo, ...(queViene === undefined ? {} : { queViene }) })}\n`);
}

/** Anota que Notion ya tiene el plan de `semana` (la que viene), sin tocar lo publicado de la semana en curso. */
export function guardarPublicadoDeLaQueViene(semana: string, planHuella: string, modo: "mock" | "claude"): void {
  const r = rutasGlobales();
  mkdirSync(r.dir, { recursive: true });
  const previo = leerPublicado();
  writeFileSync(r.publicado, `${JSON.stringify({ planHuella: previo?.planHuella ?? "", ...(previo?.modo === undefined ? {} : { modo: previo.modo }), queViene: { semana, planHuella, modo } })}\n`);
}

/** ¿Notion ya tiene este plan? Vale lo publicado de la semana en curso o, si ese plan era el de la que viene, lo que se adoptó de antemano. */
export function yaPublicado(plan: Plan, huella: string, modo: "mock" | "claude", publicado: Publicado | null): boolean {
  if (publicado === null) return false;
  if (huella === publicado.planHuella && modo === publicado.modo) return true;
  return publicado.queViene?.semana === plan.semana && publicado.queViene.planHuella === huella && publicado.queViene.modo === modo;
}
