import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textoParaPegar } from "../../backend/src/contract/textos.ts";
import { checkEquipo } from "../../backend/src/contract/equipo.ts";
import { validarSnapshot, type Snapshot } from "../../backend/src/contract/snapshot.ts";
import { crearApi } from "../src/api.ts";
import { montarApp } from "../src/app.ts";
import { vistas } from "../src/views/index.ts";

const base = validarSnapshot(JSON.parse(readFileSync("ejemplos/persona-denis.json", "utf8")));
const filas = checkEquipo(JSON.parse(readFileSync("ejemplos/equipo.json", "utf8")), "equipo").equipo;
const ofertas: Snapshot["ofrecimientos"] = [
  { id: "metricas", nombre: "Métricas del central", objetivo: "Medir las corridas.", duracion: { valor: 1, unidad: "d" }, porque: "Apareció en tres commits sin tarea." },
];
const conOfertas: Snapshot = { ...base, ofrecimientos: ofertas };

type Pedido = { url: string; metodo: string; headers: Record<string, string>; cuerpo: unknown };
type Escenario = {
  raiz: HTMLElement;
  pedidos: Pedido[];
  cambios: () => Pedido[];
  almacenamiento: string[];
};

const json = (cuerpo: unknown, status = 200): Response => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
const pausa = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let desmontar: (() => void)[] = [];

interface Opciones {
  sesion?: unknown;
  snapshot?: Snapshot;
  vista?: string;
  /** Respuesta del POST: recibe el pedido y cuántos POST hubo. */
  post?: (p: Pedido, n: number) => Response | Promise<Response>;
  /** Respuesta de GET /api/persona/<id>; por defecto el snapshot. */
  persona?: () => Response | Promise<Response>;
}

async function montar(o: Opciones = {}): Promise<Escenario> {
  const snapshot = o.snapshot ?? conOfertas;
  const sesion = o.sesion ?? { personal: true, persona: { id: "denis", nombre: "Denis", equipo: "AI Day" }, dir: "/tmp/rastro", repos: [], token: "token-secreto-123" };
  const pedidos: Pedido[] = [];
  const fetchFalso = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(entrada);
    const pedido: Pedido = {
      url,
      metodo: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    pedidos.push(pedido);
    if (url === "/api/sesion") return json(sesion);
    if (url === "/api/equipo") return json({ equipo: filas });
    if (url.startsWith("/api/persona/")) return o.persona === undefined ? json(snapshot) : o.persona();
    if (url === "/api/cambios") {
      const n = pedidos.filter((p) => p.url === "/api/cambios").length;
      const cuerpo = pedido.cuerpo as { confirmar: boolean };
      return (o.post ?? ((_p, _n) => json({ vistaPrevia: ["Bitácora: 2 d → 3 d"], aplicado: cuerpo.confirmar })))(pedido, n);
    }
    return json({}, 404);
  };
  window.location.hash = `#/persona/denis/${o.vista ?? "plan"}`;
  const raiz = document.getElementById("app") as HTMLElement;
  desmontar.push(montarApp({ raiz, api: crearApi({ fuente: "central", fetch: fetchFalso as typeof fetch }), vistas }));
  await vi.waitFor(() => expect(raiz.querySelector("#contenido section")).not.toBeNull());
  await pausa();
  return { raiz, pedidos, cambios: () => pedidos.filter((p) => p.url === "/api/cambios"), almacenamiento: [] };
}

