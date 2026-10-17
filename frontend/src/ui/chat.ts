import type { Cambio } from "../../../backend/src/contract/cambios.ts";
import { MAX_MENSAJE } from "../../../backend/src/contract/chat.ts";
import type { Api, InfoChat } from "../api.ts";
import { copiar } from "./copiar.ts";
import { h } from "./dom.ts";
import { mensajeDe, type Edicion } from "./edicion.ts";

/**
 * El contador aparece cerca del límite y la región viva solo se reescribe al cruzar estos umbrales:
 * un lector de pantalla anunciaría cada tecla si cambiara con cada carácter.
 */
const UMBRALES: readonly { desde: number; aviso: string }[] = [
  { desde: 3600, aviso: "Quedan menos de 400 caracteres." },
  { desde: 3900, aviso: "Quedan menos de 100 caracteres." },
  { desde: MAX_MENSAJE, aviso: `Llegaste al límite de ${MAX_MENSAJE} caracteres.` },
  { desde: MAX_MENSAJE + 1, aviso: `Superaste el límite de ${MAX_MENSAJE} caracteres.` },
];

const PENSANDO = "Pensando… puede tardar hasta tres minutos.";
const LISTO = "Rastro respondió.";
const DESCARTADA = "Descarté la propuesta anterior.";
const ESTADO_MS = 5000;
const MENSAJE_VACIO = "Escribí un mensaje antes de enviar.";
const CHAT_NO_RESPONDIO = "El chat no pudo responder: mirá en Chat.";
const MENSAJE_LARGO = `El mensaje supera los ${MAX_MENSAJE} caracteres: acortalo para enviarlo.`;

type Rol = "vos" | "rastro" | "aviso";
const ETIQUETAS: Record<Rol, string> = { vos: "VOS", rastro: "RASTRO", aviso: "AVISO" };

interface Entrada {
  rol: Rol;
  texto: string;
}

interface Propuesta {
  cambios: readonly Cambio[];
  vistaPrevia: readonly string[];
}

/**
 * La conversación de la página: la crea `montarApp` y vive mientras la página esté abierta, así cambiar de pestaña no la pierde.
 * Nunca toca el almacenamiento del navegador. Es estado plano; las funciones de este módulo lo mutan y avisan a la vista montada.
 */
export interface Conversacion {
  readonly entradas: Entrada[];
  propuesta: Propuesta | null;
  /** Lo escrito y todavía no enviado: sobrevive al cambio de pestaña y a un envío fallido. */
  borrador: string;
  enviando: boolean;
  estado: string;
  error: string;
  /** `undefined` mientras no se pidió; `null` si todavía no hay sesión esta semana. */
  sesion: InfoChat | undefined;
  /** "Aplicar" en vuelo: hasta que termine no se escribe, porque el resultado de esa escritura al plan no puede perderse. */
  aplicando: boolean;
  /** La vista montada; con otra pestaña abierta una respuesta solo actualiza el estado y se anuncia. */
  vista: VistaMontada | null;
}

interface VistaMontada {
  raiz: HTMLElement;
  lugar: HTMLElement;
  sincronizar(): void;
  irARespuesta(): void;
}

export function crearConversacion(): Conversacion {
  return { entradas: [], propuesta: null, borrador: "", enviando: false, estado: "", error: "", sesion: undefined, aplicando: false, vista: null };
}

export interface ContextoChat {
  conversacion: Conversacion;
  api: Pick<Api, "enviarMensaje" | "cargarChat">;
  edicion: Edicion;
  /** Escribe en la región `aria-live` que sobrevive al cambio de pestaña. */
  anunciar(mensajes: readonly string[]): void;
}

async function actualizarSesion({ conversacion: c, api }: ContextoChat): Promise<void> {
  try {
    c.sesion = await api.cargarChat();
  } catch (error) {
    // El chat funciona sin el comando para retomar: se registra la causa y la vista sigue sin mostrarlo.
    console.error("No pude cargar la sesión del chat", error);
  }
  c.vista?.sincronizar();
}

