import type { FilaEquipo } from "../../backend/src/contract/equipo.ts";
import type { Snapshot } from "../../backend/src/contract/snapshot.ts";
import { ErrorApi, type Api } from "./api.ts";
import { parsearRuta, type Ruta, type VistaPersona } from "./router.ts";
import { montarShell, pintarNavegacion } from "./shell.ts";
import { cargando, errorCentral, paginaNoEncontrada, personaInexistente } from "./ui/estado.ts";

export interface Vistas {
  equipo: (filas: FilaEquipo[]) => Node;
  persona: Record<VistaPersona, (snapshot: Snapshot) => Node>;
}

export interface OpcionesApp {
  raiz: HTMLElement;
  api: Api;
  vistas: Vistas;
  /** En modo ejemplos solo hay detalle de Denis: el aviso de persona inexistente lo aclara. */
  modoEjemplos?: boolean;
}

const MENSAJE_VISTA = "No pude mostrar esta vista";
const DETALLE_EJEMPLOS = "En modo ejemplos solo Denis tiene detalle.";

/** Monta la app y devuelve la función que quita sus listeners. */
export function montarApp({ raiz, api, vistas, modoEjemplos = false }: OpcionesApp): () => void {
  const contenido = montarShell(raiz, modoEjemplos);
  let navegacion = 0;
  let personaCargada: { id: string; snapshot: Snapshot } | null = null;

  async function resolverPersona(id: string): Promise<Snapshot> {
    if (personaCargada?.id === id) return personaCargada.snapshot;
    const snapshot = await api.cargarPersona(id);
    personaCargada = { id, snapshot };
    return snapshot;
  }

  function nombreCargado(ruta: Ruta): string | undefined {
    return ruta.tipo === "persona" && personaCargada?.id === ruta.id ? personaCargada.snapshot.persona.nombre : undefined;
  }

  async function pintar(ruta: Ruta, enfocar: boolean): Promise<void> {
    const turno = ++navegacion;
    // El caché sirve solo para cambiar de pestaña: volver a una persona o a Equipo pide datos nuevos.
    if (ruta.tipo !== "persona") personaCargada = null;
    pintarNavegacion(raiz, ruta, nombreCargado(ruta));

    const mostrar = (nodo: Node): void => {
      if (turno !== navegacion) return;
      contenido.replaceChildren(nodo);
      // Sin esto, al reemplazar el contenido el foco del teclado cae al body.
      if (enfocar) {
        contenido.focus({ preventScroll: true });
        window.scrollTo(0, 0);
      }
    };
    const reintentar = (): void => void pintar(ruta, true);

    if (ruta.tipo === "desconocida") {
      mostrar(paginaNoEncontrada());
      return;
    }

    mostrar(cargando());
    try {
      if (ruta.tipo === "persona") {
        const snapshot = await resolverPersona(ruta.id);
        if (turno !== navegacion) return;
        pintarNavegacion(raiz, ruta, snapshot.persona.nombre);
        mostrar(vistas.persona[ruta.vista](snapshot));
      } else {
        const filas = await api.cargarEquipo();
        if (turno !== navegacion) return;
        mostrar(vistas.equipo(filas));
      }
    } catch (error) {
      // Para que Reintentar vuelva a pedir y no reuse un snapshot de antes del error.
      personaCargada = null;
      if (error instanceof ErrorApi) {
        if (error.tipo === "no-encontrada") {
          // Una persona inexistente es un rechazo esperado: no es un error del sistema.
          mostrar(personaInexistente(error.message, modoEjemplos ? DETALLE_EJEMPLOS : undefined));
          return;
        }
        // Único punto donde se registra la causa; al usuario solo le llega el mensaje.
        console.error(error.message, error.cause);
        mostrar(errorCentral(error.message, reintentar));
        return;
      }
      console.error(MENSAJE_VISTA, error);
      mostrar(errorCentral(MENSAJE_VISTA, reintentar));
    }
  }

  const alCambiarHash = (): void => void pintar(parsearRuta(window.location.hash), true);
  window.addEventListener("hashchange", alCambiarHash);
  void pintar(parsearRuta(window.location.hash), false);
  return () => window.removeEventListener("hashchange", alCambiarHash);
}
