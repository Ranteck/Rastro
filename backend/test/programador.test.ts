import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EntornoCron } from "../src/cron.ts";
import { rutasGlobales } from "../src/config.ts";
import { registrar } from "../src/repos.ts";
import type { Ejecutor } from "../src/llm/claudeCli.ts";
import { horaDelDailyAutomatico, programador, type Opciones } from "../src/programador.ts";
import { BIN_RASTRO, inicializar } from "../src/init.ts";
import { crearRepo } from "./helpers/repo.ts";

const ENTORNO: EntornoCron = { node: "/opt/n v/bin/node", bin: "/r/backend/bin/rastro.js", path: "/opt/n v/bin:/usr/bin" };
const AJENA = "0 3 * * * /usr/bin/backup # nocturno";
const VIEJA = "30 18 * * 1-5 cd '/p/app' && '/n/node' '/r/rastro.js' daily >> .rastro/cron.log 2>&1 # rastro:/p/app";

type Maquina = { ejecutar: Ejecutor; llamadas: string[]; crontab: () => string | null };

/** Una máquina en memoria detrás del ejecutor: ningún test llega a systemctl, launchctl ni crontab reales. */
function maquina(o: { systemd?: boolean; crontab?: string | null | "ausente"; habilitado?: boolean }): Maquina {
  const llamadas: string[] = [];
  let crontab = o.crontab === "ausente" ? null : (o.crontab ?? null);
  const enoent = (bin: string): Promise<never> => Promise.reject(Object.assign(new Error(`spawn ${bin} ENOENT`), { code: "ENOENT" }));
  const ok = { codigo: 0, stdout: "", stderr: "" };
  const ejecutar: Ejecutor = (bin, args, entrada) => {
    llamadas.push([bin, ...args].join(" "));
    if (bin === "systemctl") {
      if (o.systemd !== true) return enoent(bin);
      if (args[1] === "is-enabled") return Promise.resolve({ ...ok, codigo: o.habilitado === false ? 1 : 0 });
      return Promise.resolve(ok);
    }
    if (bin === "launchctl") return Promise.resolve(args[0] === "bootout" ? { codigo: 113, stdout: "", stderr: "no cargado" } : ok);
    assert.equal(bin, "crontab");
    if (o.crontab === "ausente") return enoent(bin);
    if (args[0] === "-l") return Promise.resolve(crontab === null ? { codigo: 1, stdout: "", stderr: "no crontab for yo\n" } : { ...ok, stdout: crontab });
    crontab = entrada;
    return Promise.resolve(ok);
  };
  return { ejecutar, llamadas, crontab: () => crontab };
}

function entorno(plataforma: NodeJS.Platform): { op: Opciones; unidad: (n: string) => string; plist: string } {
  const home = mkdtempSync(join(tmpdir(), "rastro-home-"));
  return {
    op: { home, plataforma, uid: 501 },
    unidad: (n) => join(home, ".config/systemd/user", n),
    plist: join(home, "Library/LaunchAgents/ar.rastro.daily.plist"),
  };
}

function repoInicializado(): void {
  inicializar(crearRepo().dir, { equipo: "QA", binRastro: BIN_RASTRO });
}