const botones = (raiz: ParentNode, texto: string): HTMLButtonElement[] => [...raiz.querySelectorAll("button")].filter((b) => b.textContent === texto);
const boton = (raiz: ParentNode, texto: string): HTMLButtonElement => {
  const b = botones(raiz, texto)[0];
  if (b === undefined) throw new Error(`No hay botón "${texto}"`);
  return b;
};
const tareaDe = (raiz: ParentNode, slug: string): HTMLElement => {
  const nombre = base.plan?.tareas.find((t) => t.slug === slug)?.nombre ?? slug;
  const li = [...raiz.querySelectorAll<HTMLElement>(".plan-tarea")].find((x) => x.querySelector(".plan-tarea-nombre")?.textContent?.startsWith(nombre));
  if (li === undefined) throw new Error(`No hay tarea ${slug}`);
  return li;
};
const abrirEditor = (raiz: ParentNode, slug: string): HTMLElement => {
  const li = tareaDe(raiz, slug);
  boton(li, "Editar").click();
  return li;
};
const cambiarCampo = (campo: HTMLInputElement | HTMLSelectElement, valor: string): void => {
  campo.value = valor;
  campo.dispatchEvent(new Event("change", { bubbles: true }));
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), configurable: true, writable: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: false, media: consulta, addEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  desmontar.forEach((f) => f());
  desmontar = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("permisos de edición", () => {
  it("sin sesión personal no hay ningún control, pero los ofrecimientos y el texto para pegar se ven", async () => {
    for (const vista of ["plan", "mi-dia"]) {
      const { raiz } = await montar({ sesion: { personal: false }, vista });
      const texto = raiz.querySelector("#contenido")?.textContent ?? "";
      expect(raiz.querySelector("button.boton-discreto:not(summary), .ofrecimiento button")).toBeNull();
      expect(texto).not.toContain("Corregir tarea");
      expect(texto).not.toContain("Aceptar");
      if (vista === "plan") {
        expect(texto).toContain("Métricas del central");
        expect(texto).toContain("Texto para pegar");
      }
      desmontar.pop()?.();
    }
  });

  it("viendo a otra persona que la de la sesión tampoco hay controles", async () => {
    const { raiz } = await montar({ sesion: { personal: true, persona: { id: "lucia", nombre: "Lucía", equipo: "AI Day" }, dir: "/r", repos: [], token: "t" } });
    expect(raiz.querySelector("#contenido")?.textContent).not.toContain("Editar");
    expect(raiz.querySelector("#contenido")?.textContent).not.toContain("Aceptar");
  });

  it("una sesión fuera del contrato deja las vistas de solo lectura y lo dice en el anuncio", async () => {
    const { raiz } = await montar({ sesion: { personal: "tal vez" } });
    expect(raiz.querySelector("#contenido")?.textContent).toContain(base.plan?.entregable);
    expect(raiz.querySelector("#contenido")?.textContent).not.toContain("Editar");
    expect(raiz.querySelector(".anuncio")?.textContent).toBe("No pude confirmar tu sesión: las vistas quedan de solo lectura");
  });

  it.each([
    ["HTTP 500", () => json({ error: "roto" }, 500)],
    ["fetch que rechaza", () => Promise.reject(new TypeError("red"))],
  ])("sesión con %s: solo lectura y el anuncio lo explica", async (_caso, respuesta) => {
    const raiz0 = document.getElementById("app") as HTMLElement;
    const fetchFalso = async (entrada: RequestInfo | URL): Promise<Response> => {
      const url = String(entrada);
      if (url === "/api/sesion") return respuesta();
      if (url.startsWith("/api/persona/")) return json(conOfertas);
      return json({}, 404);
    };
    window.location.hash = "#/persona/denis/plan";
    desmontar.push(montarApp({ raiz: raiz0, api: crearApi({ fuente: "central", fetch: fetchFalso as typeof fetch }), vistas }));
    await vi.waitFor(() => expect(raiz0.querySelector("#contenido section")).not.toBeNull());
    await pausa();
    expect(raiz0.querySelector("#contenido")?.textContent).not.toContain("Editar");
    expect(raiz0.querySelector(".anuncio")?.textContent).toBe("No pude confirmar tu sesión: las vistas quedan de solo lectura");
  });

  it("con una sesión sana no hay anuncio", async () => {
    const { raiz } = await montar();
    expect(raiz.querySelector(".anuncio")?.textContent).toBe("");
  });

  it("con la sesión personal los controles no gritan: el formulario está cerrado hasta pedir Editar", async () => {
    const { raiz } = await montar();
    const li = tareaDe(raiz, "bitacora");
    expect(li.querySelector("form")?.hidden).toBe(true);
    expect(boton(li, "Editar").getAttribute("aria-expanded")).toBe("false");
    boton(li, "Editar").click();
    expect(li.querySelector("form")?.hidden).toBe(false);
    expect(boton(li, "Editar").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("duración: cambio, vista previa y confirmación", () => {
  it("Ver cambio manda confirmar:false con el token y el cambio exacto, y nada más hasta confirmar", async () => {
    const { raiz, cambios } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    cambiarCampo(li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, "3");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(li.querySelector(".edicion-lineas")?.textContent).toBe("Bitácora: 2 d → 3 d"));
    expect(cambios()).toHaveLength(1);
    expect(cambios()[0]).toMatchObject({
      metodo: "POST",
      headers: { "X-Rastro-Token": "token-secreto-123", "content-type": "application/json" },
      cuerpo: { cambios: [{ tipo: "duracion", tarea: "bitacora", duracion: { valor: 3, unidad: "d" } }], confirmar: false },
    });
    await pausa();
    expect(cambios()).toHaveLength(1);
  });

  it("Confirmar manda confirmar:true con el mismo cambio, vuelve a pedir el snapshot y anuncia el resultado", async () => {
    const { raiz, cambios, pedidos } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    cambiarCampo(li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, "3");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    const snapshotsAntes = pedidos.filter((p) => p.url === "/api/persona/denis").length;
    boton(li, "Confirmar").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(2));
    expect(cambios()[1]?.cuerpo).toEqual({ cambios: [{ tipo: "duracion", tarea: "bitacora", duracion: { valor: 3, unidad: "d" } }], confirmar: true });
    await vi.waitFor(() => expect(pedidos.filter((p) => p.url === "/api/persona/denis").length).toBe(snapshotsAntes + 1));
    // Junto al aviso se anuncia lo que devolvió el central al confirmar, no solo lo que se vio en la vista previa.
    await vi.waitFor(() => expect([...raiz.querySelectorAll(".anuncio p")].map((l) => l.textContent)).toEqual(["Cambio aplicado.", "Bitácora: 2 d → 3 d"]));
    expect(raiz.querySelector(".anuncio")?.getAttribute("aria-live")).toBe("polite");
    expect(raiz.querySelector(".edicion-panel")).toBeNull();
  });

  it("el anuncio de éxito se retira solo a los 6 s, y un anuncio posterior no lo hereda", async () => {
    const { raiz } = await montar({
      post: (p, n) => json({ vistaPrevia: [n <= 2 ? "Bitácora: 2 d → 3 d" : "Bitácora: 3 d → 4 d"], aplicado: (p.cuerpo as { confirmar: boolean }).confirmar }),
    });
    const aplicar = async (valor: string): Promise<void> => {
      const li = abrirEditor(raiz, "bitacora");
      cambiarCampo(li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, valor);
      boton(li, "Ver cambio").click();
      await vi.advanceTimersByTimeAsync(100);
      boton(li, "Confirmar").click();
      await vi.advanceTimersByTimeAsync(100);
    };
    const anuncio = (): string => raiz.querySelector(".anuncio")?.textContent ?? "";
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await aplicar("3");
      expect(anuncio()).toContain("Bitácora: 2 d → 3 d");
      await vi.advanceTimersByTimeAsync(3000);
      expect(anuncio()).toContain("Bitácora: 2 d → 3 d");
      await aplicar("4");
      expect(anuncio()).toContain("Bitácora: 3 d → 4 d");
      // El temporizador del primero ya venció (pasaron más de 6 s desde que se emitió) y el segundo sigue a la vista.
      await vi.advanceTimersByTimeAsync(3000);
      expect(anuncio()).toContain("Bitácora: 3 d → 4 d");
      await vi.advanceTimersByTimeAsync(3500);
      expect(anuncio()).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("tras aplicar el foco queda en el Editar de la tarea editada y el anuncio sigue a la vista", async () => {
    const { raiz } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    cambiarCampo(li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, "3");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    boton(li, "Confirmar").click();
    await vi.waitFor(() => expect(raiz.querySelector(".anuncio")?.textContent).toContain("Cambio aplicado."));
    await vi.waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe(`Editar ${base.plan?.tareas.find((t) => t.slug === "bitacora")?.nombre}`));
    expect(document.activeElement).not.toBe(raiz.querySelector("main"));
    expect(raiz.querySelector(".anuncio")?.parentElement).toBe(raiz);
  });

  it("si el control editado ya no existe (un ofrecimiento aceptado) el foco va al anuncio, no a main", async () => {
    const { raiz } = await montar({ post: (p) => json({ vistaPrevia: ["x"], aplicado: (p.cuerpo as { confirmar: boolean }).confirmar }) });
    const oferta = raiz.querySelector(".ofrecimiento") as HTMLElement;
    boton(oferta, "Aceptar").click();
    await vi.waitFor(() => expect(boton(oferta, "Confirmar").disabled).toBe(false));
    boton(oferta, "Confirmar").click();
    await vi.waitFor(() => expect([...raiz.querySelectorAll(".anuncio p")].map((l) => l.textContent)).toEqual(["Cambio aplicado.", "x"]));
    await vi.waitFor(() => expect(document.activeElement).toBe(raiz.querySelector(".anuncio")));
    expect(document.activeElement).not.toBe(raiz.querySelector("main"));
  });

  it("Ver cambio es secundario y Confirmar es el único primario", async () => {
    const { raiz } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    cambiarCampo(li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, "3");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    expect(li.querySelectorAll("form .boton-primario")).toHaveLength(1);
    expect(boton(li, "Confirmar").classList.contains("boton-primario")).toBe(true);
  });

  it("cambiar un campo con la vista previa abierta la cierra sin mandar nada", async () => {
    const { raiz, cambios } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    const numero = li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement;
    cambiarCampo(numero, "3");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    cambiarCampo(numero, "4");
    expect(li.querySelector(".edicion-panel")).toBeNull();
    await pausa();
    expect(cambios()).toHaveLength(1);
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(2));
    expect(cambios()[1]?.cuerpo).toMatchObject({ cambios: [{ duracion: { valor: 4 } }], confirmar: false });
  });

  it("Cancelar no manda nada más y devuelve el foco al control", async () => {
    const { raiz, cambios } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    cambiarCampo(li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, "3");
    const ver = boton(li, "Ver cambio");
    ver.click();
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    boton(li, "Cancelar").click();
    await pausa();
    expect(cambios()).toHaveLength(1);
    expect(li.querySelector(".edicion-panel")).toBeNull();
    expect(document.activeElement).toBe(ver);
  });

  it("sin estimar manda duracion null, y una duración inválida no manda nada", async () => {
    const { raiz, cambios } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    const [sinEstimar] = li.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    (sinEstimar as HTMLInputElement).click();
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(1));
    expect(cambios()[0]?.cuerpo).toMatchObject({ cambios: [{ tipo: "duracion", tarea: "bitacora", duracion: null }] });

    const otra = abrirEditor(raiz, "central");
    cambiarCampo(otra.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, "0");
    boton(otra, "Ver cambio").click();
    expect(otra.querySelector(".edicion-error")?.textContent).toContain("mayor que 0");
    await pausa();
    expect(cambios()).toHaveLength(1);
  });

  it("sin cambios no pide la vista previa", async () => {
    const { raiz, cambios } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    boton(li, "Ver cambio").click();
    expect(li.querySelector(".edicion-error")?.textContent).toBe("No cambiaste nada.");
    await pausa();
    expect(cambios()).toHaveLength(0);
  });
});

describe("los otros tipos de cambio arman el cuerpo correcto", () => {
  it("días: las siete casillas salen de la semana del plan", async () => {
    const { raiz, cambios } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    const casillas = [...li.querySelectorAll<HTMLInputElement>(".edicion-dia input")];
    expect(casillas.map((c) => c.value)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(casillas.map((c) => c.checked)).toEqual([true, true, false, false, false, false, false]);
    casillas[1]?.click();
    casillas[2]?.click();
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(1));
    expect(cambios()[0]?.cuerpo).toEqual({ cambios: [{ tipo: "dia", tarea: "bitacora", dias: ["2026-10-05", "2026-10-07"] }], confirmar: false });
  });

  it("días: no deja sin ninguno", async () => {
    const { raiz, cambios } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    li.querySelectorAll<HTMLInputElement>(".edicion-dia input").forEach((c) => c.checked && c.click());
    boton(li, "Ver cambio").click();
    expect(li.querySelector(".edicion-error")?.textContent).toBe("Elegí al menos un día.");
    await pausa();
    expect(cambios()).toHaveLength(0);
  });

  it("estado", async () => {
    const { raiz, cambios } = await montar();
    const li = abrirEditor(raiz, "central");
    const selectores = li.querySelectorAll<HTMLSelectElement>("select");
    cambiarCampo(selectores[selectores.length - 1] as HTMLSelectElement, "hecha");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(1));
    expect(cambios()[0]?.cuerpo).toEqual({ cambios: [{ tipo: "estado", tarea: "central", estado: "hecha" }], confirmar: false });
  });

  it("repo: ofrece los repos del snapshot y 'sin repo', y arma el cambio repo", async () => {
    const { raiz, cambios } = await montar();
    const li = abrirEditor(raiz, "central");
    const selector = [...li.querySelectorAll<HTMLSelectElement>("select")].find((s) => [...s.options].some((o) => o.text === "sin repo")) as HTMLSelectElement;
    expect([...selector.options].map((o) => o.text)).toEqual(["sin repo", "central-api", "rastro"]);
    expect(selector.value).toBe("central-api");
    cambiarCampo(selector, "rastro");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(1));
    expect(cambios()[0]?.cuerpo).toEqual({ cambios: [{ tipo: "repo", tarea: "central", repo: "rastro" }], confirmar: false });
  });

  it("repo: ofrece también los repos registrados que todavía no están en el snapshot, sin los que el central rechazaría", async () => {
    const sesion = { personal: true, persona: { id: "denis", nombre: "Denis", equipo: "AI Day" }, dir: "/tmp/rastro", repos: ["recien-registrado", "rastro", "con espacio"], token: "token-secreto-123" };
    const { raiz } = await montar({ sesion });
    const li = abrirEditor(raiz, "central");
    const selector = [...li.querySelectorAll<HTMLSelectElement>("select")].find((s) => [...s.options].some((o) => o.text === "sin repo")) as HTMLSelectElement;
    expect([...selector.options].map((o) => o.text)).toEqual(["sin repo", "central-api", "rastro", "recien-registrado"]);
  });

  it("repo: 'sin repo' manda null, y sin cambio de repo no manda ninguno", async () => {
    const { raiz, cambios } = await montar();
    const li = abrirEditor(raiz, "central");
    const selector = [...li.querySelectorAll<HTMLSelectElement>("select")].find((s) => [...s.options].some((o) => o.text === "sin repo")) as HTMLSelectElement;
    boton(li, "Ver cambio").click();
    expect(li.querySelector(".edicion-error")?.textContent).toBe("No cambiaste nada.");
    cambiarCampo(selector, "");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(1));
    expect(cambios()[0]?.cuerpo).toEqual({ cambios: [{ tipo: "repo", tarea: "central", repo: null }], confirmar: false });
  });

  it("repo: una tarea sin repo asigna uno, y sin repos en el snapshot el campo no aparece", async () => {
    const { raiz, cambios } = await montar();
    const li = abrirEditor(raiz, "repeticiones");
    const selector = [...li.querySelectorAll<HTMLSelectElement>("select")].find((s) => [...s.options].some((o) => o.text === "sin repo")) as HTMLSelectElement;
    expect(selector.value).toBe("");
    cambiarCampo(selector, "rastro");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(1));
    expect(cambios()[0]?.cuerpo).toEqual({ cambios: [{ tipo: "repo", tarea: "repeticiones", repo: "rastro" }], confirmar: false });
    desmontar.pop()?.();
    const sinRepos: Snapshot = {
      ...base,
      plan: base.plan === null ? null : { ...base.plan, tareas: base.plan.tareas.map((t) => ({ ...t, repo: null })) },
      bitacora: base.bitacora.map((e) => ({ ...e, repo: null })),
      gantt: { ...base.gantt, barras: base.gantt.barras.map(({ repo: _repo, ...b }) => b) },
      ofrecimientos: [],
    };
    const { raiz: otra } = await montar({ snapshot: sinRepos });
    const abierto = abrirEditor(otra, "central");
    expect([...abierto.querySelectorAll("option")].some((o) => o.text === "sin repo")).toBe(false);
  });

  it("vínculo: usa el SHA de la evidencia de commit, y la entrada sin commit no se puede corregir", async () => {
    const { raiz, cambios } = await montar({ vista: "mi-dia" });
    const entradas = [...raiz.querySelectorAll<HTMLElement>(".entrada")];
    const inferida = entradas.find((e) => e.textContent?.includes("4e81d07")) as HTMLElement;
    boton(inferida, "Corregir tarea").click();
    const selector = inferida.querySelector("select") as HTMLSelectElement;
    expect([...selector.options].map((o) => o.text)).toEqual(["Fuera del plan", ...(base.plan?.tareas.map((t) => t.nombre) ?? [])]);
    cambiarCampo(selector, "pendientes");
    boton(inferida, "Ver cambio").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(1));
    expect(cambios()[0]?.cuerpo).toEqual({ cambios: [{ tipo: "vinculo", commit: "4e81d07", tarea: "pendientes" }], confirmar: false });

    cambiarCampo(selector, "");
    boton(inferida, "Ver cambio").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(2));
    expect(cambios()[1]?.cuerpo).toMatchObject({ cambios: [{ tipo: "vinculo", commit: "4e81d07", tarea: null }] });

    const sinCommit: Snapshot = { ...base, bitacora: [{ ...(base.bitacora[0] as Snapshot["bitacora"][number]), evidencia: [{ tipo: "rama", ref: "feat/x" }] }] };
    desmontar.pop()?.();
    const { raiz: otra } = await montar({ vista: "mi-dia", snapshot: sinCommit });
    expect(otra.querySelector("#contenido")?.textContent).not.toContain("Corregir tarea");
  });

  it("vínculo: sin cambio efectivo no pide nada, y cada control repetido tiene nombre propio", async () => {
    const { raiz, cambios } = await montar({ vista: "mi-dia" });
    const inferida = [...raiz.querySelectorAll<HTMLElement>(".entrada")].find((e) => e.textContent?.includes("4e81d07")) as HTMLElement;
    const abrir = boton(inferida, "Corregir tarea");
    expect(abrir.getAttribute("aria-label")).toBe("Corregir tarea del commit 4e81d07");
    abrir.click();
    expect(inferida.querySelector(".edicion-form")?.getAttribute("role")).toBe("group");
    expect(inferida.querySelector(".edicion-form")?.getAttribute("aria-label")).toBe("Corregir tarea del commit 4e81d07");
    boton(inferida, "Ver cambio").click();
    expect(inferida.querySelector(".edicion-error")?.textContent).toBe("No cambiaste nada.");
    await pausa();
    expect(cambios()).toHaveLength(0);
  });

  it("el formulario de una tarea es un grupo con nombre", async () => {
    const { raiz } = await montar();
    const form = tareaDe(raiz, "bitacora").querySelector("form");
    expect(form?.getAttribute("role")).toBe("group");
    expect(form?.getAttribute("aria-label")).toBe(`Editar ${base.plan?.tareas.find((t) => t.slug === "bitacora")?.nombre}`);
  });

  it("ofrecimiento: aceptar y descartar pasan por la misma vista previa", async () => {
    const { raiz, cambios } = await montar();
    const oferta = raiz.querySelector(".ofrecimiento") as HTMLElement;
    expect(oferta.textContent).toContain("Métricas del central");
    expect(oferta.textContent).toContain("Medir las corridas.");
    expect(oferta.textContent).toContain("1 d");
    expect(oferta.textContent).toContain("Apareció en tres commits sin tarea.");
    boton(oferta, "Aceptar").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(1));
    expect(cambios()[0]?.cuerpo).toEqual({ cambios: [{ tipo: "ofrecimiento", id: "metricas", accion: "aceptar" }], confirmar: false });
    expect(oferta.querySelector(".edicion-panel")).not.toBeNull();
    boton(oferta, "Descartar").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(2));
    expect(cambios()[1]?.cuerpo).toEqual({ cambios: [{ tipo: "ofrecimiento", id: "metricas", accion: "descartar" }], confirmar: false });
    expect(raiz.querySelectorAll(".edicion-panel")).toHaveLength(1);
  });

  it("con la vista previa de un ofrecimiento abierta Aceptar deja de ser primario y Confirmar es el único", async () => {
    const { raiz } = await montar();
    const oferta = raiz.querySelector(".ofrecimiento") as HTMLElement;
    expect(boton(oferta, "Aceptar").classList.contains("boton-primario")).toBe(true);
    boton(oferta, "Aceptar").click();
    await vi.waitFor(() => expect(boton(oferta, "Confirmar").disabled).toBe(false));
    expect(boton(oferta, "Aceptar").classList.contains("boton-primario")).toBe(false);
    expect(oferta.querySelectorAll(".boton-primario")).toHaveLength(1);
    boton(oferta, "Cancelar").click();
    await vi.waitFor(() => expect(boton(oferta, "Aceptar").classList.contains("boton-primario")).toBe(true));
  });

  it("abrir otra vista previa cierra la anterior sin mandar nada", async () => {
    const { raiz, cambios } = await montar();
    const oferta = raiz.querySelector(".ofrecimiento") as HTMLElement;
    boton(oferta, "Aceptar").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(1));
    const li = abrirEditor(raiz, "bitacora");
    cambiarCampo(li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, "3");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(2));
    expect(oferta.querySelector(".edicion-panel")).toBeNull();
    expect(raiz.querySelectorAll(".edicion-panel")).toHaveLength(1);
    expect(cambios().every((p) => (p.cuerpo as { confirmar: boolean }).confirmar === false)).toBe(true);
  });

  it("sin ofrecimientos la sección no aparece", async () => {
    const { raiz } = await montar({ snapshot: { ...base, ofrecimientos: [] } });
    expect(raiz.querySelector(".ofrecimientos")).toBeNull();
  });
});

