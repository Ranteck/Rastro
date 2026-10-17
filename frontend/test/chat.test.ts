import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkEquipo } from "../../backend/src/contract/equipo.ts";
import { validarSnapshot } from "../../backend/src/contract/snapshot.ts";
import type { Cambio } from "../../backend/src/contract/cambios.ts";
import { crearApi } from "../src/api.ts";
import { montarApp } from "../src/app.ts";
import { crearConversacion, vistaChat } from "../src/ui/chat.ts";
import { vistas } from "../src/views/index.ts";

const snapshot = validarSnapshot(JSON.parse(readFileSync("ejemplos/persona-denis.json", "utf8")));
const filas = checkEquipo(JSON.parse(readFileSync("ejemplos/equipo.json", "utf8")), "equipo").equipo;

const TOKEN = "token-secreto-123";
const PROPIA = { personal: true, persona: { id: "denis", nombre: "Denis", equipo: "AI Day" }, dir: "/tmp/rastro", repos: [], token: TOKEN };
const CAMBIOS: Cambio[] = [{ tipo: "duracion", tarea: "metricas", duracion: { valor: 3, unidad: "d" } }];
const RESPUESTA = { respuesta: "Te propongo **3 días**.\nLínea dos.", cambios: [] as Cambio[], vistaPrevia: [] as string[] };
const CON_CAMBIOS = { respuesta: "Subo la duración.", cambios: CAMBIOS, vistaPrevia: ["Métricas: 2 d → 3 d"] };
const RETOMAR = { sessionId: "abc-123", retomar: "claude --resume abc-123" };

type Pedido = { url: string; metodo: string; headers: Record<string, string>; cuerpo: unknown };

const json = (cuerpo: unknown, status = 200): Response => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
const pausa = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let desmontar: (() => void)[] = [];

interface Opciones {
  sesion?: unknown;
  vista?: string;
  persona?: string;
  /** Respuesta del POST /api/chat. */
  chat?: (p: Pedido, n: number) => Response | Promise<Response>;
  /** Resultado de GET /api/chat; recibe cuántos GET hubo. */
  sesionChat?: unknown;
  /** Respuesta del POST /api/cambios; por defecto el central aplica lo que se confirma. */
  cambios?: (p: Pedido) => Response | Promise<Response>;
}

async function montar(o: Opciones = {}) {
  const pedidos: Pedido[] = [];
  const sesionChat = (n: number): unknown => {
    if (o.sesionChat === undefined) return RETOMAR;
    return typeof o.sesionChat === "function" ? o.sesionChat(n) : o.sesionChat;
  };
  const fetchFalso = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(entrada);
    const pedido: Pedido = {
      url,
      metodo: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    pedidos.push(pedido);
    if (url === "/api/sesion") return json(o.sesion ?? PROPIA);
    if (url === "/api/equipo") return json({ equipo: filas });
    if (url.startsWith("/api/persona/")) return json(snapshot);
    if (url === "/api/chat" && pedido.metodo === "GET") return json(sesionChat(pedidos.filter((p) => p.url === "/api/chat" && p.metodo === "GET").length));
    if (url === "/api/chat") return (o.chat ?? (() => json(RESPUESTA)))(pedido, pedidos.filter((p) => p.url === "/api/chat" && p.metodo === "POST").length);
    if (url === "/api/cambios" && o.cambios) return o.cambios(pedido);
    if (url === "/api/cambios") return json({ vistaPrevia: ["Métricas: 2 d → 3 d"], aplicado: (pedido.cuerpo as { confirmar: boolean }).confirmar });
    return json({}, 404);
  };
  window.location.hash = `#/persona/${o.persona ?? "denis"}/${o.vista ?? "chat"}`;
  const raiz = document.getElementById("app") as HTMLElement;
  desmontar.push(montarApp({ raiz, api: crearApi({ fuente: "central", fetch: fetchFalso as typeof fetch }), vistas }));
  await vi.waitFor(() => expect(raiz.querySelector("#contenido section")).not.toBeNull());
  await pausa();
  return {
    raiz,
    pedidos,
    posts: (url: string) => pedidos.filter((p) => p.url === url && p.metodo === "POST"),
  };
}

