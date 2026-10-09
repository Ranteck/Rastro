export type Tema = "light" | "dark";

const CLAVE = "rastro.tema";

function esTema(valor: unknown): valor is Tema {
  return valor === "light" || valor === "dark";
}

function leerGuardado(): Tema | null {
  try {
    const valor = localStorage.getItem(CLAVE);
    return esTema(valor) ? valor : null;
  } catch {
    // Sin acceso a localStorage la elección no persiste; se sigue al sistema en vez de romper la UI.
    return null;
  }
}

function guardar(tema: Tema): void {
  try {
    localStorage.setItem(CLAVE, tema);
  } catch {
    // La elección vale para esta sesión aunque no se pueda persistir.
  }
}

function delSistema(): Tema {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function temaActual(): Tema {
  const elegido = document.documentElement.dataset["theme"];
  return esTema(elegido) ? elegido : delSistema();
}

export function iniciarTema(): Tema {
  const guardado = leerGuardado();
  if (guardado) document.documentElement.dataset["theme"] = guardado;
  return temaActual();
}

export function alternarTema(): Tema {
  const siguiente: Tema = temaActual() === "dark" ? "light" : "dark";
  document.documentElement.dataset["theme"] = siguiente;
  guardar(siguiente);
  return siguiente;
}
