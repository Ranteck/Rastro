/** Las fechas del contrato son AAAA-MM-DD sin zona: se leen en UTC para que no corran un día. */
export const aMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/** El contrato acepta "2026-13-45" y `format` lanzaría: mejor mostrar el dato crudo que perder toda la vista. */
export function formatearDia(formato: Intl.DateTimeFormat, iso: string): string {
  const ms = aMs(iso);
  return Number.isNaN(ms) ? iso : formato.format(ms);
}