type Escenario = Awaited<ReturnType<typeof montar>>;
const entrada = (raiz: ParentNode): HTMLTextAreaElement => raiz.querySelector<HTMLTextAreaElement>("textarea.chat-entrada") as HTMLTextAreaElement;
const botones = (raiz: ParentNode, texto: string): HTMLButtonElement[] => [...raiz.querySelectorAll("button")].filter((b) => b.textContent === texto);
const boton = (raiz: ParentNode, texto: string): HTMLButtonElement => {
  const b = botones(raiz, texto)[0];
  if (b === undefined) throw new Error(`No hay botón "${texto}"`);
  return b;
};
const escribir = (raiz: ParentNode, texto: string): void => {
  const campo = entrada(raiz);
  campo.value = texto;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
};
const enviarConBoton = async ({ raiz }: Escenario, texto: string): Promise<void> => {
  escribir(raiz, texto);
  boton(raiz, "Enviar").click();
  await pausa();
};
const texto = (raiz: ParentNode): string => raiz.querySelector("#contenido")?.textContent ?? "";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), configurable: true, writable: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: consulta.includes("pointer: fine"), media: consulta, addEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  desmontar.forEach((f) => f());
  desmontar = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("visibilidad", () => {
  it("con sesión personal y viendo a la propia persona hay pestaña y vista", async () => {
    const { raiz } = await montar();
    expect([...raiz.querySelectorAll(".pestana")].map((a) => a.textContent)).toContain("Chat");
    expect(raiz.querySelector('[aria-current="page"]')?.textContent).toBe("Chat");
    expect(raiz.querySelector("textarea")).not.toBeNull();
  });

  it("sin sesión personal no hay pestaña y la ruta es la página no encontrada", async () => {
    const { raiz } = await montar({ sesion: { personal: false } });
    expect(texto(raiz)).toContain("No encontré esa página");
    expect(raiz.querySelector("textarea")).toBeNull();
    expect([...raiz.querySelectorAll(".pestana")].map((a) => a.textContent)).not.toContain("Chat");
  });

  it("viendo a otra persona tampoco", async () => {
    const { raiz } = await montar({ persona: "lucia" });
    expect(texto(raiz)).toContain("No encontré esa página");
    expect(raiz.querySelector("textarea")).toBeNull();
    window.location.hash = "#/persona/lucia/plan";
    await pausa();
    await pausa();
    expect([...raiz.querySelectorAll(".pestana")].map((a) => a.textContent)).not.toContain("Chat");
  });
});

describe("envío", () => {
  it("manda el token y el mensaje, y la respuesta se ve", async () => {
    const e = await montar();
    await enviarConBoton(e, "  ¿Cómo voy?  ");
    const [pedido] = e.posts("/api/chat");
    expect(pedido?.cuerpo).toEqual({ mensaje: "¿Cómo voy?" });
    expect(pedido?.headers["X-Rastro-Token"]).toBe(TOKEN);
    expect(pedido?.headers["content-type"]).toBe("application/json");
    const filasChat = [...e.raiz.querySelectorAll(".chat-entrada-fila")].map((f) => f.textContent);
    expect(filasChat).toEqual(["VOS¿Cómo voy?", "RASTROTe propongo **3 días**.\nLínea dos."]);
    expect(entrada(e.raiz).value).toBe("");
  });

  it("Enter envía y Shift+Enter no", async () => {
    const e = await montar();
    escribir(e.raiz, "hola");
    entrada(e.raiz).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    await pausa();
    expect(e.posts("/api/chat")).toHaveLength(0);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    entrada(e.raiz).dispatchEvent(enter);
    await pausa();
    expect(enter.defaultPrevented).toBe(true);
    expect(e.posts("/api/chat")).toHaveLength(1);
  });

  it("en táctil Enter no envía (salta de línea) y la línea del atajo lo dice", async () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: false, media: consulta, addEventListener: vi.fn() }));
    const e = await montar();
    escribir(e.raiz, "hola");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    entrada(e.raiz).dispatchEvent(enter);
    await pausa();
    expect(enter.defaultPrevented).toBe(false);
    expect(e.posts("/api/chat")).toHaveLength(0);
    expect(e.raiz.querySelector("#chat-atajo")?.textContent).toBe("Enter salta de línea; el botón Enviar envía");
    boton(e.raiz, "Enviar").click();
    await pausa();
    expect(e.posts("/api/chat")).toHaveLength(1);
  });

  it("con puntero fino la línea del atajo explica Enter y Mayús+Enter, enlazada a la entrada", async () => {
    const e = await montar();
    expect(e.raiz.querySelector("#chat-atajo")?.textContent).toBe("Enter envía; Mayús+Enter salta de línea");
    expect(entrada(e.raiz).getAttribute("aria-describedby")?.split(" ")).toContain("chat-atajo");
  });

  it("mientras espera, la entrada y el botón están deshabilitados, avisa y no hay segundo envío", async () => {
    let liberar: (r: Response) => void = () => undefined;
    const e = await montar({ chat: () => new Promise<Response>((r) => (liberar = r)) });
    await enviarConBoton(e, "uno");
    expect(entrada(e.raiz).disabled).toBe(true);
    expect(boton(e.raiz, "Enviar").disabled).toBe(true);
    expect(e.raiz.querySelector(".chat-estado")?.textContent).toContain("Pensando…");
    expect(e.raiz.querySelector(".chat-estado")?.getAttribute("role")).toBe("status");
    // Con texto en la entrada, para que lo único que frene el segundo envío sea la espera y no el mensaje vacío.
    entrada(e.raiz).value = "dos";
    boton(e.raiz, "Enviar").click();
    entrada(e.raiz).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    e.raiz.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
    await pausa();
    expect(e.posts("/api/chat")).toHaveLength(1);
    expect(e.raiz.querySelector(".edicion-error")?.textContent).toBe("");
    liberar(json(RESPUESTA));
    await vi.waitFor(() => expect(entrada(e.raiz).disabled).toBe(false));
    expect(e.raiz.querySelector(".chat-estado")?.textContent).not.toContain("Pensando");
  });

  it("el estado de espera se anuncia una sola vez aunque la vista se sincronice", async () => {
    let liberar: (r: Response) => void = () => undefined;
    const e = await montar({ chat: () => new Promise<Response>((r) => (liberar = r)) });
    await enviarConBoton(e, "uno");
    const estado = e.raiz.querySelector(".chat-estado") as HTMLElement;
    const cambios: MutationRecord[] = [];
    new MutationObserver((m) => cambios.push(...m)).observe(estado, { childList: true, characterData: true, subtree: true });
    escribir(e.raiz, "algo más");
    await pausa();
    expect(cambios).toHaveLength(0);
    liberar(json(RESPUESTA));
    // Termina antes que el test: una respuesta tardía tocaría la vista con los globales ya restaurados.
    await vi.waitFor(() => expect(entrada(e.raiz).disabled).toBe(false));
  });
});