describe("el anuncio fijo y el foco", () => {
  it("publica el alto del anuncio para que scroll-padding-top no deje el foco debajo", async () => {
    const alto = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(64);
    const { raiz } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    cambiarCampo(li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, "3");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    boton(li, "Confirmar").click();
    await vi.waitFor(() => expect(raiz.querySelector(".anuncio")?.textContent).toContain("Cambio aplicado."));
    expect(document.documentElement.style.getPropertyValue("--anuncio-alto")).toBe("64px");
    alto.mockRestore();
  });

  it("la hoja de estilos reserva la barra y el anuncio en scroll-padding-top", () => {
    const base = readFileSync("src/styles/base.css", "utf8");
    expect(base).toMatch(/html \{[^}]*scroll-padding-top: calc\(var\(--barra-alto\) \+ var\(--anuncio-alto, 0px\)\)/);
  });
});

describe("errores, aviso y doble envío", () => {
  async function conPanel(post: Opciones["post"], persona?: Opciones["persona"]): Promise<{ li: HTMLElement; cambios: Escenario["cambios"]; raiz: HTMLElement; pedidos: Pedido[] }> {
    const { raiz, cambios, pedidos } = await montar({ ...(post === undefined ? {} : { post }), ...(persona === undefined ? {} : { persona }) });
    const li = abrirEditor(raiz, "bitacora");
    cambiarCampo(li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, "3");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(li.querySelector(".edicion-panel")).not.toBeNull());
    return { li, cambios, raiz, pedidos };
  }
  const previa = (c: { cuerpo: unknown }): boolean => (c.cuerpo as { confirmar: boolean }).confirmar === false;

  it("403: dice que el central rechazó el pedido y deja el panel abierto", async () => {
    const { li } = await conPanel((p) => (previa(p) ? json({ vistaPrevia: ["x"], aplicado: false }) : json({ error: "no autorizado" }, 403)));
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    boton(li, "Confirmar").click();
    await vi.waitFor(() => expect(li.querySelector(".edicion-panel .edicion-error")?.textContent).toBe("El central rechazó el pedido: recargá la página. Si estás usando `npm run dev`, abrí el dashboard desde `rastro serve`."));
    expect(li.querySelector(".edicion-panel")).not.toBeNull();
    expect(boton(li, "Confirmar").disabled).toBe(false);
  });

  it("400: muestra el mensaje del central como texto", async () => {
    const { li } = await conPanel((p) => (previa(p) ? json({ vistaPrevia: ["x"], aplicado: false }) : json({ error: "La duración debe estar entre 0,25 y 80 h" }, 400)));
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    boton(li, "Confirmar").click();
    await vi.waitFor(() => expect(li.querySelector(".edicion-panel .edicion-error")?.textContent).toBe("La duración debe estar entre 0,25 y 80 h"));
    expect(li.querySelector(".edicion-panel")).not.toBeNull();
  });

  it("sin conexión en la vista previa deja el panel con el mensaje y permite reintentar", async () => {
    let n = 0;
    const { li } = await conPanel(() => {
      n += 1;
      if (n === 1) throw new TypeError("red");
      return json({ vistaPrevia: ["Bitácora: 2 d → 3 d"], aplicado: false });
    });
    await vi.waitFor(() => expect(li.querySelector(".edicion-panel .edicion-error")?.textContent).toBe("No pude hablar con el central"));
    expect(boton(li, "Confirmar").disabled).toBe(true);
    boton(li, "Reintentar").click();
    await vi.waitFor(() => expect(li.querySelector(".edicion-lineas")?.textContent).toBe("Bitácora: 2 d → 3 d"));
    expect(boton(li, "Confirmar").disabled).toBe(false);
    expect(li.querySelector(".edicion-panel .edicion-error")?.textContent).toBe("");
  });

  it.each([
    ["red caída", () => Promise.reject(new TypeError("red"))],
    ["HTTP 500", () => json({ error: "roto" }, 500)],
    ["respuesta fuera del contrato", () => json({ algo: 1 })],
  ])("si falla confirmar por %s no sabe si se aplicó: lo dice, repinta con el snapshot nuevo y no ofrece reintentar", async (_caso, falla) => {
    const { li, raiz, pedidos } = await conPanel((p) => (previa(p) ? json({ vistaPrevia: ["x"], aplicado: false }) : falla()));
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    const snapshotsAntes = pedidos.filter((p) => p.url === "/api/persona/denis").length;
    boton(li, "Confirmar").click();
    await vi.waitFor(() => expect(raiz.querySelector(".anuncio")?.textContent).toBe("No sé si el cambio se aplicó: actualicé la vista con lo que hay en el plan."));
    await vi.waitFor(() => expect(raiz.querySelector(".edicion-panel")).toBeNull());
    expect(pedidos.filter((p) => p.url === "/api/persona/denis").length).toBe(snapshotsAntes + 1);
    expect(document.activeElement).toBe(tareaDe(raiz, "bitacora").querySelector(".boton-discreto"));
  });

  it("si tras fallar confirmar tampoco se puede pedir el snapshot, no dice que actualizó la vista y Reintentar no borra el aviso", async () => {
    let central = true;
    const { li, raiz } = await conPanel(
      (p) => (previa(p) ? json({ vistaPrevia: ["x"], aplicado: false }) : Promise.reject(new TypeError("red"))),
      () => (central ? json(conOfertas) : Promise.reject(new TypeError("red"))),
    );
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    central = false;
    boton(li, "Confirmar").click();
    const aviso = "No sé si el cambio se aplicó y no pude actualizar la vista: recargá cuando el central vuelva.";
    await vi.waitFor(() => expect(raiz.querySelector(".anuncio")?.textContent).toBe(aviso));
    expect(raiz.querySelector(".anuncio")?.textContent).not.toContain("actualicé la vista");
    boton(raiz, "Reintentar").click();
    await pausa();
    await pausa();
    expect(raiz.querySelector(".anuncio")?.textContent).toBe(aviso);
    central = true;
    boton(raiz, "Reintentar").click();
    await vi.waitFor(() => expect(raiz.querySelector(".plan-tarea")).not.toBeNull());
    expect(raiz.querySelector(".anuncio")?.textContent).toBe("");
  });

  it("una respuesta fuera del contrato da el error de contrato", async () => {
    const { li } = await conPanel(() => json({ algo: 1 }));
    await vi.waitFor(() => expect(li.querySelector(".edicion-panel .edicion-error")?.textContent).toBe("El central devolvió datos que no entiendo"));
  });

  it("el aviso del central se muestra", async () => {
    const aviso = "El cambio se aplicó al plan, pero no pude actualizar el resumen local: corré `rastro daily`.";
    const { li, raiz } = await conPanel((p) => json({ vistaPrevia: ["x"], aplicado: !previa(p), ...(previa(p) ? {} : { aviso }) }));
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    boton(li, "Confirmar").click();
    await vi.waitFor(() => expect(raiz.querySelector(".anuncio")?.textContent).toContain(aviso));
    expect(raiz.querySelector(".anuncio")?.textContent).toContain("Cambio aplicado.");
  });

  it("dos clics seguidos en Confirmar mandan un solo pedido y los botones quedan deshabilitados", async () => {
    let soltar: (r: Response) => void = () => undefined;
    const { li, cambios } = await conPanel((p) => (previa(p) ? json({ vistaPrevia: ["x"], aplicado: false }) : new Promise<Response>((r) => (soltar = r))));
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    const confirmar = boton(li, "Confirmar");
    confirmar.click();
    confirmar.click();
    await pausa();
    expect(cambios()).toHaveLength(2);
    expect(confirmar.disabled).toBe(true);
    expect(boton(li, "Cancelar").disabled).toBe(true);
    soltar(json({ vistaPrevia: ["x"], aplicado: true }));
    await vi.waitFor(() => expect(li.querySelector(".edicion-panel")).toBeNull());
    expect(cambios()).toHaveLength(2);
  });
});

