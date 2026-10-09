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

export function montarApp({ raiz, api, vistas }: OpcionesApp): void {
  const contenido = montarShell(raiz);
  let navegacion = 0;
  let personaCargada: { id: string; snapshot: Snapshot } | null = null;

  async function resolverPersona(id: string): Promise<Snapshot> {
    if (personaCargada?.id === id) return personaCargada.snapshot;
    const snapshot = await api.cargarPersona(id);
    personaCargada = { id, snapshot };
    return snapshot;
  }

  async function pintar(ruta: Ruta): Promise<void> {
    const turno = ++navegacion;
    const vigente = (): boolean => turno === navegacion;
    pintarNavegacion(raiz, ruta, personaCargada?.id === (ruta.tipo === "persona" ? ruta.id : null) ? personaCargada?.snapshot.persona.nombre : undefined);

    const mostrar = (nodo: Node): void => {
      if (vigente()) contenido.replaceChildren(nodo);
    };
    const reintentar = (): void => void pintar(ruta);
    const fallar = (error: unknown): void => {
      if (error instanceof ErrorApi) {
        mostrar(error.tipo === "no-encontrada" ? personaInexistente(error.mensajeUsuario) : errorCentral(error.mensajeUsuario, reintentar));
        return;
      }
      throw error;
    };

    if (ruta.tipo === "equipo" && vistas.equipo) {
      const vista = vistas.equipo;
      mostrar(cargando());
      await api.cargarEquipo().then((filas) => mostrar(vista(filas)), fallar);
    } else if (ruta.tipo === "persona" && vistas.persona[ruta.vista]) {
      const vista = vistas.persona[ruta.vista];
      if (!vista) return;
      mostrar(cargando());
      await resolverPersona(ruta.id).then((snapshot) => {
        pintarNavegacion(raiz, ruta, snapshot.persona.nombre);
        mostrar(vista(snapshot));
      }, fallar);
    } else {
      mostrar(paginaNoEncontrada());
    }
  }

  const alCambiarHash = (): void => void pintar(parsearRuta(window.location.hash));
  window.addEventListener("hashchange", alCambiarHash);
  alCambiarHash();
}