test("systemd: escribe .service y .timer con hora, días hábiles, Persistent y entorno; daemon-reload y enable --now; quitar los saca", async () => {
  repoInicializado();
  const { dir, cronLog } = rutasGlobales();
  const m = maquina({ systemd: true });
  const e = entorno("linux");
  const salida = await programador(["instalar", "--hora", "7:05"], m.ejecutar, () => ENTORNO, e.op);
  assert.match(salida, /timer de systemd de usuario.*07:05/);
  assert.ok(salida.includes(cronLog));
  const servicio = readFileSync(e.unidad("rastro-daily.service"), "utf8");
  assert.match(servicio, /^Type=oneshot$/m);
  assert.match(servicio, /^ExecStart="\/opt\/n v\/bin\/node" "\/r\/backend\/bin\/rastro.js" daily$/m);
  assert.ok(servicio.includes(`WorkingDirectory=${dir}\n`));
  assert.ok(servicio.includes(`Environment="RASTRO_HOME=${dir}"`));
  assert.ok(servicio.includes('Environment="PATH=/opt/n v/bin:/usr/bin"'));
  assert.ok(servicio.includes(`StandardOutput=append:${cronLog}\nStandardError=append:${cronLog}`));
  const timer = readFileSync(e.unidad("rastro-daily.timer"), "utf8");
  assert.match(timer, /^OnCalendar=Mon\.\.Fri \*-\*-\* 07:05:00$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^WantedBy=timers.target$/m);
  const reload = m.llamadas.indexOf("systemctl --user daemon-reload");
  assert.ok(reload >= 0);
  assert.deepEqual(m.llamadas.slice(reload, reload + 3), ["systemctl --user daemon-reload", "systemctl --user enable --now rastro-daily.timer", "systemctl --user restart rastro-daily.timer"]);

  assert.match(await programador([], m.ejecutar, () => ENTORNO, e.op), /systemd de usuario: de lunes a viernes a las 07:05/);
  m.llamadas.length = 0;
  assert.match(await programador(["quitar"], m.ejecutar, () => ENTORNO, e.op), /quitado/);
  assert.deepEqual(m.llamadas.filter((l) => l.startsWith("systemctl")), ["systemctl --user disable --now rastro-daily.timer", "systemctl --user daemon-reload"]);
  assert.ok(!existsSync(e.unidad("rastro-daily.service")) && !existsSync(e.unidad("rastro-daily.timer")));
  assert.match(await programador(["quitar"], m.ejecutar, () => ENTORNO, e.op), /No había/);
});

test("systemd: el estado dice si el timer está habilitado", async () => {
  repoInicializado();
  const e = entorno("linux");
  await programador(["instalar"], maquina({ systemd: true }).ejecutar, () => ENTORNO, e.op);
  assert.doesNotMatch(await programador([], maquina({ systemd: true }).ejecutar, () => ENTORNO, e.op), /deshabilitado/);
  assert.match(await programador([], maquina({ systemd: true, habilitado: false }).ejecutar, () => ENTORNO, e.op), /deshabilitado/);
});

test("systemd: las rutas con espacios, comillas, % y $ se citan como pide systemd", async () => {
  const home = mkdtempSync(join(tmpdir(), "rastro-cita-"));
  const dir = join(home, 'r "100%" $x');
  const repo = crearRepo().dir;
  process.env["RASTRO_HOME"] = dir;
  registrar(repo);
  const e = entorno("linux");
  await programador(["instalar"], maquina({ systemd: true }).ejecutar, () => ({ node: '/o p/n"x/node', bin: "/r/100%/ras$tro.js", path: '/a b:/p"%$', claudeConfigDir: 'C:\\c "9%" $y' }), e.op);
  const servicio = readFileSync(e.unidad("rastro-daily.service"), "utf8");
  assert.ok(servicio.includes('ExecStart="/o p/n\\"x/node" "/r/100%%/ras$$tro.js" daily'));
  assert.ok(servicio.includes('Environment="PATH=/a b:/p\\"%%$"'));
  assert.ok(servicio.includes('Environment="CLAUDE_CONFIG_DIR=C:\\\\c \\"9%%\\" $y"'));
  const dirSystemd = dir.replaceAll("%", "%%");
  assert.ok(servicio.includes(`Environment="RASTRO_HOME=${dirSystemd.replaceAll('"', '\\"')}"`));
  assert.ok(servicio.includes(`WorkingDirectory=${dirSystemd}\n`));
  const log = join(dirSystemd, "cron.log");
  assert.ok(servicio.includes(`StandardOutput=append:${log}\nStandardError=append:${log}`));
});