describe("XSS y token", () => {
  const html = '<img src=x onerror="window.__xss=1"><b>negrita</b>';

  it("una línea de vista previa y un mensaje de error con HTML se ven como texto", async () => {
    const { raiz, cambios } = await montar({
      post: (p) => ((p.cuerpo as { confirmar: boolean }).confirmar ? json({ error: html }, 400) : json({ vistaPrevia: [html], aplicado: false })),
    });
    const li = abrirEditor(raiz, "bitacora");
    cambiarCampo(li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, "3");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(li.querySelector(".edicion-lineas")?.textContent).toBe(html));
    boton(li, "Confirmar").click();
    await vi.waitFor(() => expect(li.querySelector(".edicion-panel .edicion-error")?.textContent).toBe(html));
    expect(cambios()).toHaveLength(2);
    expect(li.querySelector(".edicion-panel img, .edicion-panel b")).toBeNull();
    expect((window as unknown as Record<string, unknown>)["__xss"]).toBeUndefined();
  });

  it("el token no aparece en ninguna URL ni en el almacenamiento del navegador", async () => {
    const { raiz, pedidos } = await montar();
    const li = abrirEditor(raiz, "bitacora");
    cambiarCampo(li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, "3");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    expect(pedidos.some((p) => p.url.includes("token-secreto-123"))).toBe(false);
    expect(window.location.href).not.toContain("token-secreto-123");
    expect(JSON.stringify({ ...localStorage })).not.toContain("token-secreto-123");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("token-secreto-123");
    expect(document.body.innerHTML).not.toContain("token-secreto-123");
    // Solo el POST lleva el token, y va en el header.
    expect(pedidos.filter((p) => p.headers["X-Rastro-Token"] !== undefined).map((p) => p.url)).toEqual(["/api/cambios"]);
  });
});

