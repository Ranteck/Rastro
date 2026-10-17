import type { Cambio } from "../../../backend/src/contract/cambios.ts";
import { ErrorApi, type PlanQueViene, type RespuestaCambios, type SinDaily } from "../api.ts";
import { h } from "./dom.ts";

export interface Edicion {
  /**
   * Pide la vista previa de estos cambios y la muestra en `lugar`; `origen` recupera el foco al cancelar.
   * Si `origen` lleva `data-foco`, esa clave le dice a la app dónde dejar el foco tras aplicar, porque el repintado reemplaza el control.
   */
  proponer(cambios: readonly Cambio[], lugar: HTMLElement, origen: HTMLElement, previa?: VistaPreviaDada): void;
  /** Cierra sin mandar nada la vista previa que esté en `lugar`: lo que se previsualizó dejó de coincidir con el formulario. */
  cancelar(lugar: HTMLElement): void;
}

/** Cuando quien propone ya tiene la vista previa (el chat), el panel no la pide y solo espera la confirmación. */
export interface VistaPreviaDada {
  lineas: readonly string[];
  /** La propuesta se volvió a montar: las líneas pueden ser de un plan viejo, así que se pide otra vista previa antes de habilitar la confirmación. */
  revalidar?: boolean;
  /** Textos de las acciones, para que el panel hable el idioma de quien propone. */
  confirmar: string;
  cancelar: string;
  /** La propuesta quedó resuelta (aplicada, descartada o con resultado dudoso) y no hay que volver a ofrecerla. */
  alResolver(): void;
  /** Avisa cuándo "Aplicar" está en vuelo, para que quien propone no escriba mientras se confirma. */
  enConfirmacion(activa: boolean): void;
}

/** Lo que una vista necesita además del snapshot: sin `edicion` es de solo lectura. `repos` son los registrados en el central, también los que aún no aparecen en el snapshot. */
export interface ContextoVista {
  edicion: Edicion | null;
  repos: readonly string[];
  /** Presente solo antes del primer `rastro daily`: las vistas muestran lo que se puede sin él. */
  sinDaily?: SinDaily;
  /** Esta semana no tiene plan, la que viene sí. */
  queViene?: PlanQueViene;
}

export const SOLO_LECTURA: ContextoVista = { edicion: null, repos: [] };

export interface OpcionesEdicion {
  enviar(cambios: readonly Cambio[], confirmar: boolean): Promise<RespuestaCambios>;
  /** Vuelve a pedir el snapshot y repinta la vista actual; `foco` es la clave `data-foco` del control que debe quedar enfocado. Devuelve `false` si no pudo repintar. */
  alAplicar(foco: string | undefined): Promise<boolean>;
  /** Escribe en la región `aria-live` que sobrevive al repintado; con `fijo` el mensaje sigue hasta que una vista se pinte bien. */
  anunciar(mensajes: readonly string[], fijo?: boolean): void;
}

const ERROR_GENERICO = "No pude enviar el cambio";
const NO_SE_SI_SE_APLICO = "No sé si el cambio se aplicó: actualicé la vista con lo que hay en el plan.";
const NO_SE_SI_SE_APLICO_SIN_VISTA = "No sé si el cambio se aplicó y no pude actualizar la vista: recargá cuando el central vuelva.";

/** Con red caída, 5xx o respuesta ilegible el central pudo haber escrito el plan antes de fallar; con 400 o 403 seguro que no. */
const esResultadoDudoso = (error: unknown): boolean => error instanceof ErrorApi && (error.tipo === "central" || error.tipo === "contrato");

export function mensajeDe(error: unknown): string {
  // Único punto donde se registra la causa; al usuario solo le llega el mensaje.
  if (error instanceof ErrorApi) {
    console.error(error.message, error.cause);
    return error.message;
  }
  console.error(ERROR_GENERICO, error);
  return ERROR_GENERICO;
}

