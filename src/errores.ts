/** Error esperado: la CLI muestra su mensaje tal cual, sin stack. */
export class ErrorUsuario extends Error {
  override name = "ErrorUsuario";
}