describe("texto para pegar", () => {
  function simularClipboard(writeText: ((t: string) => Promise<void>) | undefined): void {
    Object.defineProperty(navigator, "clipboard", { value: writeText === undefined ? undefined : { writeText }, configurable: true });
  }

  it("coincide con textoParaPegar y solo está en las tareas con entradas", async () => {
    const { raiz } = await montar({ sesion: { personal: false } });
    const con = tareaDe(raiz, "bitacora");
    expect(con.querySelector(".texto-pegar pre")?.textContent).toBe(textoParaPegar(base, "bitacora"));
    expect(con.querySelector(".texto-pegar summary")?.textContent).toBe("Texto para pegar");
    expect(tareaDe(raiz, "repeticiones").querySelector(".texto-pegar")).toBeNull();
    expect(textoParaPegar(base, "repeticiones")).toBeNull();
  });

  it("Copiar llama al portapapeles con ese texto", async () => {
    const writeText = vi.fn(async () => undefined);
    simularClipboard(writeText);
    const { raiz } = await montar({ sesion: { personal: false } });
    const li = tareaDe(raiz, "pendientes");
    boton(li, "Copiar").click();
    await vi.waitFor(() => expect(li.querySelector(".copiar-aviso")?.textContent).toBe("Copiado"));
    expect(writeText).toHaveBeenCalledWith(textoParaPegar(base, "pendientes"));
  });

  it("sin portapapeles avisa que hay que copiarlo a mano y deja el texto seleccionable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    simularClipboard(undefined);
    const { raiz } = await montar({ sesion: { personal: false } });
    const li = tareaDe(raiz, "pendientes");
    boton(li, "Copiar").click();
    await vi.waitFor(() => expect(li.querySelector(".copiar-aviso")?.textContent).toBe("No pude copiar; seleccioná el texto"));
    expect(li.querySelector(".texto-pegar pre")?.getAttribute("tabindex")).toBe("0");
  });
});