describe("respuesta", () => {
  it("es texto plano: markdown y HTML no crean elementos", async () => {
    const e = await montar({ chat: () => json({ ...RESPUESTA, respuesta: '<img src=x onerror="alert(1)"><script>alert(2)</script>\n# título' }) });
    await enviarConBoton(e, "hola");
    const respuesta = e.raiz.querySelector(".chat-rastro .chat-texto") as HTMLElement;
    expect(respuesta.textContent).toBe('<img src=x onerror="alert(1)"><script>alert(2)</script>\n# título');
    expect(respuesta.children).toHaveLength(0);
    expect(e.raiz.querySelector("#contenido img, #contenido script")).toBeNull();
  });

  it("un aviso se muestra como renglón aparte antes de la respuesta", async () => {
    const e = await montar({ chat: () => json({ ...RESPUESTA, aviso: "No encontré la conversación anterior: empecé una nueva." }) });
    await enviarConBoton(e, "hola");
    const filasChat = [...e.raiz.querySelectorAll(".chat-entrada-fila")].map((f) => f.querySelector(".etiqueta")?.textContent);
    expect(filasChat).toEqual(["VOS", "AVISO", "RASTRO"]);
    expect(e.raiz.querySelector(".chat-aviso")?.textContent).toContain("empecé una nueva");
  });

  it("una respuesta fuera del contrato se trata como error", async () => {
    const e = await montar({ chat: () => json({ respuesta: 5 }) });
    await enviarConBoton(e, "hola");
    expect(e.raiz.querySelector(".edicion-error")?.textContent).toBe("El central devolvió datos que no entiendo");
    expect(entrada(e.raiz).value).toBe("hola");
  });
});

