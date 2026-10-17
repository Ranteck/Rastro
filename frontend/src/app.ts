import type { FilaEquipo } from "../../backend/src/contract/equipo.ts";
import type { Snapshot } from "../../backend/src/contract/snapshot.ts";
import { ErrorApi, type Api, type PersonaCargada, type Sesion } from "./api.ts";
import { hashDe, parsearRuta, type Ruta, type VistaSnapshot } from "./router.ts";
import { montarShell, pintarNavegacion } from "./shell.ts";
import { crearConversacion, vistaChat } from "./ui/chat.ts";
import { crearEdicion, SOLO_LECTURA, type ContextoVista } from "./ui/edicion.ts";
import { h } from "./ui/dom.ts";
import { cargando, errorCentral, paginaNoEncontrada, personaInexistente, SALIDA_EQUIPO, type Salida } from "./ui/estado.ts";

export interface Vistas {
  equipo: (filas: FilaEquipo[]) => Node;
  persona: Record<VistaSnapshot, (snapshot: Snapshot, contexto: ContextoVista) => Node>;
  chat: typeof vistaChat;
}

export interface OpcionesApp {
  raiz: HTMLElement;
  api: Api;
  vistas: Vistas;
  /** Marca la barra con la etiqueta de datos de demostración. */
  modoEjemplos?: boolean;
}

const MENSAJE_VISTA = "No pude mostrar esta vista";
/** Cuánto dura un anuncio de éxito: la tira pegada bajo la barra se come el alto útil, sobre todo en el teléfono. */
const ANUNCIO_MS = 6000;
const SESION_FALLIDA = "No pude confirmar tu sesión: las vistas quedan de solo lectura";