/** Cambio, vista previa y confirmación: el único camino por el que la interfaz modifica el plan. Un solo panel abierto a la vez. */
export function crearEdicion(o: OpcionesEdicion): Edicion {
  let actual: { lugar: HTMLElement; cerrar: () => void; confirmando: () => boolean } | null = null;

  return {
    cancelar(lugar) {
      if (actual?.lugar === lugar && !actual.confirmando()) actual.cerrar();
    },

    proponer(cambios, lugar, origen, previa) {
      actual?.cerrar();
      const foco = origen.dataset["foco"];

      // "vista" pide la vista previa y "confirmar" aplica: con cualquiera en vuelo los botones quedan quietos.
      let enVuelo: "vista" | "confirmar" | null = null;
      let abierto = true;
      const vistaDada = previa !== undefined && previa.revalidar !== true;
      let hayVista = vistaDada;

      const lineas = h("ul", { class: "edicion-lineas dato" });
      const estado = h("p", { class: "etiqueta meta edicion-estado" }, vistaDada ? "" : "Calculando…");
      const error = h("p", { class: "edicion-error", role: "alert" });
      const confirmar = h("button", { type: "button", class: "boton boton-primario", onclick: () => void confirmarCambio() }, previa?.confirmar ?? "Confirmar");
      const reintentar = h("button", { type: "button", class: "boton", onclick: () => void pedirVista() }, "Reintentar");
      const cancelar = h("button", { type: "button", class: "boton", onclick: descartar }, previa?.cancelar ?? "Cancelar");
      const panel = h(
        "div",
        { class: "edicion-panel", role: "group", "aria-label": "Vista previa del cambio", tabindex: "-1" },
        h("p", { class: "etiqueta meta" }, "Vista previa"),
        estado,
        lineas,
        error,
        h("div", { class: "edicion-acciones" }, confirmar, reintentar, cancelar),
      );

      function pintarBotones(): void {
        confirmar.disabled = enVuelo !== null || !hayVista;
        cancelar.disabled = enVuelo === "confirmar";
        reintentar.disabled = enVuelo !== null;
        reintentar.hidden = hayVista || enVuelo === "vista" || error.textContent === "";
      }

      function descartar(): void {
        cerrar(true);
        previa?.alResolver();
      }

      function cerrar(devolverFoco: boolean): void {
        if (!abierto) return;
        abierto = false;
        panel.remove();
        contenedor.removeEventListener("keydown", alTeclear);
        if (actual === este) actual = null;
        if (devolverFoco && origen.isConnected) origen.focus();
      }

      async function pedirVista(): Promise<void> {
        enVuelo = "vista";
        error.textContent = "";
        estado.textContent = "Calculando…";
        pintarBotones();
        try {
          const r = await o.enviar(cambios, false);
          if (!abierto) return;
          lineas.replaceChildren(...r.vistaPrevia.map((linea) => h("li", {}, linea)));
          estado.textContent = "";
          hayVista = true;
        } catch (causa) {
          if (!abierto) return;
          estado.textContent = "";
          error.textContent = mensajeDe(causa);
        } finally {
          enVuelo = null;
          if (abierto) pintarBotones();
        }
      }

      async function confirmarCambio(): Promise<void> {
        if (enVuelo !== null || !hayVista) return;
        enVuelo = "confirmar";
        previa?.enConfirmacion(true);
        error.textContent = "";
        pintarBotones();
        let r: RespuestaCambios;
        try {
          r = await o.enviar(cambios, true);
        } catch (causa) {
          enVuelo = null;
          previa?.enConfirmacion(false);
          const mensaje = mensajeDe(causa);
          if (esResultadoDudoso(causa)) {
            // No se ofrece reintentar a ciegas: un reintento de un ofrecimiento ya aceptado daría un 400 confuso.
            // Se cierra antes de resolver: quien propone cancela por `cancelar`, que cerraría el panel sin devolver el foco.
            cerrar(false);
            previa?.alResolver();
            const repintada = await o.alAplicar(foco);
            if (repintada) o.anunciar([NO_SE_SI_SE_APLICO]);
            else o.anunciar([NO_SE_SI_SE_APLICO_SIN_VISTA], true);
          } else if (abierto) {
            error.textContent = mensaje;
            pintarBotones();
          }
          return;
        }
        enVuelo = null;
        previa?.enConfirmacion(false);
        // Lo aplicado puede diferir de lo que se mostró (el reparto de otras tareas): se anuncia lo que devolvió el central.
        o.anunciar([
          r.aplicado ? "Cambio aplicado." : "No se aplicó ningún cambio.",
          ...(r.aplicado ? r.vistaPrevia : []),
          ...(r.aviso === undefined ? [] : [r.aviso]),
        ]);
        cerrar(!r.aplicado);
        previa?.alResolver();
        if (r.aplicado) await o.alAplicar(foco);
      }

      // En el contenedor y no en el panel: Escape también cancela con el foco de vuelta en el formulario.
      // Con la vista previa dada (el chat) el contenedor incluye la entrada de texto, donde Escape no debe descartar nada: ahí solo cuenta el panel.
      const contenedor = previa === undefined ? (lugar.parentElement ?? lugar) : panel;
      function alTeclear(e: KeyboardEvent): void {
        if (e.key !== "Escape" || enVuelo === "confirmar") return;
        e.preventDefault();
        descartar();
      }
      contenedor.addEventListener("keydown", alTeclear);

      const este = { lugar, cerrar: () => cerrar(false), confirmando: () => enVuelo === "confirmar" };
      actual = este;
      lugar.replaceChildren(panel);
      lineas.replaceChildren(...(vistaDada ? previa.lineas : []).map((linea) => h("li", {}, linea)));
      pintarBotones();
      panel.focus();
      if (!vistaDada) void pedirVista();
    },
  };
}