describe("cambios propuestos", () => {
  it("se ven con su vista previa y no se manda nada a /api/cambios hasta Aplicar", async () => {
    const e = await montar({ chat: () => json(CON_CAMBIOS) });
    await enviarConBoton(e, "subí la duración");
    expect(e.raiz.querySelector(".edicion-panel")?.textContent).toContain("Métricas: 2 d → 3 d");
    expect(botones(e.raiz, "Aplicar")).toHaveLength(1);
    expect(botones(e.raiz, "Descartar")).toHaveLength(1);
    expect(e.posts("/api/cambios")).toHaveLength(0);
  });

  it("hay un solo botón primario: Aplicar con una propuesta abierta, Enviar sin ella", async () => {
    const e = await montar({ chat: (_p, n) => json(n === 1 ? CON_CAMBIOS : RESPUESTA) });
    expect(boton(e.raiz, "Enviar").classList.contains("boton-primario")).toBe(true);
    await enviarConBoton(e, "uno");
    expect(e.raiz.querySelectorAll("button.boton-primario")).toHaveLength(1);
    expect(boton(e.raiz, "Aplicar").classList.contains("boton-primario")).toBe(true);
    expect(boton(e.raiz, "Enviar").classList.contains("boton-primario")).toBe(false);
  });

  it("Aplicar manda exactamente los cambios recibidos con confirmar, anuncia y deja el chat", async () => {
    const e = await montar({ chat: () => json(CON_CAMBIOS) });
    await enviarConBoton(e, "subí la duración");
    boton(e.raiz, "Aplicar").click();
    await pausa();
    await pausa();
    const [pedido] = e.posts("/api/cambios");
    expect(e.posts("/api/cambios")).toHaveLength(1);
    expect(pedido?.cuerpo).toEqual({ cambios: CAMBIOS, confirmar: true });
    expect(pedido?.headers["X-Rastro-Token"]).toBe(TOKEN);
    expect([...e.raiz.querySelectorAll(".anuncio p")].map((l) => l.textContent)).toEqual(["Cambio aplicado.", "Métricas: 2 d → 3 d"]);
    expect(e.raiz.querySelector(".edicion-panel")).toBeNull();
    // El snapshot se invalidó: el plan nuevo se pide de nuevo al volver a Plan.
    const antes = e.pedidos.filter((p) => p.url.startsWith("/api/persona/")).length;
    window.location.hash = "#/persona/denis/plan";
    await pausa();
    await pausa();
    expect(e.pedidos.filter((p) => p.url.startsWith("/api/persona/")).length).toBe(antes + 1);
  });

  it("tras aplicar, la conversación sigue y la propuesta no se vuelve a ofrecer", async () => {
    const e = await montar({ chat: () => json(CON_CAMBIOS) });
    await enviarConBoton(e, "subí la duración");
    boton(e.raiz, "Aplicar").click();
    await pausa();
    await pausa();
    expect(e.raiz.querySelectorAll(".chat-entrada-fila")).toHaveLength(2);
    expect(botones(e.raiz, "Aplicar")).toHaveLength(0);
    expect(document.activeElement).toBe(entrada(e.raiz));
  });

  it("Descartar no manda nada y retira la propuesta", async () => {
    const e = await montar({ chat: () => json(CON_CAMBIOS) });
    await enviarConBoton(e, "subí la duración");
    boton(e.raiz, "Descartar").click();
    await pausa();
    expect(e.posts("/api/cambios")).toHaveLength(0);
    expect(e.raiz.querySelector(".edicion-panel")).toBeNull();
    expect(boton(e.raiz, "Enviar").classList.contains("boton-primario")).toBe(true);
  });

  it("un 403 al aplicar conserva la propuesta y dice que recargues", async () => {
    const e = await montar({ chat: () => json(CON_CAMBIOS), cambios: () => json({ error: "no autorizado" }, 403) });
    await enviarConBoton(e, "subí la duración");
    boton(e.raiz, "Aplicar").click();
    await pausa();
    await pausa();
    expect(e.raiz.querySelector(".edicion-panel .edicion-error")?.textContent).toContain("El central rechazó el pedido: recargá la página.");
    expect(botones(e.raiz, "Aplicar")).toHaveLength(1);
    expect(e.raiz.querySelector(".anuncio")?.textContent).toBe("");
  });
});

describe("sesión", () => {
  it("con sesión muestra el comando para retomarla y lo copia", async () => {
    const escribirPortapapeles = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: escribirPortapapeles } });
    const { raiz } = await montar();
    expect(raiz.querySelector(".chat-comando")?.textContent).toBe("claude --resume abc-123");
    boton(raiz, "Copiar").click();
    await pausa();
    expect(escribirPortapapeles).toHaveBeenCalledWith("claude --resume abc-123");
  });

  it("sin sesión no hay comando", async () => {
    const { raiz } = await montar({ sesionChat: null });
    expect(raiz.querySelector(".chat-comando")).toBeNull();
    expect(botones(raiz, "Copiar")).toHaveLength(0);
  });

  it("después de una respuesta se actualiza", async () => {
    const e = await montar({ sesionChat: (n: number) => (n === 1 ? null : RETOMAR) });
    expect(e.raiz.querySelector(".chat-comando")).toBeNull();
    await enviarConBoton(e, "hola");
    await pausa();
    expect(e.raiz.querySelector(".chat-comando")?.textContent).toBe("claude --resume abc-123");
  });

  it("al arrancar vacía lo dice y recuerda que la sesión sigue", async () => {
    const { raiz } = await montar();
    expect(raiz.querySelector(".chat-vacio")?.textContent).toContain("Claude recuerda lo anterior");
  });

  it("muestra los avisos fijos", async () => {
    const { raiz } = await montar();
    expect(texto(raiz)).toContain("usa tu cuenta de Claude");
    expect(texto(raiz)).toContain("no escribas en la misma sesión desde la terminal");
  });
});

