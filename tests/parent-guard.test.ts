import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * installer/mac/parent-guard.cjs : équivalent macOS du Job Object Windows.
 * Le lanceur Mac (JobScout.app) lance node chef de son groupe de processus,
 * stdin branché sur un tube dont il garde seul le côté écriture. Quand le
 * lanceur disparaît (Quitter, plantage, SIGKILL), la garde arrête le serveur
 * et tout son groupe.
 *
 * Ignoré sous Windows : pas de groupes de processus (le Job Object du lanceur
 * C# y joue ce rôle). Tourne sur les runners macOS et Ubuntu de la CI.
 */
const GUARD = path.resolve(process.cwd(), "installer", "mac", "parent-guard.cjs");
const LOG_LINE = "[jobscout] arrêt du serveur : ";

/** Petit serveur HTTP qui annonce « pret <pid> » une fois à l'écoute. */
const SERVER = [
  "const http = require('node:http');",
  "http.createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1', () => console.log('pret ' + process.pid));",
].join("\n");

/** Serveur qui lance un enfant (même groupe) et annonce son pid, comme « cli.js install ». */
const SERVER_WITH_CHILD = [
  "const { spawn } = require('node:child_process');",
  "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
  "require('node:http').createServer(() => {}).listen(0, '127.0.0.1', () => console.log('pret ' + process.pid + ' enfant ' + child.pid));",
].join("\n");

/** Serveur qui ignore SIGTERM : seule la bascule sur SIGKILL l'arrête. */
const STUBBORN_SERVER = [
  "process.on('SIGTERM', () => {});",
  "require('node:http').createServer(() => {}).listen(0, '127.0.0.1', () => console.log('pret ' + process.pid));",
].join("\n");

const started: ChildProcess[] = [];
const extraPids: number[] = [];

function guardEnv(armed: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  if (armed) env.JOBSCOUT_PARENT_GUARD = "1";
  else delete env.JOBSCOUT_PARENT_GUARD;
  return env;
}

/**
 * Lance `node --require parent-guard.cjs -e <script>` comme le lanceur :
 * stdin en TUBE, chef de son groupe (detached), sortie capturée.
 */
function launchGuarded(script: string, armed = true) {
  const child = spawn(process.execPath, ["--require", GUARD, "-e", script], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
    env: guardEnv(armed),
  });
  started.push(child);
  let out = "";
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (d: string) => (out += d));
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (d: string) => (out += d));
  const output = () => out;
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serveur non prêt en 10 s :\n${out}`)), 10_000);
    const onData = () => {
      const m = /^pret .*$/m.exec(out);
      if (m) {
        clearTimeout(timer);
        child.stdout!.off("data", onData);
        resolve(m[0]);
      }
    };
    child.stdout!.on("data", onData);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`serveur arrêté avant d'être prêt (code ${code}, signal ${signal}) :\n${out}`));
    });
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; ms: number }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal, ms: Date.now() }));
  });
  return { child, ready, exited, output };
}

/** Le processus existe-t-il encore ? (kill 0 : aucun signal envoyé) */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitGone(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !alive(pid);
}