test("un salto de línea en node, bin, PATH o CLAUDE_CONFIG_DIR da error de usuario y no escribe nada", async () => {
  repoInicializado();
  for (const malo of [{ node: "/n\nx" }, { bin: "/b\nx" }, { path: "/p\nx" }, { claudeConfigDir: "/c\nx" }]) {
    for (const [maq, plataforma] of [[maquina({ systemd: true }), "linux"], [maquina({ crontab: "ausente" }), "darwin"], [maquina({ crontab: null }), "linux"]] as const) {
      const e = entorno(plataforma);
      await assert.rejects(programador(["instalar"], maq.ejecutar, () => ({ ...ENTORNO, ...malo }), e.op), /salto de línea/);
      assert.ok(!existsSync(e.unidad("rastro-daily.service")) && !existsSync(e.plist));
      assert.ok(!maq.llamadas.some((l) => l.includes("enable") || l.includes("bootstrap") || l === "crontab -"));
    }
  }
});

test("un crontab -l que falla no frena el timer ni el agente: queda como aviso", async () => {
  repoInicializado();
  const roto = (systemd: boolean): Ejecutor => (bin, args) => {
    if (bin === "crontab") return Promise.resolve({ codigo: 1, stdout: "", stderr: "boom" });
    if (bin === "systemctl" && !systemd) return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    return Promise.resolve(bin === "launchctl" && args[0] === "bootout" ? { codigo: 113, stdout: "", stderr: "" } : { codigo: 0, stdout: "", stderr: "" });
  };
  const sd = entorno("linux");
  const salida = await programador(["instalar"], roto(true), () => ENTORNO, sd.op);
  assert.match(salida, /timer de systemd/);
  assert.match(salida, /Aviso: no pude limpiar el crontab: No pude leer el crontab/);
  assert.ok(existsSync(sd.unidad("rastro-daily.timer")));
  const ld = entorno("darwin");
  assert.match(await programador(["instalar"], roto(false), () => ENTORNO, ld.op), /con launchd[\s\S]*Aviso: no pude limpiar el crontab/);
  assert.ok(existsSync(ld.plist));
});

test("launchd: el plist con los cinco días, el entorno y los logs; bootout y bootstrap; quitar hace bootout y lo borra", async () => {
  repoInicializado();
  const { dir, cronLog } = rutasGlobales();
  const m = maquina({ crontab: "ausente" });
  const e = entorno("darwin");
  const salida = await programador(["instalar", "--hora", "9:05"], m.ejecutar, () => ({ ...ENTORNO, path: "/a&b/<x>:/usr/bin" }), e.op);
  assert.match(salida, /con launchd.*09:05/);
  const plist = readFileSync(e.plist, "utf8");
  for (const d of [1, 2, 3, 4, 5]) assert.ok(plist.includes(`<key>Weekday</key>\n      <integer>${d}</integer>\n      <key>Hour</key>\n      <integer>9</integer>\n      <key>Minute</key>\n      <integer>5</integer>`), `día ${d}`);
  assert.ok(!plist.includes("<integer>6</integer>") && !plist.includes("<integer>0</integer>"));
  assert.ok(plist.includes("<string>/opt/n v/bin/node</string>") && plist.includes("<string>daily</string>"));
  assert.ok(plist.includes(`<key>RASTRO_HOME</key>\n    <string>${dir}</string>`));
  assert.ok(plist.includes("<string>/a&amp;b/&lt;x&gt;:/usr/bin</string>"));
  assert.ok(plist.includes(`<key>StandardOutPath</key>\n  <string>${cronLog}</string>`) && plist.includes(`<key>StandardErrorPath</key>\n  <string>${cronLog}</string>`));
  assert.deepEqual(m.llamadas.filter((l) => l.startsWith("launchctl")), ["launchctl bootout gui/501/ar.rastro.daily", `launchctl bootstrap gui/501 ${e.plist}`]);

  assert.match(await programador([], m.ejecutar, () => ENTORNO, e.op), /con launchd: de lunes a viernes a las 09:05/);
  m.llamadas.length = 0;
  assert.match(await programador(["quitar"], m.ejecutar, () => ENTORNO, e.op), /quitado/);
  assert.deepEqual(m.llamadas.filter((l) => l.startsWith("launchctl")), ["launchctl bootout gui/501/ar.rastro.daily"]);
  assert.ok(!existsSync(e.plist));
});