async function enviar(contexto: ContextoChat, texto: string): Promise<void> {
  const { conversacion: c, api, anunciar } = contexto;
  if (c.enviando || c.aplicando) return;
  const mensaje = texto.trim();
  if (mensaje === "") {
    c.error = MENSAJE_VACIO;
    c.vista?.sincronizar();
    return;
  }
  if (mensaje.length > MAX_MENSAJE) {
    c.error = MENSAJE_LARGO;
    c.vista?.sincronizar();
    return;
  }

  // Lo propuesto quedó viejo respecto del mensaje nuevo: la vista lo descarta por `edicion` al sincronizar y se dice.
  const descartada = c.propuesta !== null;
  c.enviando = true;
  c.error = "";
  c.estado = PENSANDO;
  c.borrador = "";
  c.propuesta = null;
  c.entradas.push({ rol: "vos", texto: mensaje });
  c.vista?.sincronizar();
  try {
    const r = await api.enviarMensaje(mensaje);
    if (r.aviso !== undefined) c.entradas.push({ rol: "aviso", texto: r.aviso });
    c.entradas.push({ rol: "rastro", texto: r.respuesta });
    c.propuesta = r.cambios.length > 0 ? { cambios: r.cambios, vistaPrevia: r.vistaPrevia } : null;
    c.estado = descartada ? `${DESCARTADA} ${LISTO}` : LISTO;
  } catch (causa) {
    // Lo que no salió vuelve a la entrada para reintentar, y la conversación queda como estaba.
    c.entradas.pop();
    c.borrador = mensaje;
    c.estado = descartada ? DESCARTADA : "";
    c.error = mensajeDe(causa);
  } finally {
    c.enviando = false;
  }
  c.vista?.sincronizar();
  const enPantalla = c.vista?.raiz.isConnected === true;
  // Todo estado ya se anunció: dejarlo para siempre ensucia la lámina.
  if (c.estado !== "") {
    const estadoFinal = c.estado;
    setTimeout(() => {
      if (c.estado !== estadoFinal) return;
      c.estado = "";
      c.vista?.sincronizar();
    }, ESTADO_MS);
  }
  if (c.error !== "") {
    // Al volver a la pestaña el error se limpia al montar: sin este anuncio quien se fue a otra pestaña no se entera.
    if (!enPantalla) anunciar([CHAT_NO_RESPONDIO]);
    return;
  }
  if (enPantalla) c.vista?.irARespuesta();
  else anunciar([`Rastro respondió en Chat.${c.propuesta === null ? "" : " Hay un cambio propuesto para aplicar."}`]);
  await actualizarSesion(contexto);
}