function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} : rien en ${ms} ms`)), ms)),
  ]);
}

afterEach(() => {
  for (const c of started.splice(0)) {
    if (c.pid && c.exitCode === null && c.signalCode === null) {
      try {
        process.kill(-c.pid, "SIGKILL");
      } catch {
        try {
          c.kill("SIGKILL");
        } catch {}
      }
    }
  }
  for (const pid of extraPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
});

describe.skipIf(process.platform === "win32")("garde parent du lanceur Mac (parent-guard.cjs)", () => {
  it("fin de stdin (lanceur fermé) → le serveur s'arrête en moins de 6 s", async () => {
    const s = launchGuarded(SERVER);
    await s.ready;
    const t0 = Date.now();
    s.child.stdin!.end();
    const r = await within(s.exited, 6_000, "arrêt après la fin de stdin");
    expect(r.ms - t0).toBeLessThan(6_000);
    // Serveur sans gestionnaire SIGTERM : tué par le SIGTERM envoyé au groupe.
    expect(r.signal).toBe("SIGTERM");
    expect(s.output()).toContain(`${LOG_LINE}lanceur fermé`);
  });

  it("SIGTERM au groupe : l'enfant du serveur (cli.js install) s'arrête aussi", async () => {
    const s = launchGuarded(SERVER_WITH_CHILD);
    const line = await s.ready;
    const m = /enfant (\d+)/.exec(line);
    expect(m).not.toBeNull();
    const childPid = Number(m![1]);
    extraPids.push(childPid);
    expect(alive(childPid)).toBe(true);
    s.child.stdin!.end();
    await within(s.exited, 6_000, "arrêt du serveur");
    expect(await waitGone(childPid, 6_000)).toBe(true);
  });

  it("serveur qui ignore SIGTERM : SIGKILL au groupe après 5 s", async () => {
    const s = launchGuarded(STUBBORN_SERVER);
    await s.ready;
    const t0 = Date.now();
    s.child.stdin!.end();
    const r = await within(s.exited, 9_000, "bascule sur SIGKILL");
    const ms = r.ms - t0;
    expect(r.signal).toBe("SIGKILL");
    expect(ms).toBeGreaterThanOrEqual(4_500);
    expect(ms).toBeLessThan(9_000);
  }, 20_000);

  it("lanceur disparu (ppid changé, stdin encore ouvert) → arrêt en moins de 6 s", async () => {
    // Faux lanceur : lance le serveur gardé (chef de groupe, stdin en tube,
    // sortie dans un fichier), confie une copie du côté écriture du tube à un
    // « gardien » qui lui survit, annonce les pid puis meurt. La fin de stdin
    // ne peut donc pas se produire : seul le changement de ppid peut arrêter
    // le serveur.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-guard-"));
    const logFile = path.join(dir, "server.log");
    const fakeLauncher = [
      "const fs = require('node:fs');",
      "const { spawn } = require('node:child_process');",
      `const LOG = ${JSON.stringify(logFile)};`,
      "const log = fs.openSync(LOG, 'a');",
      `const s = spawn(process.execPath, ['--require', ${JSON.stringify(GUARD)}, '-e', ${JSON.stringify(SERVER)}],`,
      "  { stdio: ['pipe', log, log], detached: true });",
      "const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],",
      "  { stdio: ['ignore', 'ignore', 'ignore', s.stdin], detached: true });",
      "const t = setInterval(() => {",
      "  if (/^pret /m.test(fs.readFileSync(LOG, 'utf8'))) {",
      "    clearInterval(t);",
      "    console.log('serveur ' + s.pid + ' gardien ' + holder.pid);",
      "    process.exit(0);",
      "  }",
      "}, 50);",
    ].join("\n");
    const launcher = spawn(process.execPath, ["-e", fakeLauncher], {
      stdio: ["ignore", "pipe", "pipe"],
      env: guardEnv(true),
    });
    started.push(launcher);
    let out = "";
    launcher.stdout!.setEncoding("utf8");
    launcher.stdout!.on("data", (d: string) => (out += d));
    launcher.stderr!.setEncoding("utf8");
    launcher.stderr!.on("data", (d: string) => (out += d));
    await within(
      new Promise<void>((resolve) => launcher.on("exit", () => resolve())),
      10_000,
      "faux lanceur"
    );
    const m = /serveur (\d+) gardien (\d+)/.exec(out);
    expect(m, out).not.toBeNull();
    const serverPid = Number(m![1]);
    const holderPid = Number(m![2]);
    extraPids.push(serverPid, holderPid);
    try {
      expect(alive(holderPid)).toBe(true); // le côté écriture du tube reste ouvert
      expect(await waitGone(serverPid, 6_000)).toBe(true);
      const log = fs.readFileSync(logFile, "utf8");
      expect(log).toContain(`${LOG_LINE}lanceur disparu`);
      expect(log).not.toContain(`${LOG_LINE}lanceur fermé`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("garde non armée (sans JOBSCOUT_PARENT_GUARD=1) : la fin de stdin n'arrête rien", async () => {
    const s = launchGuarded(SERVER, false);
    const line = await s.ready;
    const pid = Number(/^pret (\d+)/.exec(line)![1]);
    s.child.stdin!.end();
    await new Promise((r) => setTimeout(r, 2_000));
    expect(alive(pid)).toBe(true);
    expect(s.output()).not.toContain(LOG_LINE);
  });
});