describe("errores", () => {
  const casos: [string, () => Response | Promise<Response>, string][] = [
    ["409", () => json({ error: "ocupado" }, 409), "Ya hay un mensaje en curso"],
    ["502", () => json({ error: "claude no respondió" }, 502), "claude no respondió"],
    ["403", () => json({ error: "no autorizado" }, 403), "El central rechazó el pedido: recargá la página."],
    ["sin conexión", () => Promise.reject(new TypeError("fetch failed")), "No pude hablar con el central"],
  ];
  for (const [nombre, chat, mensaje] of casos) {
    it(`${nombre} muestra su mensaje y conserva el texto escrito`, async () => {
      const e = await montar({ chat });
      await enviarConBoton(e, "mi pregunta");
      expect(e.raiz.querySelector(".edicion-error")?.textContent).toContain(mensaje);
      expect(e.raiz.querySelector(".edicion-error")?.getAttribute("role")).toBe("alert");
      expect(entrada(e.raiz).value).toBe("mi pregunta");
      expect(entrada(e.raiz).disabled).toBe(false);
      expect(e.raiz.querySelectorAll(".chat-entrada-fila")).toHaveLength(0);
    });
  }

  it("tras un error se puede reintentar", async () => {
    const e = await montar({ chat: (_p, n) => (n === 1 ? json({ error: "falló" }, 502) : json(RESPUESTA)) });
    await enviarConBoton(e, "mi pregunta");
    boton(e.raiz, "Enviar").click();
    await pausa();
    await pausa();
    expect(e.posts("/api/chat")).toHaveLength(2);
    expect(e.raiz.querySelector(".edicion-error")?.textContent).toBe("");
    expect(e.raiz.querySelectorAll(".chat-entrada-fila")).toHaveLength(2);
  });
});

describe("límites", () => {
  it("un mensaje de más de 4000 caracteres no se envía ni se recorta, y el contador avisa", async () => {
    const e = await montar();
    escribir(e.raiz, "x".repeat(4001));
    const contador = e.raiz.querySelector<HTMLElement>(".chat-contador") as HTMLElement;
    expect(contador.querySelector(".chat-contador-numero")?.textContent).toBe("4001 / 4000");
    expect(contador.querySelector(".chat-contador-aviso")?.textContent).toBe("Superaste el límite de 4000 caracteres.");
    boton(e.raiz, "Enviar").click();
    await pausa();
    expect(e.posts("/api/chat")).toHaveLength(0);
    expect(e.raiz.querySelector(".edicion-error")?.textContent).toContain("4000");
    expect(entrada(e.raiz).value).toHaveLength(4001);
  });

  it("uno de exactamente 4000 sí se envía", async () => {
    const e = await montar();
    await enviarConBoton(e, "x".repeat(4000));
    expect(e.posts("/api/chat")).toHaveLength(1);
  });

  it("uno vacío o de espacios no se envía", async () => {
    const e = await montar();
    for (const vacio of ["", "   \n "]) await enviarConBoton(e, vacio);
    expect(e.posts("/api/chat")).toHaveLength(0);
    expect(e.raiz.querySelector(".edicion-error")?.textContent).toContain("Escribí un mensaje");
  });

  it("el textarea tiene label y límite, y el contador aparece cerca del tope", async () => {
    const { raiz } = await montar();
    expect(raiz.querySelector('label[for="chat-entrada"]')).not.toBeNull();
    // Sin `maxlength`: el navegador recortaría un pegado largo sin avisar.
    expect(entrada(raiz).hasAttribute("maxlength")).toBe(false);
    const contador = raiz.querySelector<HTMLElement>(".chat-contador") as HTMLElement;
    const numero = contador.querySelector<HTMLElement>(".chat-contador-numero") as HTMLElement;
    const aviso = contador.querySelector<HTMLElement>(".chat-contador-aviso") as HTMLElement;
    expect(aviso.getAttribute("aria-live")).toBe("polite");
    expect(numero.closest("[aria-live]")).toBeNull();
    expect(contador.textContent).toBe("");
    escribir(raiz, "x".repeat(3700));
    expect(numero.textContent).toBe("3700 / 4000");
  });

  it("la región viva solo se reescribe al cruzar 3600, 3900, 4000 y el límite; el número exacto cambia siempre", async () => {
    const { raiz } = await montar();
    const aviso = raiz.querySelector<HTMLElement>(".chat-contador-aviso") as HTMLElement;
    const numero = raiz.querySelector<HTMLElement>(".chat-contador-numero") as HTMLElement;
    const observador = new MutationObserver(() => undefined);
    observador.observe(aviso, { childList: true, characterData: true, subtree: true });
    const cambios = (largo: number): number => {
      escribir(raiz, "x".repeat(largo));
      return observador.takeRecords().length;
    };
    expect(cambios(3599)).toBe(0);
    expect(cambios(3600)).toBeGreaterThan(0);
    expect(cambios(3601)).toBe(0);
    expect(numero.textContent).toBe("3601 / 4000");
    expect(cambios(3899)).toBe(0);
    expect(cambios(3900)).toBeGreaterThan(0);
    expect(cambios(3999)).toBe(0);
    expect(cambios(4000)).toBeGreaterThan(0);
    expect(cambios(4001)).toBeGreaterThan(0);
    expect(cambios(4002)).toBe(0);
    observador.disconnect();
  });

  it('"Descarté la propuesta anterior." también se retira cuando el envío falla', async () => {
    const temporizadores = vi.spyOn(globalThis, "setTimeout");
    const e = await montar({ chat: (_p, n) => (n === 1 ? json(CON_CAMBIOS) : json({ error: "falló" }, 502)) });
    await enviarConBoton(e, "uno");
    await enviarConBoton(e, "dos");
    expect(e.raiz.querySelector(".chat-estado")?.textContent).toBe("Descarté la propuesta anterior.");
    const retiro = temporizadores.mock.calls.filter(([, ms]) => ms === 5000).at(-1);
    expect(retiro).toBeDefined();
    (retiro?.[0] as () => void)();
    expect(e.raiz.querySelector(".chat-estado")?.textContent).toBe("");
  });

  it("descartar la propuesta pasa por edicion.cancelar y el chat no vacía el lugar a mano", async () => {
    const lugares: HTMLElement[] = [];
    const edicion = {
      proponer: (_c: unknown, lugar: HTMLElement) => {
        lugares.push(lugar);
        lugar.replaceChildren(document.createElement("div"));
      },
      cancelar: vi.fn(),
    };
    const conv = crearConversacion();
    conv.propuesta = { cambios: CAMBIOS, vistaPrevia: ["x"] };
    const api = { enviarMensaje: async () => RESPUESTA, cargarChat: async () => RETOMAR };
    const raiz = vistaChat({ conversacion: conv, api, edicion, anunciar: () => undefined });
    document.body.append(raiz);
    expect(lugares).toHaveLength(1);
    escribir(raiz, "otra cosa");
    boton(raiz, "Enviar").click();
    await pausa();
    expect(edicion.cancelar).toHaveBeenCalledWith(lugares[0]);
    expect(lugares[0]?.childElementCount).toBe(1);
  });
});