test("sin systemd ni launchd, con crontab: la línea global de siempre", async () => {
  repoInicializado();
  const { dir, cronLog } = rutasGlobales();
  const m = maquina({ crontab: null });
  const salida = await programador(["instalar"], m.ejecutar, () => ENTORNO, entorno("linux").op);
  assert.match(salida, /con crontab.*18:30/);
  assert.equal(m.crontab(), `30 18 * * 1-5 cd '${dir}' && RASTRO_HOME='${dir}' PATH='/opt/n v/bin:/usr/bin' '/opt/n v/bin/node' '/r/backend/bin/rastro.js' daily >> '${cronLog}' 2>&1 # rastro:global\n`);
});

test("sin ningún programador: el mensaje con qué instalar, sin error ni escribir nada", async () => {
  repoInicializado();
  const m = maquina({ crontab: "ausente" });
  const e = entorno("linux");
  const salida = await programador(["instalar"], m.ejecutar, () => ENTORNO, e.op);
  for (const t of ["/etc/wsl.conf", "sudo apt install cron", "sudo pacman -S cronie", "sudo systemctl enable --now cronie", "sudo dnf install cronie", "sudo systemctl enable --now crond"]) assert.ok(salida.includes(t), t);
  assert.ok(!existsSync(e.unidad("rastro-daily.timer")));
  assert.match(await programador([], m.ejecutar, () => ENTORNO, e.op), /no está instalado/);
  assert.match(await programador(["quitar"], m.ejecutar, () => ENTORNO, e.op), /No había/);
});

test("instalar el timer saca las líneas de Rastro del crontab y deja las ajenas", async () => {
  repoInicializado();
  const m = maquina({ systemd: true, crontab: `${VIEJA}\n${AJENA}\n30 18 * * 1-5 x # rastro:global\n` });
  await programador(["instalar"], m.ejecutar, () => ENTORNO, entorno("linux").op);
  assert.equal(m.crontab(), `${AJENA}\n`);
});

test("instalar con systemd o launchd saca la instalación de otro programador de Rastro", async () => {
  repoInicializado();
  const e = entorno("linux");
  await programador(["instalar"], maquina({ systemd: true }).ejecutar, () => ENTORNO, e.op);
  mkdirSync(join(e.op.home, "Library/LaunchAgents"), { recursive: true });
  writeFileSync(e.plist, "<plist/>");
  await programador(["instalar"], maquina({ systemd: true }).ejecutar, () => ENTORNO, e.op);
  assert.ok(!existsSync(e.plist));
  assert.ok(existsSync(e.unidad("rastro-daily.timer")));

  const mac = entorno("darwin");
  mkdirSync(join(mac.op.home, ".config/systemd/user"), { recursive: true });
  writeFileSync(mac.unidad("rastro-daily.timer"), "x");
  writeFileSync(mac.unidad("rastro-daily.service"), "x");
  const m = maquina({ crontab: "ausente" });
  await programador(["instalar"], m.ejecutar, () => ENTORNO, mac.op);
  assert.ok(!existsSync(mac.unidad("rastro-daily.timer")) && !existsSync(mac.unidad("rastro-daily.service")));
  assert.ok(existsSync(mac.plist));
  assert.ok(m.llamadas.includes("systemctl --user disable --now rastro-daily.timer"), "intenta deshabilitar antes de borrar");
});