/** Monta la app y devuelve la función que quita sus listeners. */
export function montarApp({ raiz, api, vistas, modoEjemplos = false }: OpcionesApp): () => void {
  const contenido = montarShell(raiz, modoEjemplos);
  let navegacion = 0;
  const anuncio = raiz.querySelector<HTMLElement>(".anuncio");
  let personaCargada: { id: string; snapshot: PersonaCargada } | null = null;
  let sesion: Sesion | null = null;
  let sesionFallida = false;
  // Por carga de página: cambiar de pestaña conserva la conversación y recargar la vacía.
  const conversacion = crearConversacion();

  // Un anuncio fijo sobrevive a "Reintentar" hasta que alguna vista se pinte bien: avisa algo que la vista nueva no puede saber.
  let anuncioFijo = false;

  /** El anuncio es sticky bajo la barra: su alto se publica para que `scroll-padding-top` no deje un control enfocado debajo de él. */
  const medirAnuncio = (): void => document.documentElement.style.setProperty("--anuncio-alto", `${anuncio?.offsetHeight ?? 0}px`);
  const ponerAnuncio = (nodos: readonly Node[]): void => {
    anuncio?.replaceChildren(...nodos);
    medirAnuncio();
  };
  let retiro: ReturnType<typeof setTimeout> | undefined;
  const mostrarAnuncio = (mensajes: readonly string[], fijo: boolean, seRetira: boolean): void => {
    anuncioFijo = fijo;
    clearTimeout(retiro);
    ponerAnuncio(mensajes.map((m) => h("p", {}, m)));
    if (!seRetira) return;
    const emitido = anuncio?.textContent;
    // Se compara el texto: un anuncio posterior con otro contenido no debe borrarse por el temporizador del anterior.
    retiro = setTimeout(() => {
      if (anuncio?.textContent === emitido) ponerAnuncio([]);
    }, ANUNCIO_MS);
  };
  // Los de éxito se retiran solos; los de falla quedan hasta que una vista se pinte bien.
  const anunciar = (mensajes: readonly string[], fijo = false): void => mostrarAnuncio(mensajes, fijo, !fijo);

  const edicion = crearEdicion({
    enviar: (cambios, confirmar) => api.enviarCambios(cambios, confirmar),
    alAplicar: (foco) => {
      // El central ya recalculó state.json: el caché viejo mostraría el plan de antes del cambio.
      personaCargada = null;
      return pintar(parsearRuta(window.location.hash), false, true, foco);
    },
    anunciar,
  });

  /** Sin sesión personal (equipo, ejemplos, central sin `--repo` o caído) las vistas son de solo lectura. */
  async function resolverSesion(): Promise<Sesion> {
    if (sesion !== null) return sesion;
    try {
      sesion = await api.cargarSesion();
      sesionFallida = false;
      return sesion;
    } catch (error) {
      // No cacheado: la próxima vista vuelve a intentar. Sin sesión no se edita, pero leer sigue funcionando;
      // el aviso al usuario lo da `pintar` solo si la persona cargó, para no sumar ruido a un central caído.
      console.error("No pude cargar la sesión del central", error);
      sesionFallida = true;
      return { personal: false };
    }
  }

  const contextoDe = (s: Sesion, snapshot: PersonaCargada): ContextoVista => {
    const base = s.personal && s.persona.id === snapshot.persona.id ? { edicion, repos: s.repos } : SOLO_LECTURA;
    return { ...base, ...(snapshot.sinDaily === undefined ? {} : { sinDaily: snapshot.sinDaily }), ...(snapshot.queViene === undefined ? {} : { queViene: snapshot.queViene }) };
  };

  /** El modo personal no tiene vista Equipo (el modo equipo está en pausa): sin sesión personal, con equipo o sin central, sigue como siempre. */
  const conEquipo = (): boolean => sesion?.personal !== true;
  const navegar = (ruta: Ruta, nombre?: string, conChat = false): void => pintarNavegacion(raiz, ruta, nombre, conChat, conEquipo());
  /** A dónde vuelve quien se perdió: a Mi día en el modo personal, que no tiene Equipo. */
  const salidaDe = (): Salida => (sesion?.personal === true ? { texto: "Mi día", hash: hashDe({ tipo: "persona", id: sesion.persona.id, vista: "mi-dia" }) } : SALIDA_EQUIPO);

  /** El chat es solo de la persona dueña del repo: viendo a otra, o sin sesión personal, la pestaña no existe. */
  const esChatPropio = (s: Sesion | null, ruta: Ruta): boolean => s?.personal === true && ruta.tipo === "persona" && s.persona.id === ruta.id;

  async function resolverPersona(id: string): Promise<PersonaCargada> {
    if (personaCargada?.id === id) return personaCargada.snapshot;
    const snapshot = await api.cargarPersona(id);
    personaCargada = { id, snapshot };
    return snapshot;
  }

  function nombreCargado(ruta: Ruta): string | undefined {
    return ruta.tipo === "persona" && personaCargada?.id === ruta.id ? personaCargada.snapshot.persona.nombre : undefined;
  }

  /** Deja el foco en el control `data-foco` que sigue existiendo tras la edición, o en el anuncio: nunca al inicio de `main`. */
  function enfocarTrasEditar(foco: string | undefined): void {
    const destino = [...contenido.querySelectorAll<HTMLElement>("[data-foco]")].find((el) => el.dataset["foco"] === foco);
    (destino ?? anuncio)?.focus({ preventScroll: true });
  }

  /** `recargar` repinta la misma vista tras una edición: sin "Cargando…" ni salto al inicio, y conserva el anuncio. Devuelve si la vista quedó pintada. */
  async function pintar(ruta: Ruta, enfocar: boolean, recargar = false, foco?: string): Promise<boolean> {
    const turno = ++navegacion;
    if (!recargar && !anuncioFijo) ponerAnuncio([]);
    // El caché sirve solo para cambiar de pestaña: volver a una persona o a Equipo pide datos nuevos.
    if (ruta.tipo !== "persona") personaCargada = null;
    const mostrar = (nodo: Node): void => {
      if (turno !== navegacion) return;
      contenido.replaceChildren(nodo);
      // Sin esto, al reemplazar el contenido el foco del teclado cae al body.
      if (recargar) enfocarTrasEditar(foco);
      else if (enfocar) {
        contenido.focus({ preventScroll: true });
        if (!recargar) window.scrollTo(0, 0);
      }
    };

    // La sesión decide si hay pestaña Equipo: se resuelve antes de pintar la navegación para que no aparezca y desaparezca.
    if (!recargar && sesion === null) mostrar(cargando());
    const inicial = await resolverSesion();
    if (turno !== navegacion) return true;
    if (inicial.personal && ruta.tipo === "equipo") {
      // En el modo personal la ruta por defecto es Mi día; se reemplaza el hash para que "atrás" no vuelva a una vista que no existe.
      const miDia = { tipo: "persona", id: inicial.persona.id, vista: "mi-dia" } as const;
      history.replaceState(null, "", hashDe(miDia));
      return pintar(miDia, enfocar, recargar, foco);
    }
    navegar(ruta, nombreCargado(ruta), esChatPropio(sesion, ruta));

    const reintentar = (): void => void pintar(ruta, true);

    const pintada = (): true => {
      if (anuncioFijo) {
        anuncioFijo = false;
        ponerAnuncio([]);
      }
      return true;
    };

    if (ruta.tipo === "desconocida") {
      mostrar(paginaNoEncontrada(salidaDe()));
      return pintada();
    }

    if (!recargar) mostrar(cargando());
    try {
      if (ruta.tipo === "persona" && ruta.vista === "chat") {
        // No necesita el snapshot: sirve aunque todavía no haya un `rastro daily`.
        const actual = await resolverSesion();
        if (turno !== navegacion) return true;
        if (!esChatPropio(actual, ruta)) {
          navegar(ruta, nombreCargado(ruta));
          // Sin sesión no se sabe si la ruta existe: no decir "no encontrada" por un central caído.
          mostrar(sesionFallida ? errorCentral(SESION_FALLIDA, reintentar) : paginaNoEncontrada(salidaDe()));
          return !sesionFallida;
        }
        navegar(ruta, actual.personal ? actual.persona.nombre : undefined, true);
        mostrar(vistas.chat({ conversacion, api, edicion, anunciar }));
      } else if (ruta.tipo === "persona" && ruta.vista !== "chat") {
        const [snapshot, actual] = await Promise.all([resolverPersona(ruta.id), resolverSesion()]);
        if (turno !== navegacion) return true;
        navegar(ruta, snapshot.persona.nombre, esChatPropio(actual, ruta));
        if (sesionFallida && !recargar) mostrarAnuncio([SESION_FALLIDA], false, false);
        mostrar(vistas.persona[ruta.vista](snapshot, contextoDe(actual, snapshot)));
      } else {
        const filas = await api.cargarEquipo();
        if (turno !== navegacion) return true;
        mostrar(vistas.equipo(filas));
      }
      return pintada();
    } catch (error) {
      // Para que Reintentar vuelva a pedir y no reuse un snapshot de antes del error.
      personaCargada = null;
      if (error instanceof ErrorApi) {
        if (error.tipo === "no-encontrada") {
          // Una persona inexistente es un rechazo esperado: no es un error del sistema.
          mostrar(personaInexistente(error.message, salidaDe()));
          return true;
        }
        // Único punto donde se registra la causa; al usuario solo le llega el mensaje.
        console.error(error.message, error.cause);
        mostrar(errorCentral(error.message, reintentar));
        return false;
      }
      console.error(MENSAJE_VISTA, error);
      mostrar(errorCentral(MENSAJE_VISTA, reintentar));
      return false;
    }
  }

  const alCambiarHash = (): void => void pintar(parsearRuta(window.location.hash), true);
  window.addEventListener("hashchange", alCambiarHash);
  // Al cambiar el ancho el texto del anuncio ocupa otro alto.
  window.addEventListener("resize", medirAnuncio);
  // Rotar el teléfono, el wrap del texto o la tipografía cambian el alto del anuncio sin disparar `resize`.
  const observador = anuncio === null ? null : new ResizeObserver(medirAnuncio);
  if (anuncio !== null) observador?.observe(anuncio);
  void pintar(parsearRuta(window.location.hash), false);
  return () => {
    clearTimeout(retiro);
    observador?.disconnect();
    window.removeEventListener("hashchange", alCambiarHash);
    window.removeEventListener("resize", medirAnuncio);
  };
}
