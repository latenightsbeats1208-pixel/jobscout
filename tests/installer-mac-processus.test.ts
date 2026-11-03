// Recette Mac : reconnaissance des processus de l'app sans dépendre de leur
// ligne de commande (sous macOS, process.title la réécrit : Next.js y met
// « next-server (v…) » et le chemin de node disparaît de ps), garde-fou
// « lsof en panne → échec », limite de temps tenue à la fin de la sonde.
// Fonctions pures de test-install-mac.mjs : tourne sous Windows, Linux et macOS.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  exactly,
  lsofProblem,
  lsofTxtArgs,
  noneLeft,
  parseLsofFields,
  pathUnder,
  selectUnder,
  waitWithin,
  withRealPaths,
} from "../installer/mac/test-install-mac.mjs";

// Disposition réelle de la recette sous GitHub Actions : app dans
// /Applications, données dans le dossier réel, volume sous /Volumes. Tous ces
// chemins sont déjà réels : lsof les rend à l'identique.
const APP = "/Applications/JobScout.app";
const MACOS = `${APP}/Contents/MacOS/`;
const NODE = `${MACOS}node`;
const DATA = "/Users/runner/Library/Application Support/JobScout";
const BROWSERS = `${DATA}/browsers/`;
const VOL_APP = "/Volumes/JobScout 3.4.18/JobScout.app";
const SELF = 500;

// Sortie réelle de « lsof -Fpn » : « p » ouvre un processus, « f » (toujours
// émis) précède chaque « n ».
const LSOF = [
  `p${SELF}`,
  "ftxt",
  "n/Users/runner/hostedtoolcache/node/24.0.0/arm64/bin/node",
  "p900",
  "ftxt",
  `n${MACOS}JobScout`,
  "ftxt",
  "n/usr/lib/dyld",
  "p901",
  "ftxt",
  `n${NODE}`,
  "ftxt",
  "n/usr/lib/dyld",
  "p902",
  "ftxt",
  `n${BROWSERS}chromium_headless_shell-1217/chrome-mac/chrome-headless-shell`,
  "p903",
  "ftxt",
  `n${MACOS}node-bis`,
  "p904",
  "ftxt",
  `n${APP}/Contents/MacOS-ancien/node`,
  "p905",
  "ftxt",
  `n${VOL_APP}/Contents/MacOS/node`,
  "",
].join("\n");

const PS = [
  { pid: 900, pgid: 900, command: `${MACOS}JobScout --no-browser --non-interactive` },
  // Le serveur : process.title a remplacé « …/MacOS/node --require … server.js ».
  { pid: 901, pgid: 901, command: "next-server (v15.5.26)" },
  { pid: 902, pgid: 901, command: "chrome-headless-shell --headless" },
  { pid: 903, pgid: 903, command: "node-bis" },
  { pid: 904, pgid: 904, command: "node" },
  // Groupe C : serveur lancé depuis le volume, renommé lui aussi.
  { pid: 905, pgid: 905, command: "next-server (v15.5.26)" },
  { pid: 950, pgid: 950, command: "/bin/zsh -l" },
];

/** Appel lsof réussi (code 1 : lsof le rend dès qu'un élément lui échappe). */
const LSOF_OK = { code: 1, signal: null, stdout: LSOF, stderr: "", ms: 300 };

const pids = (list: Array<{ pid: number }>) => list.map((p) => p.pid).sort((a, b) => a - b);

/** Comme processesUnder, sans Mac : préfixes tels quels (aucun realpath en jeu). */
function probe(prefixes: string[], run: { code: number | null; signal: string | null; stdout: string; stderr: string; ms: number } = LSOF_OK, ps = PS) {
  const txt = parseLsofFields(run.stdout);
  return { list: selectUnder({ ps, txt, prefixes, selfPid: SELF }), problem: lsofProblem(run, txt, SELF) };
}

describe("lsof : un seul appel, fichiers txt de l'utilisateur", () => {
  it("arguments : ET logique (-a) entre -u <uid> et -d txt, sortie par champs p et n", () => {
    expect(lsofTxtArgs(501)).toEqual(["-nP", "-w", "-a", "-u", "501", "-d", "txt", "-Fpn"]);
  });

  it("sortie -Fpn → Map pid → chemins (espaces gardés, champs f ignorés)", () => {
    const map = parseLsofFields(LSOF);
    expect([...map.keys()]).toEqual([SELF, 900, 901, 902, 903, 904, 905]);
    expect(map.get(901)).toEqual([NODE, "/usr/lib/dyld"]);
    expect(map.get(902)?.[0]).toContain("/Application Support/JobScout/browsers/");
  });

  it("sortie vide ou illisible : Map vide, aucun chemin attribué au hasard", () => {
    expect(parseLsofFields("").size).toBe(0);
    expect(parseLsofFields("lsof: WARNING\npabc\nftxt\nn/x\n").size).toBe(0);
    // « n » avant tout « p » : ignoré.
    expect([...parseLsofFields("n/x\np7\nn/y\n")]).toEqual([[7, ["/y"]]]);
  });
});

