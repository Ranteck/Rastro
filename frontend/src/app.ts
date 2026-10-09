import type { FilaEquipo } from "../../backend/src/contract/equipo.ts";
import type { Snapshot } from "../../backend/src/contract/snapshot.ts";
import { ErrorApi, type Api } from "./api.ts";
import { parsearRuta, type Ruta, type VistaPersona } from "./router.ts";
import { montarShell, pintarNavegacion } from "./shell.ts";
import { cargando, errorCentral, paginaNoEncontrada, personaInexistente } from "./ui/estado.ts";

export interface Vistas {
  equipo?: (filas: FilaEquipo[]) => Node;
  persona: Partial<Record<VistaPersona, (snapshot: Snapshot) => Node>>;
}

export interface OpcionesApp {
  raiz: HTMLElement;
  api: Api;
  vistas: Vistas;
}

const MENSAJE_VISTA = "No pude mostrar esta vista";

/** Monta la app y devuelve la función que quita sus listeners. */
export function montarApp({ raiz, api, vistas }: OpcionesApp): () => void {
  const contenido = montarShell(raiz);
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
    pintarNavegacion(raiz, ruta, nombreCargado(ruta));

    const mostrar = (nodo: Node): void => {
      if (turno !== navegacion) return;
      contenido.replaceChildren(nodo);
      // Sin esto, al reemplazar el contenido el foco del teclado cae al body.
      if (enfocar) contenido.focus();
    };
    const reintentar = (): void => void pintar(ruta, true);

    const vistaPersona = ruta.tipo === "persona" ? vistas.persona[ruta.vista] : undefined;
    const vistaEquipo = ruta.tipo === "equipo" ? vistas.equipo : undefined;
    if (!vistaPersona && !vistaEquipo) {
      mostrar(paginaNoEncontrada());
      return;
    }

    mostrar(cargando());
    try {
      if (ruta.tipo === "persona" && vistaPersona) {
        const snapshot = await resolverPersona(ruta.id);
        if (turno !== navegacion) return;
        pintarNavegacion(raiz, ruta, snapshot.persona.nombre);
        mostrar(vistaPersona(snapshot));
      } else if (vistaEquipo) {
        const filas = await api.cargarEquipo();
        if (turno !== navegacion) return;
        mostrar(vistaEquipo(filas));
      }
    } catch (error) {
      if (error instanceof ErrorApi) {
        // Único punto donde se registra la causa; al usuario solo le llega el mensaje.
        console.error(error.message, error.cause);
        mostrar(error.tipo === "no-encontrada" ? personaInexistente(error.mensajeUsuario) : errorCentral(error.mensajeUsuario, reintentar));
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