test("CLAUDE_CONFIG_DIR queda en la tarea si estaba definido y no aparece si no", async () => {
  repoInicializado();
  const con: EntornoCron = { ...ENTORNO, claudeConfigDir: "/c/cuenta 2" };
  const sd = entorno("linux");
  await programador(["instalar"], maquina({ systemd: true }).ejecutar, () => con, sd.op);
  assert.ok(readFileSync(sd.unidad("rastro-daily.service"), "utf8").includes('Environment="CLAUDE_CONFIG_DIR=/c/cuenta 2"'));
  const ld = entorno("darwin");
  await programador(["instalar"], maquina({ crontab: "ausente" }).ejecutar, () => con, ld.op);
  assert.ok(readFileSync(ld.plist, "utf8").includes("<key>CLAUDE_CONFIG_DIR</key>\n    <string>/c/cuenta 2</string>"));
  const ct = maquina({ crontab: null });
  await programador(["instalar"], ct.ejecutar, () => con, entorno("linux").op);
  assert.match(ct.crontab() ?? "", / CLAUDE_CONFIG_DIR='\/c\/cuenta 2' PATH=/);

  const sin = entorno("linux");
  await programador(["instalar"], maquina({ systemd: true }).ejecutar, () => ENTORNO, sin.op);
  assert.doesNotMatch(readFileSync(sin.unidad("rastro-daily.service"), "utf8"), /CLAUDE_CONFIG_DIR/);
  const sinCt = maquina({ crontab: null });
  await programador(["instalar"], sinCt.ejecutar, () => ENTORNO, entorno("linux").op);
  assert.doesNotMatch(sinCt.crontab() ?? "", /CLAUDE_CONFIG_DIR/);
});

test("un segundo instalar no duplica la tarea", async () => {
  repoInicializado();
  const e = entorno("linux");
  const m = maquina({ systemd: true });
  await programador(["instalar"], m.ejecutar, () => ENTORNO, e.op);
  await programador(["instalar", "--hora", "19:00"], m.ejecutar, () => ENTORNO, e.op);
  const timer = readFileSync(e.unidad("rastro-daily.timer"), "utf8");
  assert.equal(timer.match(/^OnCalendar=/gm)?.length, 1);
  assert.match(timer, /19:00:00/);

  const ct = maquina({ crontab: `${AJENA}\n` });
  const op = entorno("linux").op;
  await programador(["instalar"], ct.ejecutar, () => ENTORNO, op);
  await programador(["instalar", "--hora", "19:00"], ct.ejecutar, () => ENTORNO, op);
  assert.equal((ct.crontab() ?? "").split("\n").filter((l) => l.endsWith("# rastro:global")).length, 1);
});

test("una hora inválida da error de usuario sin escribir nada", async () => {
  repoInicializado();
  const e = entorno("linux");
  const m = maquina({ systemd: true });
  await assert.rejects(programador(["instalar", "--hora", "25:00"], m.ejecutar, () => ENTORNO, e.op), /no es válida/);
  assert.ok(!existsSync(e.unidad("rastro-daily.timer")));
});

test("horaDelDailyAutomatico lee la hora del timer, del agente o del crontab, y sin nada da null sin escribir", async () => {
  repoInicializado();
  const sinCrontab = (): Promise<string | null> => Promise.resolve(null);
  const nada = entorno("linux");
  assert.equal(await horaDelDailyAutomatico(nada.op.home, sinCrontab), null);
  assert.equal(existsSync(nada.unidad("rastro-daily.timer")), false);

  const systemd = entorno("linux");
  await programador(["instalar", "--hora", "7:05"], maquina({ systemd: true }).ejecutar, () => ENTORNO, systemd.op);
  assert.equal(await horaDelDailyAutomatico(systemd.op.home, () => Promise.reject(new Error("no debía leer el crontab"))), "07:05");

  const launchd = entorno("darwin");
  await programador(["instalar", "--hora", "19:45"], maquina({}).ejecutar, () => ENTORNO, launchd.op);
  assert.equal(await horaDelDailyAutomatico(launchd.op.home, sinCrontab), "19:45");

  const cron = entorno("linux");
  const m = maquina({ crontab: "" });
  await programador(["instalar", "--hora", "8:10"], m.ejecutar, () => ENTORNO, cron.op);
  assert.equal(await horaDelDailyAutomatico(cron.op.home, () => Promise.resolve(m.crontab())), "08:10");
});
