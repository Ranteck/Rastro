export type Comando = { en: Date; texto: string };

const META = 0x83;
const RE_LINEA = /^: (\d+):\d+;(.*)$/;

/** zsh guarda algunos bytes no ASCII "metaficados": 0x83 seguido del byte original XOR 0x20. */
export function desmetaficar(b: Buffer): Buffer {
  const salida = Buffer.alloc(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    const byte = b[i] ?? 0;
    if (byte === META && i + 1 < b.length) {
      i++;
      salida[j++] = (b[i] ?? 0) ^ 0x20;
    } else {
      salida[j++] = byte;
    }
  }
  return salida.subarray(0, j);
}

/** Formato EXTENDED_HISTORY (": <epoch>:<duración>;<comando>"). Las líneas sin fecha se descartan y se cuentan. */
export function parsearHistorialZsh(contenido: Buffer): { comandos: Comando[]; descartadas: number } {
  const comandos: Comando[] = [];
  let descartadas = 0;
  let actual: Comando | null = null;
  for (const linea of desmetaficar(contenido).toString("utf8").split("\n")) {
    if (actual !== null && actual.texto.endsWith("\\")) {
      actual.texto = `${actual.texto.slice(0, -1)}\n${linea}`;
      continue;
    }
    const m = RE_LINEA.exec(linea);
    if (m !== null && m[1] !== undefined) {
      actual = { en: new Date(Number(m[1]) * 1000), texto: m[2] ?? "" };
      comandos.push(actual);
    } else if (linea.trim() !== "") {
      descartadas++;
      actual = null;
    }
  }
  return { comandos, descartadas };
}