describe("garde-fou : lsof en panne → aucun contrôle ne conclut", () => {
  const txtOf = (stdout: string) => parseLsofFields(stdout);

  it("délai dépassé (spawnSync tue lsof) : « interrompu (SIGTERM) »", () => {
    const p = lsofProblem({ code: null, signal: "SIGTERM", stderr: "\nspawnSync lsof ETIMEDOUT", ms: 20000 }, txtOf(""), SELF);
    expect(p).toMatch(/^lsof interrompu \(SIGTERM\) après 20,0 s$/);
  });

  it("lsof absent : « inutilisable », avec la raison", () => {
    const p = lsofProblem({ code: null, signal: null, stderr: "\nspawnSync lsof ENOENT", ms: 3 }, txtOf(""), SELF);
    expect(p).toMatch(/^lsof inutilisable : spawnSync lsof ENOENT$/);
  });

  it("sortie sans la recette (vide, ou autre utilisateur) : « n'a pas vu la recette »", () => {
    expect(lsofProblem({ code: 1 }, txtOf(""), SELF)).toMatch(/^lsof n'a pas vu la recette elle-même \(code 1, 0 processus\)$/);
    // La recette listée sans aucun fichier ne compte pas non plus.
    expect(lsofProblem({ code: 0 }, txtOf(`p${SELF}\np901\nftxt\nn${NODE}\n`), SELF)).toMatch(/n'a pas vu la recette/);
  });

  it("recette vue avec un fichier : exploitable, même avec le code 1", () => {
    expect(lsofProblem({ code: 1 }, txtOf(`p${SELF}\nftxt\nn/x\n`), SELF)).toBeNull();
    expect(lsofProblem(LSOF_OK, txtOf(LSOF), SELF)).toBeNull();
  });

  it("noneLeft et exactly : jamais vrais quand lsof a un problème", () => {
    expect(noneLeft({ list: [], problem: "x" })).toBe(false);
    expect(noneLeft({ list: [], problem: null })).toBe(true);
    expect(noneLeft({ list: [{}], problem: null })).toBe(false);
    expect(exactly({ list: [{}], problem: "x" }, 1)).toBe(false);
    expect(exactly({ list: [{}], problem: null }, 1)).toBe(true);
    expect(exactly({ list: [{}, {}], problem: null }, 1)).toBe(false);
  });

  it.each([
    ["lsof absent", { code: null, signal: null, stdout: "", stderr: "\nspawnSync lsof ENOENT", ms: 3 }],
    ["lsof muet (sortie vide, code 1)", { code: 1, signal: null, stdout: "", stderr: "", ms: 40 }],
  ])("bout à bout, %s : ps seul ne voit plus « next-server », et rien n'est conclu", (_name, broken) => {
    // C.92 (volume), F.1c / allStopped (MacOS/, lanceur 900 tué, serveur
    // renommé encore vivant), E.5 (node) : listes vides…
    const c92 = probe([`${VOL_APP}/`], broken);
    const f1c = probe([MACOS, BROWSERS], broken, PS.filter((p) => p.pid !== 900));
    const e5 = probe([NODE], broken);
    expect([c92.list, f1c.list, e5.list]).toEqual([[], [], []]);
    // … mais aucune ne vaut « plus aucun processus » ni « un seul node ».
    expect(noneLeft(c92)).toBe(false);
    expect(noneLeft(f1c)).toBe(false);
    expect(exactly(e5, 1)).toBe(false);
    expect(exactly(e5, 0)).toBe(false);
  });
});

describe("correspondance chemin ↔ préfixe", () => {
  it("préfixe en « / » : dossier, seul ce qui est dessous compte", () => {
    expect(pathUnder(`${MACOS}node`, MACOS)).toBe(true);
    expect(pathUnder(`${APP}/Contents/MacOS-ancien/node`, MACOS)).toBe(false);
    expect(pathUnder(MACOS.slice(0, -1), MACOS)).toBe(false);
  });

  it("préfixe sans « / » : le chemin lui-même ou dessous, jamais un voisin", () => {
    expect(pathUnder(NODE, NODE)).toBe(true);
    expect(pathUnder(`${NODE}/x`, NODE)).toBe(true);
    expect(pathUnder(`${NODE}-bis`, NODE)).toBe(false);
  });
});

describe("withRealPaths : simple protection, sans effet dans la recette", () => {
  it("chemin par un lien (/var → /private/var, hors recette) : variante résolue ajoutée, « / » final conservé", () => {
    const realpath = (p: string) => {
      if (p.startsWith("/var/")) return `/private${p}`;
      throw new Error(`ENOENT ${p}`);
    };
    const dir = "/var/folders/ab/T/x/JobScout.app/Contents/MacOS/";
    expect(withRealPaths([dir, `${dir}node`], realpath)).toEqual([dir, `/private${dir}`, `${dir}node`, `/private${dir}node`]);
    // Chemin absent : gardé tel quel, sans variante.
    expect(withRealPaths(["/nulle-part/x/"], realpath)).toEqual(["/nulle-part/x/"]);
  });

  it("disposition de la recette (chemins déjà réels) : aucune variante, ce n'était pas la cause de E.5", () => {
    const identity = (p: string) => p;
    expect(withRealPaths([MACOS, NODE, BROWSERS, `${VOL_APP}/`], identity)).toEqual([MACOS, NODE, BROWSERS, `${VOL_APP}/`]);
  });
});

describe("processus sous un préfixe : ligne de commande OU fichiers txt (disposition CI)", () => {
  it("défaut E.5 : le serveur renommé « next-server » est trouvé par son exécutable, une seule fois", () => {
    const e5 = probe([NODE]);
    expect(pids(e5.list)).toEqual([901]);
    expect(exactly(e5, 1)).toBe(true);
    // Par ps seul (méthode d'origine), il échappait : « 0 node ».
    expect(selectUnder({ ps: PS, txt: new Map(), prefixes: [NODE], selfPid: SELF })).toEqual([]);
  });

  it("C.92 : serveur lancé depuis le volume et renommé, trouvé sous le volume seulement", () => {
    const c92 = probe([`${VOL_APP}/`]);
    expect(pids(c92.list)).toEqual([905]);
    expect(noneLeft(c92)).toBe(false);
  });

  it("F.1c, allStopped : dossier MacOS/ et browsers/ couverts par l'exécutable", () => {
    // 903 (MacOS/node-bis) est bien dans MacOS/ ; 904 (MacOS-ancien/) non.
    expect(pids(probe([MACOS]).list)).toEqual([900, 901, 903]);
    expect(pids(probe([MACOS, BROWSERS]).list)).toEqual([900, 901, 902, 903]);
    expect(pids(probe([BROWSERS]).list)).toEqual([902]);
  });

  it("cli.js install : trouvé une seule fois (ligne de commande ET exécutable)", () => {
    const ps = [{ pid: 960, pgid: 901, command: `${NODE} ${APP}/Contents/Resources/app/node_modules/playwright-core/cli.js install` }];
    const txt = new Map([[960, [NODE]]]);
    expect(pids(selectUnder({ ps, txt, prefixes: [MACOS], selfPid: SELF }))).toEqual([960]);
    // lsof muet sur ce pid : la ligne de commande suffit encore.
    expect(pids(selectUnder({ ps, txt: new Map(), prefixes: [NODE], selfPid: SELF }))).toEqual([960]);
  });

  it("la recette elle-même est exclue, même si elle projette un fichier de l'app", () => {
    const txt = new Map([[SELF, [NODE]]]);
    const ps = [{ pid: SELF, pgid: SELF, command: `node test-install-mac.mjs ${NODE}` }];
    expect(selectUnder({ ps, txt, prefixes: [NODE], selfPid: SELF })).toEqual([]);
  });

  it("pid vu par lsof mais pas par ps : compté s'il vit encore, avec ses fichiers", () => {
    const ps = PS.filter((p) => p.pid !== 902);
    const txt = parseLsofFields(LSOF);
    const alive = selectUnder({ ps, txt, prefixes: [BROWSERS], selfPid: SELF, isAlive: () => true });
    expect(alive).toHaveLength(1);
    expect(alive[0]).toMatchObject({ pid: 902, command: "" });
    expect(alive[0].txt[0]).toContain("chrome-headless-shell");
    expect(selectUnder({ ps, txt, prefixes: [BROWSERS], selfPid: SELF, isAlive: () => false })).toEqual([]);
  });

  it("rend les fichiers txt de chaque processus trouvé (détail des contrôles)", () => {
    const [server] = probe([NODE]).list;
    expect(server.command).toBe("next-server (v15.5.26)");
    expect(server.txt[0]).toBe(NODE);
  });
});

describe("waitWithin : limite tenue à la fin de la sonde qui constate", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("sonde partie avant l'échéance mais finie après (lsof lent) : constaté, jamais OK", async () => {
    const t0 = Date.now();
    const w = await waitWithin(t0, 50, 10, async () => {
      const seenAt = Date.now();
      await sleep(200);
      return { done: true, seenAt };
    });
    expect(w.done).toBe(true);
    expect(w.ok).toBe(false);
    expect(w.provenMs).toBeGreaterThan(50);
    // La mesure publiée ne compte pas la partie coûteuse.
    expect(w.seenMs).not.toBeNull();
    expect(w.seenMs!).toBeLessThan(w.provenMs);
  });

  it("état constaté avant la limite : OK, seenMs = premier instant vu, pas le dernier", async () => {
    const t0 = Date.now();
    let calls = 0;
    let firstSeen = 0;
    const w = await waitWithin(t0, 5000, 10, () => {
      calls++;
      if (calls < 2) return { done: false };
      const seenAt = Date.now();
      firstSeen ||= seenAt;
      return { done: calls >= 4, seenAt };
    });
    expect(w).toMatchObject({ ok: true, done: true });
    expect(calls).toBe(4);
    expect(w.seenMs).toBe(firstSeen - t0);
    expect(w.provenMs).toBeLessThanOrEqual(5000);
  });

  it("jamais constaté : ni OK ni fait, seenMs nul, l'échéance part de t0 (geste compris)", async () => {
    const t0 = Date.now() - 80; // geste de 80 ms avant le sondage
    let calls = 0;
    const w = await waitWithin(t0, 100, 10, () => {
      calls++;
      return { done: false };
    });
    expect(w).toMatchObject({ ok: false, done: false, seenMs: null });
    expect(w.provenMs).toBeGreaterThanOrEqual(100);
    expect(w.provenMs).toBeLessThan(1000);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("limite déjà épuisée au départ : une sonde quand même, mais jamais OK", async () => {
    let calls = 0;
    const w = await waitWithin(Date.now() - 5000, 1000, 10, () => {
      calls++;
      return { done: true, seenAt: Date.now() };
    });
    expect(calls).toBe(1);
    expect(w).toMatchObject({ ok: false, done: true });
  });
});

describe("recette : les contrôles concluent par noneLeft / exactly / waitWithin", () => {
  const ROOT = fileURLToPath(new URL("..", import.meta.url));
  const RECETTE = fs.readFileSync(path.join(ROOT, "installer/mac/test-install-mac.mjs"), "utf-8").replace(/\r\n/g, "\n");

  it("aucune conclusion sur la longueur seule d'une liste de processus (hors exactly)", () => {
    expect([...RECETTE.matchAll(/\.list\.length\s*===/g)]).toHaveLength(1);
    expect(RECETTE).toMatch(/export function exactly\(r, n\) \{\n\s*return r\.list\.length === n && !r\.problem;/);
  });

  it("C.92, E.5 et allStopped passent par noneLeft / exactly", () => {
    expect(RECETTE).toMatch(/check\("C\.92",[^\n]*, noneLeft\(left\),/);
    expect(RECETTE).toMatch(/check\("E\.5",[^\n]*exactly\(nodes, 1\),/);
    expect(RECETTE).toMatch(/ok: cheap && !!procs && noneLeft\(procs\),/);
  });

  it("F.1c et G.1c : contrôle sur w.ok (limite comprise), jamais sur l'état seul", () => {
    expect(RECETTE).toMatch(/check\(\s*"F\.1c",\s*"[^"]*",\s*w\.ok,/);
    expect(RECETTE).toMatch(/check\(\s*"G\.1c",\s*"[^"]*",\s*w\.ok,/);
    expect(RECETTE).toMatch(/const w = await waitWithin\(t0, 10000, 200,[^\n]*\n[^\n]*\n\s*const seenAt = Date\.now\(\);\n\s*return \{ done: noneLeft\(processesUnder\(ctx\.macosPrefix\)\), seenAt \};/);
  });
});