export function vistaChat(contexto: ContextoChat): HTMLElement {
  const { conversacion: c, edicion } = contexto;

  const lista = h("ol", { class: "chat-entradas", "aria-label": "Conversación" });
  const sesion = h("div", { class: "chat-sesion" });
  const lugar = h("div", { class: "edicion-lugar" });
  const estado = h("p", { class: "etiqueta meta chat-estado", role: "status" });
  const error = h("p", { class: "edicion-error", role: "alert" });
  // El número exacto no es región viva; solo el aviso, que cambia al cruzar un umbral.
  const contadorNumero = h("span", { class: "chat-contador-numero" });
  const contadorAviso = h("span", { class: "chat-contador-aviso", "aria-live": "polite" });
  const contador = h("p", { class: "etiqueta meta chat-contador", id: "chat-contador" }, contadorNumero, contadorAviso);
  const entrada = h("textarea", {
    id: "chat-entrada",
    class: "chat-entrada",
    rows: 4,
    "data-foco": "chat-entrada",
    "aria-describedby": "chat-contador chat-atajo",
  });
  // En táctil no hay Mayús+Enter: Enter salta de línea y se envía con el botón.
  const esPunteroFino = (): boolean => window.matchMedia("(pointer: fine)").matches;
  const atajo = h("p", { class: "etiqueta meta chat-atajo", id: "chat-atajo" });
  const textoAtajo = (): string => (esPunteroFino() ? "Enter envía; Mayús+Enter salta de línea" : "Enter salta de línea; el botón Enviar envía");
  atajo.textContent = textoAtajo();
  const enviarBoton = h("button", { type: "submit", class: "boton" }, "Enviar");
  const formulario = h(
    "form",
    { class: "chat-formulario", novalidate: true },
    h("label", { class: "etiqueta", for: "chat-entrada" }, "Tu mensaje"),
    entrada,
    contador,
    atajo,
    enviarBoton,
  );
  const raiz = h(
    "section",
    { class: "chat", "aria-label": "Chat" },
    h("h1", { class: "titulo" }, "Chat"),
    h(
      "p",
      { class: "cuerpo meta chat-avisos" },
      "Cada mensaje usa tu cuenta de Claude. Mientras esperás una respuesta, no escribas en la misma sesión desde la terminal.",
    ),
    sesion,
    lista,
    lugar,
    estado,
    error,
    formulario,
  );

  let montando = true;
  let mostrada: Propuesta | null = null;
  let volverAlFoco = false;
  let sesionPintada: InfoChat | undefined;
  let listaPintada = "";

  function pintarSesion(): void {
    // Reconstruir el bloque a cada sincronización le sacaría el foco a "Copiar".
    if (c.sesion?.retomar === sesionPintada?.retomar) return;
    sesionPintada = c.sesion;
    if (c.sesion === undefined || c.sesion === null) {
      sesion.replaceChildren();
      return;
    }
    const aviso = h("span", { class: "etiqueta copiar-aviso", "aria-live": "polite" });
    sesion.replaceChildren(
      h("p", { class: "etiqueta meta" }, "Retomá esta conversación en la terminal"),
      h("code", { class: "dato chat-comando" }, c.sesion.retomar),
      h("div", { class: "bloque-acciones" }, h("button", { type: "button", class: "boton", onclick: copiar(c.sesion.retomar, aviso) }, "Copiar"), aviso),
    );
  }

  function pintarLista(): void {
    // Las entradas solo suman o se retiran: reconstruir la lista sin cambios soltaría el renglón al que se está desplazando.
    const clave = c.entradas.length === 0 ? `vacio:${c.sesion ? "con-sesion" : "sin-sesion"}` : String(c.entradas.length);
    if (clave === listaPintada) return;
    listaPintada = clave;
    if (c.entradas.length === 0) {
      const sigue = c.sesion ? " La sesión sigue abierta y Claude recuerda lo anterior." : "";
      lista.replaceChildren(h("li", { class: "chat-vacio meta cuerpo" }, `Todavía no hay mensajes en esta página.${sigue}`));
      return;
    }
    lista.replaceChildren(
      ...c.entradas.map((e) =>
        h("li", { class: `chat-entrada-fila chat-${e.rol}` }, h("span", { class: "etiqueta" }, ETIQUETAS[e.rol]), h("div", { class: "chat-texto" }, e.texto)),
      ),
    );
  }

  function pintarPropuesta(): void {
    if (c.propuesta === mostrada) return;
    mostrada = c.propuesta;
    if (mostrada === null) {
      edicion.cancelar(lugar);
      return;
    }
    edicion.proponer(mostrada.cambios, lugar, entrada, {
      lineas: mostrada.vistaPrevia,
      // Al montar la vista, una propuesta que ya estaba pudo quedar vieja: el plan cambió desde Plan o la terminal.
      revalidar: montando,
      confirmar: "Aplicar",
      cancelar: "Descartar",
      alResolver: () => {
        c.propuesta = null;
        c.vista?.sincronizar();
      },
      enConfirmacion: (activa) => {
        c.aplicando = activa;
        c.vista?.sincronizar();
      },
    });
  }

  function pintarEntrada(): void {
    // Deshabilitar la entrada le quita el foco: al terminar la espera, la persona sigue donde estaba.
    const bloqueada = c.enviando || c.aplicando;
    if (bloqueada && !entrada.disabled) volverAlFoco = document.activeElement === entrada || document.activeElement === enviarBoton;
    entrada.disabled = bloqueada;
    enviarBoton.disabled = bloqueada;
    // Con una propuesta abierta el primario es "Aplicar".
    enviarBoton.classList.toggle("boton-primario", c.propuesta === null);
    const largo = entrada.value.length;
    // La región viva existe siempre y queda vacía bajo el primer umbral: una que aparece de golpe no siempre se anuncia.
    const primero = UMBRALES[0]?.desde ?? MAX_MENSAJE;
    const numero = largo < primero ? "" : `${largo} / ${MAX_MENSAJE}`;
    if (contadorNumero.textContent !== numero) contadorNumero.textContent = numero;
    const aviso = UMBRALES.findLast((u) => largo >= u.desde)?.aviso ?? "";
    if (contadorAviso.textContent !== aviso) contadorAviso.textContent = aviso;
    if (!bloqueada && volverAlFoco && c.propuesta === null) {
      volverAlFoco = false;
      entrada.focus({ preventScroll: true });
    }
  }

  function sincronizar(): void {
    // Los textos fijos solo se reescriben si cambian: repetirlos haría que el lector de pantalla los vuelva a anunciar.
    if (estado.textContent !== c.estado) estado.textContent = c.estado;
    if (error.textContent !== c.error) error.textContent = c.error;
    if (entrada.value !== c.borrador) entrada.value = c.borrador;
    pintarSesion();
    pintarLista();
    pintarPropuesta();
    pintarEntrada();
  }

  entrada.value = c.borrador;
  entrada.addEventListener("input", () => {
    c.borrador = entrada.value;
    pintarEntrada();
  });
  entrada.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || !esPunteroFino()) return;
    e.preventDefault();
    void enviar(contexto, entrada.value);
  });
  formulario.addEventListener("submit", (e) => {
    e.preventDefault();
    void enviar(contexto, entrada.value);
  });

  // Una vista que dejó de estar en el documento no repinta: tocaría el panel de otra edición.
  const vista: VistaMontada = {
    raiz,
    lugar,
    sincronizar() {
      if (!raiz.isConnected) {
        if (c.vista === vista) c.vista = null;
        return;
      }
      sincronizar();
    },
    irARespuesta() {
      // Sin esto la respuesta nueva queda con su comienzo al borde de abajo y hay que bajarla a mano.
      const ultima = [...lista.querySelectorAll(".chat-rastro")].at(-1);
      const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      ultima?.scrollIntoView({ block: "start", behavior: sinMovimiento ? "auto" : "smooth" });
    },
  };
  // El error y el estado ya se mostraron: al volver a la pestaña no se vuelven a anunciar.
  if (!c.enviando) {
    c.error = "";
    c.estado = "";
  }
  c.vista = vista;
  sincronizar();
  montando = false;
  if (c.sesion === undefined) void actualizarSesion(contexto);
  return raiz;
}