describe("contrato de /api/chat", () => {
  const invalidas: [string, unknown][] = [
    ["un cambio de tipo desconocido", { ...CON_CAMBIOS, cambios: [{ tipo: "borrar" }] }],
    ["una vista previa que no es texto", { ...CON_CAMBIOS, vistaPrevia: [1] }],
    ["un aviso que no es texto", { ...RESPUESTA, aviso: 5 }],
    ["un campo que el contrato no admite", { ...RESPUESTA, extra: true }],
  ];
  for (const [nombre, cuerpo] of invalidas) {
    it(`una respuesta con ${nombre} no se muestra ni ofrece Aplicar`, async () => {
      const e = await montar({ chat: () => json(cuerpo) });
      await enviarConBoton(e, "hola");
      expect(e.raiz.querySelector(".edicion-error")?.textContent).toBe("El central devolvió datos que no entiendo");
      expect(botones(e.raiz, "Aplicar")).toHaveLength(0);
      expect(e.raiz.querySelectorAll(".chat-entrada-fila")).toHaveLength(0);
    });
  }

  it("un GET /api/chat con forma inválida no muestra comando", async () => {
    const { raiz } = await montar({ sesionChat: { sessionId: 3 } });
    expect(raiz.querySelector(".chat-comando")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("propuesta abierta y escritura", () => {
  it("mientras Aplicar está en vuelo la entrada y Enviar quedan deshabilitados y no sale otro POST", async () => {
    let liberar: (r: Response) => void = () => undefined;
    const e = await montar({ chat: () => json(CON_CAMBIOS), cambios: () => new Promise<Response>((r) => (liberar = r)) as unknown as Response });
    await enviarConBoton(e, "subí la duración");
    boton(e.raiz, "Aplicar").click();
    await pausa();
    expect(entrada(e.raiz).disabled).toBe(true);
    expect(boton(e.raiz, "Enviar").disabled).toBe(true);
    entrada(e.raiz).value = "otra cosa";
    entrada(e.raiz).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await pausa();
    expect(e.posts("/api/chat")).toHaveLength(1);
    expect(e.raiz.querySelector(".edicion-panel")).not.toBeNull();
    liberar(json({ vistaPrevia: [], aplicado: true }));
    await pausa();
    await pausa();
    expect(e.raiz.querySelector(".anuncio")?.textContent).toBe("Cambio aplicado.");
    expect(entrada(e.raiz).disabled).toBe(false);
  });

  it("enviar con una propuesta abierta la descarta por edicion y lo dice", async () => {
    const e = await montar({ chat: (_p, n) => json(n === 1 ? CON_CAMBIOS : RESPUESTA) });
    await enviarConBoton(e, "uno");
    await enviarConBoton(e, "dos");
    await pausa();
    expect(e.raiz.querySelector(".edicion-panel")).toBeNull();
    expect(botones(e.raiz, "Aplicar")).toHaveLength(0);
    expect(e.posts("/api/cambios")).toHaveLength(0);
    expect(e.raiz.querySelector(".chat-estado")?.textContent).toBe("Descarté la propuesta anterior. Rastro respondió.");
  });

  it("Escape en la entrada no descarta la propuesta; Escape dentro del panel sí", async () => {
    const e = await montar({ chat: () => json(CON_CAMBIOS) });
    await enviarConBoton(e, "subí la duración");
    entrada(e.raiz).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await pausa();
    expect(e.raiz.querySelector(".edicion-panel")).not.toBeNull();
    boton(e.raiz, "Aplicar").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await pausa();
    expect(e.raiz.querySelector(".edicion-panel")).toBeNull();
    expect(e.posts("/api/cambios")).toHaveLength(0);
  });
});

describe("estado entre pestañas", () => {
  const ir = async (hash: string): Promise<void> => {
    window.location.hash = hash;
    await pausa();
    await pausa();
  };

  it("una respuesta que llega con otra pestaña abierta se anuncia, y avisa de la propuesta", async () => {
    let liberar: (r: Response) => void = () => undefined;
    const e = await montar({ chat: () => new Promise<Response>((r) => (liberar = r)) });
    await enviarConBoton(e, "uno");
    await ir("#/persona/denis/plan");
    liberar(json(CON_CAMBIOS));
    await pausa();
    await pausa();
    expect(e.raiz.querySelector(".anuncio")?.textContent).toBe("Rastro respondió en Chat. Hay un cambio propuesto para aplicar.");
  });

  it("un error del chat con otra pestaña abierta se anuncia", async () => {
    let liberar: (r: Response) => void = () => undefined;
    const e = await montar({ chat: () => new Promise<Response>((r) => (liberar = r)) });
    await enviarConBoton(e, "uno");
    await ir("#/persona/denis/plan");
    liberar(json({ error: "falló" }, 502));
    await pausa();
    await pausa();
    expect(e.raiz.querySelector(".anuncio")?.textContent).toBe("El chat no pudo responder: mirá en Chat.");
  });

  it("sin propuesta el anuncio no la menciona", async () => {
    let liberar: (r: Response) => void = () => undefined;
    const e = await montar({ chat: () => new Promise<Response>((r) => (liberar = r)) });
    await enviarConBoton(e, "uno");
    await ir("#/persona/denis/plan");
    liberar(json(RESPUESTA));
    await pausa();
    await pausa();
    expect(e.raiz.querySelector(".anuncio")?.textContent).toBe("Rastro respondió en Chat.");
  });

  it("al volver a Chat no reaparece el error viejo", async () => {
    const e = await montar({ chat: () => json({ error: "falló" }, 502) });
    await enviarConBoton(e, "uno");
    expect(e.raiz.querySelector(".edicion-error")?.textContent).toBe("falló");
    await ir("#/persona/denis/plan");
    await ir("#/persona/denis/chat");
    expect(e.raiz.querySelector(".edicion-error")?.textContent).toBe("");
    expect(entrada(e.raiz).value).toBe("uno");
  });

  it('el "Rastro respondió." se retira a los pocos segundos', async () => {
    const temporizadores = vi.spyOn(globalThis, "setTimeout");
    const e = await montar();
    await enviarConBoton(e, "uno");
    expect(e.raiz.querySelector(".chat-estado")?.textContent).toBe("Rastro respondió.");
    const retiro = temporizadores.mock.calls.find(([, ms]) => ms === 5000);
    expect(retiro).toBeDefined();
    (retiro?.[0] as () => void)();
    expect(e.raiz.querySelector(".chat-estado")?.textContent).toBe("");
  });

  it("sincronizar no reconstruye el comando: el foco en Copiar se conserva", async () => {
    const e = await montar();
    const copiarBoton = boton(e.raiz, "Copiar");
    copiarBoton.focus();
    await enviarConBoton(e, "hola");
    await pausa();
    expect(boton(e.raiz, "Copiar")).toBe(copiarBoton);
    expect(document.activeElement).toBe(copiarBoton);
  });

  it("al llegar la respuesta se lleva su comienzo a la vista, sin animación si se pide menos movimiento", async () => {
    const e = await montar();
    const mover = vi.mocked(Element.prototype.scrollIntoView);
    mover.mockClear();
    await enviarConBoton(e, "uno");
    const llamada = mover.mock.calls.at(-1);
    expect(mover.mock.contexts.at(-1) === e.raiz.querySelector(".chat-rastro")).toBe(true);
    expect(llamada?.[0]).toEqual({ block: "start", behavior: "smooth" });

    vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: true, media: consulta, addEventListener: vi.fn() }));
    mover.mockClear();
    await enviarConBoton(e, "dos");
    expect(mover.mock.calls.at(-1)?.[0]).toEqual({ block: "start", behavior: "auto" });
  });
});

describe("sesión fallida", () => {
  it("con /api/sesion caído la ruta del chat dice que no pude confirmar la sesión y ofrece Reintentar", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const raiz = document.getElementById("app") as HTMLElement;
    window.location.hash = "#/persona/denis/chat";
    const fetchFalso = async (entrada: RequestInfo | URL): Promise<Response> => {
      const url = String(entrada);
      if (url === "/api/sesion") return json({}, 500);
      return json({}, 404);
    };
    desmontar.push(montarApp({ raiz, api: crearApi({ fuente: "central", fetch: fetchFalso as typeof fetch }), vistas }));
    await vi.waitFor(() => expect(raiz.querySelector("#contenido [role=alert]")).not.toBeNull());
    expect(texto(raiz)).toContain("No pude confirmar tu sesión");
    expect(texto(raiz)).not.toContain("No encontré esa página");
    expect(botones(raiz, "Reintentar")).toHaveLength(1);
  });
});

describe("persistencia", () => {
  it("cambiar a Plan y volver conserva la conversación, el borrador y la propuesta", async () => {
    const e = await montar({ chat: () => json(CON_CAMBIOS) });
    await enviarConBoton(e, "subí la duración");
    escribir(e.raiz, "borrador pendiente");
    window.location.hash = "#/persona/denis/plan";
    await pausa();
    await pausa();
    expect(e.raiz.querySelector("textarea")).toBeNull();
    window.location.hash = "#/persona/denis/chat";
    await pausa();
    await pausa();
    expect([...e.raiz.querySelectorAll(".chat-entrada-fila")].map((f) => f.textContent)).toEqual(["VOSsubí la duración", "RASTROSubo la duración."]);
    expect(entrada(e.raiz).value).toBe("borrador pendiente");
    // El plan pudo cambiar mientras tanto: al volver se pide otra vista previa y "Aplicar" espera a que llegue.
    await vi.waitFor(() => expect(boton(e.raiz, "Aplicar").disabled).toBe(false));
    expect(e.posts("/api/cambios").map((p) => p.cuerpo)).toEqual([{ cambios: CAMBIOS, confirmar: false }]);
  });

  it("al volver a Chat, Aplicar queda deshabilitado hasta que llega la vista previa nueva, que reemplaza a la vieja", async () => {
    let liberar: (r: Response) => void = () => undefined;
    const e = await montar({ chat: () => json(CON_CAMBIOS), cambios: () => new Promise<Response>((r) => (liberar = r)) });
    await enviarConBoton(e, "subí la duración");
    // Con la propuesta recién llegada la vista previa es la de la respuesta: no se pide otra.
    expect(e.posts("/api/cambios")).toHaveLength(0);
    expect(boton(e.raiz, "Aplicar").disabled).toBe(false);
    window.location.hash = "#/persona/denis/plan";
    await pausa();
    await pausa();
    window.location.hash = "#/persona/denis/chat";
    await pausa();
    await pausa();
    expect(boton(e.raiz, "Aplicar").disabled).toBe(true);
    expect(e.raiz.querySelector(".edicion-panel")?.textContent).not.toContain("Métricas: 2 d → 3 d");
    liberar(json({ vistaPrevia: ["Métricas: 2 d → 3,5 d"], aplicado: false }));
    await vi.waitFor(() => expect(boton(e.raiz, "Aplicar").disabled).toBe(false));
    expect(e.raiz.querySelector(".edicion-panel")?.textContent).toContain("Métricas: 2 d → 3,5 d");
  });

  it("una respuesta que llega con otra pestaña abierta aparece al volver", async () => {
    let liberar: (r: Response) => void = () => undefined;
    const e = await montar({ chat: () => new Promise<Response>((r) => (liberar = r)) });
    await enviarConBoton(e, "uno");
    window.location.hash = "#/persona/denis/plan";
    await pausa();
    await pausa();
    liberar(json(RESPUESTA));
    await pausa();
    await pausa();
    window.location.hash = "#/persona/denis/chat";
    await pausa();
    await pausa();
    expect(e.raiz.querySelectorAll(".chat-entrada-fila")).toHaveLength(2);
    expect(entrada(e.raiz).disabled).toBe(false);
  });

  it("no usa el almacenamiento del navegador", async () => {
    const guardar = vi.spyOn(Storage.prototype, "setItem");
    const e = await montar();
    await enviarConBoton(e, "hola");
    expect(guardar.mock.calls.filter(([clave]) => clave !== "rastro-tema")).toEqual([]);
  });
});

describe("mobile", () => {
  const css = readFileSync(resolve("src/styles/vistas.css"), "utf8");
  const regla = (selector: string): string => {
    const inicio = css.indexOf(`\n${selector} {`);
    expect(inicio, `no está ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(inicio, css.indexOf("}", inicio));
  };

  it("el texto largo se parte y el renglón se apila a 560 px, así la página no scrollea de costado", () => {
    expect(regla(".chat-texto")).toContain("overflow-wrap: anywhere");
    expect(regla(".chat-texto")).toContain("white-space: pre-wrap");
    expect(regla(".chat-comando")).toContain("overflow-wrap: anywhere");
    expect(regla(".chat-entrada")).toContain("width: 100%");
    expect(css).toMatch(/@media \(max-width: 560px\) \{\s*\.chat-entrada-fila \{\s*grid-template-columns: minmax\(0, 1fr\)/);
  });

  it("sin burbujas ni radios", () => {
    const bloque = css.slice(css.indexOf("/* Chat:"));
    expect(bloque).not.toMatch(/border-radius|box-shadow/);
  });
});
