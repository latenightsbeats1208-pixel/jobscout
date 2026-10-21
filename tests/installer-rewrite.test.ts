import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import {
  NEUTRAL_ROOTS,
  TARGETS,
  assemble,
  macDataReadme,
  resolveTarget,
  rewriteAbsolutePaths,
  rewriteForms,
} from "@/installer/assemble.mjs";
import { allRoutes } from "@/installer/build.mjs";
import { DEFAULT_MARGIN, makeIcon, render } from "@/installer/make-icon.mjs";
import {
  compareDigests,
  compileExcludes,
  formatDigest,
  parseDigest,
  treeDigest,
} from "@/installer/tree-digest.mjs";
import { VARIANTS } from "@/installer/variant.mjs";

// Pièces partagées entre l'installeur Windows et l'installeur Mac :
//   - réécriture des chemins absolus : racine POSIX pour le Mac, Windows
//     strictement identique à la 3.4.17 ;
//   - icône : marge réglable, .ico Windows identique octet pour octet ;
//   - allRoutes (démarrage à blanc) et tree-digest (instantanés, non-régression).

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-rewrite-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

function tree(name: string, files: Record<string, string | Buffer>): string {
  const root = path.join(tmp, name);
  for (const [rel, data] of Object.entries(files)) {
    const p = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
  return root;
}

const read = (root: string, rel: string) => fs.readFileSync(path.join(root, ...rel.split("/")), "latin1");

/** Copie figée des formes de la 3.4.17 (avant la cible Mac) : la référence Windows. */
function formsV3417(projectRoot: string): Array<[string, string]> {
  const NEUTRAL_ROOT = "C:\\JobScout\\build";
  const bs = projectRoot.replace(/\//g, "\\");
  return [
    [bs.replace(/\\/g, "\\\\"), NEUTRAL_ROOT.replace(/\\/g, "\\\\")],
    [bs, NEUTRAL_ROOT],
    [bs.replace(/\\/g, "/"), NEUTRAL_ROOT.replace(/\\/g, "/")],
  ];
}
const applyForms = (text: string, forms: Array<[string, string]>) =>
  forms.reduce((t, [from, to]) => t.split(from).join(to), text);

describe("rewriteForms : Windows identique à la 3.4.17", () => {
  const roots = [
    "D:\\a\\jobscout\\jobscout",
    "D:/a/jobscout/jobscout",
    "D:\\Projets JobScout\\jobscout-public",
    "\\\\serveur\\partage\\jobscout",
    "relatif\\jobscout",
  ];
  it.each(roots)("%s", (root) => {
    expect(rewriteForms(root)).toEqual(formsV3417(root));
    expect(rewriteForms(root, NEUTRAL_ROOTS.windows)).toEqual(formsV3417(root));
  });

  it("racine neutre Windows inchangée", () => {
    expect(NEUTRAL_ROOTS.windows).toBe("C:\\JobScout\\build");
    expect(TARGETS).toEqual(["windows", "mac"]);
  });
});

describe("rewriteAbsolutePaths : Windows, de bout en bout", () => {
  const project = "D:\\a\\jobscout\\jobscout";
  const esc = project.replace(/\\/g, "\\\\");
  const fwd = project.replace(/\\/g, "/");
  const files = {
    "app/.next/server/app/page.js": `{layout:[()=>x,"${esc}\\\\app\\\\layout.tsx"]}`,
    "app/.next/server/client-reference-manifest.json": `{"clientModules":{"${esc}\\\\node_modules\\\\next\\\\a.js":1}}`,
    "app/.next/trace.txt": `${project}\\lib\\db\\schema.sql ${fwd}/prompts/a.md`,
    "app/server.js": "require('next'); // aucun chemin\n",
  };

  it("même résultat que l'algorithme de la 3.4.17, fichiers sans chemin intacts", () => {
    const root = tree("win", files);
    const before = fs.statSync(path.join(root, "app", "server.js")).mtimeMs;
    const res = rewriteAbsolutePaths(root, project);
    for (const [rel, text] of Object.entries(files)) {
      expect(read(root, rel)).toBe(applyForms(text, formsV3417(project)));
    }
    expect(read(root, "app/.next/server/app/page.js")).toBe('{layout:[()=>x,"C:\\\\JobScout\\\\build\\\\app\\\\layout.tsx"]}');
    expect(read(root, "app/.next/trace.txt")).toBe("C:\\JobScout\\build\\lib\\db\\schema.sql C:/JobScout/build/prompts/a.md");
    expect(res).toEqual({ filesTouched: 3, replacements: 4 });
    expect(fs.statSync(path.join(root, "app", "server.js")).mtimeMs).toBe(before);
  });

  it("chemin du projet dans un binaire : refus (on ne corrompt rien)", () => {
    const root = tree("win-bin", { "app/a.png": Buffer.from(`\u0089PNG ${project}`, "latin1") });
    expect(() => rewriteAbsolutePaths(root, project)).toThrow(/fichiers non textuels/);
  });
});

describe("rewriteAbsolutePaths : racine POSIX (Mac)", () => {
  const project = "/Users/runner/work/jobscout/jobscout";
  const escaped = project.replace(/\//g, "\\/");

  it("formes « / » et « \\/ », remplacées par /JobScout/build", () => {
    expect(rewriteForms(project, NEUTRAL_ROOTS.mac)).toEqual([
      [escaped, "\\/JobScout\\/build"],
      [project, "/JobScout/build"],
    ]);
    expect(rewriteForms(`${project}/`, NEUTRAL_ROOTS.mac)).toEqual(rewriteForms(project, NEUTRAL_ROOTS.mac));
  });

  it("de bout en bout : identifiants réécrits, routes et chemins Windows intacts", () => {
    const root = tree("mac", {
      "app/.next/server/app/page.js": `{layout:[()=>x,"${project}/app/layout.tsx"]}`,
      "app/.next/server/app/route.js": `x("${escaped}\\/node_modules\\/next\\/a.js")`,
      "app/.next/routes.json": '{"routes":["/app/offres","/api/update"],"win":"C:\\\\JobScout\\\\build"}',
    });
    const res = rewriteAbsolutePaths(root, project, NEUTRAL_ROOTS.mac);
    expect(read(root, "app/.next/server/app/page.js")).toBe('{layout:[()=>x,"/JobScout/build/app/layout.tsx"]}');
    expect(read(root, "app/.next/server/app/route.js")).toBe('x("\\/JobScout\\/build\\/node_modules\\/next\\/a.js")');
    expect(read(root, "app/.next/routes.json")).toBe('{"routes":["/app/offres","/api/update"],"win":"C:\\\\JobScout\\\\build"}');
    expect(res).toEqual({ filesTouched: 2, replacements: 2 });
    const all = ["app/.next/server/app/page.js", "app/.next/server/app/route.js"].map((r) => read(root, r)).join("");
    expect(all).not.toContain("/Users/");
    expect(all).not.toContain("\\/Users");
  });

  it("racine d'un seul niveau (« /app ») : refus, elle corromprait les routes", () => {
    expect(() => rewriteForms("/app", NEUTRAL_ROOTS.mac)).toThrow(/trop courte/);
    expect(() => rewriteForms("/", NEUTRAL_ROOTS.mac)).toThrow(/trop courte/);
  });
});

describe("assemble : cible et textes Mac", () => {
  it("--target", () => {
    expect(resolveTarget([])).toBe("windows");
    expect(resolveTarget(["--skip-node"])).toBe("windows");
    expect(resolveTarget(["--target", "mac"])).toBe("mac");
    expect(resolveTarget(["--target=mac"])).toBe("mac");
  });

  it("cible inconnue, ou variant de test sur Mac : refus avant toute écriture", async () => {
    await expect(assemble({ target: "linux" })).rejects.toThrow(/Cible d'assemblage inconnue/);
    await expect(assemble({ target: "mac", variant: VARIANTS.test })).rejects.toThrow(/n'existe pas sur Mac/);
  });

  it("data/LISEZ-MOI.txt du Mac : chemins Mac, fins de ligne \\n, vouvoiement", () => {
    const text = macDataReadme();
    expect(text).toContain("~/Library/Application Support/JobScout");
    expect(text).toContain("vos données");
    expect(text).not.toContain("\r");
    expect(text).not.toMatch(/LOCALAPPDATA|%|\\/);
    expect(text.endsWith("\n")).toBe(true);
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  });
});

describe("icône : marge réglable, .ico Windows identique", () => {
  it("jobscout.ico octet pour octet (empreinte de la 3.4.17)", () => {
    const ico = makeIcon(path.join(tmp, "icon", "jobscout.ico"));
    expect(sha256(fs.readFileSync(ico))).toBe("d00296e86a08a8b7b881a055ee5e6c8271419185ab3144b7e8004f56b00a3a9c");
  });

  it("marge par défaut = 0.03 explicite", () => {
    expect(DEFAULT_MARGIN).toBe(0.03);
    expect(render(32).equals(render(32, { margin: 0.03 }))).toBe(true);
  });

  it("marge 0.1 : dessin réduit au centre, coins et bords transparents", () => {
    const size = 64;
    const alpha = (img: Buffer, x: number, y: number) => img[(y * size + x) * 4 + 3];
    const mac = render(size, { margin: 0.1 });
    const win = render(size);
    expect(mac.length).toBe(size * size * 4);
    // Ligne 3 (≈ 5 % du côté) : dans le carré Windows, hors du carré Mac.
    expect(alpha(win, size / 2, 3)).toBe(255);
    expect(alpha(mac, size / 2, 3)).toBe(0);
    expect(alpha(mac, 3, size / 2)).toBe(0);
    expect(alpha(mac, size / 2, size - 4)).toBe(0);
    // Le carré commence vers 10 % du côté (6,4 px sur 64).
    expect(alpha(mac, size / 2, 8)).toBe(255);
    expect(alpha(mac, 0, 0)).toBe(0);
    expect(alpha(mac, size / 2, size / 2)).toBe(255);
  });

  it("marge hors de [0 ; 0,5[ : refus", () => {
    expect(() => render(16, { margin: 0.5 })).toThrow(RangeError);
    expect(() => render(16, { margin: -0.01 })).toThrow(RangeError);
    expect(() => render(16, { margin: Number.NaN })).toThrow(RangeError);
  });
});

describe("allRoutes (exporté pour le démarrage à blanc du build Mac)", () => {
  it("routes du manifeste, sans /_…, segments dynamiques remplis", () => {
    const payload = tree("routes", {
      "app/.next/app-path-routes-manifest.json": JSON.stringify({
        "/page": "/",
        "/offres/[id]/page": "/offres/[id]",
        "/_not-found/page": "/_not-found",
        "/api/update/route": "/api/update",
        "/api/x/route": "/api/x",
        "/api/x/route2": "/api/x",
      }),
    });
    expect(allRoutes(payload)).toEqual(["/", "/api/update", "/api/x", "/offres/1"]);
  });

  it("sans manifeste : la racine seule", () => {
    expect(allRoutes(path.join(tmp, "absent"))).toEqual(["/"]);
  });
});

describe("tree-digest : instantanés et non-régression", () => {
  const files = {
    "JobScout.exe": "MZ compilé à chaque fois",
    "LISEZ-MOI.txt": "bonjour\r\n",
    "app/server.js": "require('next');\n",
    "app/.next/cache/x.json": "{}",
    "app/data/LISEZ-MOI.txt": "vide\n",
    "app/node_modules/a-b/index.js": "1",
    "app/logs/a.log": "journal",
  };

  it("liste triée « sha256 taille chemin », dossiers compris, même empreinte pour deux copies", () => {
    const a = treeDigest(tree("dg-a", files));
    const b = treeDigest(tree("dg-b", files));
    expect(a.digest).toBe(b.digest);
    expect(a.files).toBe(7);
    expect(a.bytes).toBe(Object.values(files).reduce((n, v) => n + Buffer.byteLength(v), 0));
    const lines = formatDigest(a.entries).trimEnd().split("\n");
    expect(lines).toContain(`${sha256("1")} 1 app/node_modules/a-b/index.js`);
    expect(lines).toContain(`${"-".repeat(64)} dossier app/data/`);
    const paths = a.entries.map((e) => e.path);
    expect(paths).toEqual([...paths].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });

  it("exclusions : nom à toute profondeur, chemin depuis la racine, motifs *", () => {
    const root = tree("dg-ex", files);
    const d = treeDigest(root, { exclude: ["JobScout.exe", "app/.next/cache", "*.log"] });
    const paths = d.entries.map((e) => e.path);
    expect(paths).not.toContain("JobScout.exe");
    expect(paths.some((p) => p.startsWith("app/.next/cache"))).toBe(false);
    expect(paths).not.toContain("app/logs/a.log");
    expect(paths).toContain("app/logs");
    const isEx = compileExcludes(["LISEZ-MOI.txt"]);
    expect(isEx("LISEZ-MOI.txt")).toBe(true);
    expect(isEx("app/data/LISEZ-MOI.txt")).toBe(true);
    expect(compileExcludes(["/LISEZ-MOI.txt/"])("LISEZ-MOI.txt")).toBe(true);
    expect(compileExcludes(["app/**/x.json"])("app/.next/cache/x.json")).toBe(true);
    expect(compileExcludes(["app/*.js"])("app/node_modules/a-b/index.js")).toBe(false);
  });

  it("compareDigests : ajouts, retraits, modifications ; relecture d'une liste", () => {
    const a = treeDigest(tree("dg-c1", files));
    const b = treeDigest(
      tree("dg-c2", { ...files, "app/server.js": "require('next'); \n", "app/nouveau.txt": "x" })
    );
    fs.rmSync(path.join(tmp, "dg-c2", "app", "logs"), { recursive: true });
    const b2 = treeDigest(path.join(tmp, "dg-c2"));
    const cmp = compareDigests(a, b2);
    expect(cmp.equal).toBe(false);
    expect(cmp.added.map((e) => e.path)).toEqual(["app/nouveau.txt"]);
    expect(cmp.removed.map((e) => e.path)).toEqual(["app/logs", "app/logs/a.log"]);
    expect(cmp.changed.map((c) => c.path)).toEqual(["app/server.js"]);
    expect(b.digest).not.toBe(a.digest);

    const relu = parseDigest(formatDigest(a.entries));
    expect(relu.digest).toBe(a.digest);
    expect(compareDigests(a, relu).equal).toBe(true);
    expect(compareDigests(a, b2, { exclude: ["app/nouveau.txt", "server.js", "logs"] }).equal).toBe(true);
  });

  it("CLI : code 0 si identiques, 1 si différences, 2 si usage incorrect", () => {
    const cli = path.join(process.cwd(), "installer", "tree-digest.mjs");
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf-8" }).status;
    const a = tree("cli-a", files);
    const b = tree("cli-b", files);
    const list = path.join(tmp, "cli-a.txt");
    expect(run(a, "--out", list)).toBe(0);
    expect(run("--compare", list, b)).toBe(0);
    fs.writeFileSync(path.join(b, "JobScout.exe"), "MZ recompilé");
    expect(run("--compare", list, b)).toBe(1);
    expect(run("--compare", list, b, "--exclude", "JobScout.exe")).toBe(0);
    expect(run("--compare", list)).toBe(2);
    expect(run(a, "--inconnue")).toBe(2);
  });

  it("liste redirigée par PowerShell (« > ») : UTF-16LE ou BOM UTF-8, fins de ligne \\r\\n", () => {
    const a = tree("ps-a", files);
    const text = formatDigest(treeDigest(a).entries).replace(/\n/g, "\r\n");
    const utf16 = path.join(tmp, "ps-utf16.txt");
    const bom = path.join(tmp, "ps-bom.txt");
    fs.writeFileSync(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
    fs.writeFileSync(bom, "﻿" + text, "utf-8");
    const cli = path.join(process.cwd(), "installer", "tree-digest.mjs");
    for (const list of [utf16, bom]) {
      expect(spawnSync(process.execPath, [cli, "--compare", list, a], { encoding: "utf-8" }).status).toBe(0);
    }
  });

  it("lien symbolique : noté, jamais suivi", () => {
    const root = tree("dg-link", { "Contents/MacOS/node": "binaire" });
    try {
      fs.symlinkSync("/Applications", path.join(root, "Applications"));
    } catch {
      return; // liens non autorisés sur ce poste (Windows sans mode développeur)
    }
    const d = treeDigest(root);
    const link = d.entries.find((e) => e.path === "Applications");
    expect(link?.type).toBe("link");
    expect(link?.sha256).toBe(sha256(fs.readlinkSync(path.join(root, "Applications"))));
    expect(d.links).toBe(1);
    expect(formatDigest(d.entries)).toContain(` lien Applications\n`);
  });
});