describe("teclado", () => {
  it("Escape cancela también con el foco de vuelta en un campo del formulario, salvo mientras se confirma", async () => {
    let soltar: (r: Response) => void = () => undefined;
    const { raiz, cambios } = await montar({
      post: (p) => ((p.cuerpo as { confirmar: boolean }).confirmar ? new Promise<Response>((r) => (soltar = r)) : json({ vistaPrevia: ["x"], aplicado: false })),
    });
    const li = abrirEditor(raiz, "bitacora");
    const numero = li.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement;
    cambiarCampo(numero, "3");
    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    numero.focus();
    numero.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(li.querySelector(".edicion-panel")).toBeNull();

    boton(li, "Ver cambio").click();
    await vi.waitFor(() => expect(boton(li, "Confirmar").disabled).toBe(false));
    boton(li, "Confirmar").click();
    await vi.waitFor(() => expect(cambios()).toHaveLength(3));
    numero.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(li.querySelector(".edicion-panel")).not.toBeNull();
    soltar(json({ vistaPrevia: ["x"], aplicado: false }));
    await vi.waitFor(() => expect(li.querySelector(".edicion-panel")).toBeNull());
  });

  it("Escape cancela la vista previa y devuelve el foco al control que la abrió", async () => {
    const { raiz, cambios } = await montar();
    const oferta = raiz.querySelector(".ofrecimiento") as HTMLElement;
    const aceptar = boton(oferta, "Aceptar");
    aceptar.click();
    await vi.waitFor(() => expect(oferta.querySelector(".edicion-panel")).not.toBeNull());
    expect(document.activeElement).toBe(oferta.querySelector(".edicion-panel"));
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(oferta.querySelector(".edicion-panel")).toBeNull();
    expect(document.activeElement).toBe(aceptar);
    await pausa();
    expect(cambios()).toHaveLength(1);
  });
});
