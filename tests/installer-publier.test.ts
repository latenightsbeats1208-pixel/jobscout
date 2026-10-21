import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_NAMES,
  COLLECTION,
  checkCollection,
  checkReleaseBody,
  decide,
  evaluateTestRuns,
  main,
  parseSums,
  verifyRelease,
} from "../installer/mac/publier.mjs";
import { SIGNATURE_MARKERS, renderReleaseNotes } from "../installer/mac/release-notes.mjs";
import { exitCodeFor, selectRuns } from "../installer/mac/ci-status.mjs";

const SHA = "a".repeat(64);
const SUMS_SHA = "b".repeat(64);
const TAG = "v3.4.18";

const asset = (name: string, extra: Record<string, unknown> = {}) => ({
  id: name === "JobScout-Mac.dmg" ? 11 : 12,
  name,
  size: name === "JobScout-Mac.dmg" ? 1000 : 83,
  state: "uploaded",
  digest: `sha256:${name === "JobScout-Mac.dmg" ? SHA : SUMS_SHA}`,
  ...extra,
});
const NOTES_BASE = { version: "3.4.18", repo: "exemple/jobscout", sha256: SHA, sizeBytes: 1000 };
const NOTES = renderReleaseNotes(NOTES_BASE);
const EXPECTED = { body: NOTES, title: "JobScout 3.4.18", signature: "adhoc", commit: null };
const release = (extra: Record<string, unknown> = {}) => ({
  id: 7,
  tag_name: TAG,
  name: "JobScout 3.4.18",
  body: NOTES,
  draft: true,
  html_url: "https://example.test/release/7",
  assets: [] as unknown[],
  ...extra,
});
const local = {
  "JobScout-Mac.dmg": { size: 1000, sha256: SHA },
  "SHA256SUMS.txt": { size: 83, sha256: SUMS_SHA },
};

describe("publier.mjs — decide (créer, compléter, refuser)", () => {
  it("aucune release pour le tag : création d'un brouillon", () => {
    const d = decide({ tag: TAG, releases: [release({ tag_name: "v3.4.17", draft: false })] });
    expect(d.action).toBe("create");
    expect(d.matches).toBe(0);
    expect(d.release).toBeNull();
  });

  it("liste vide ou illisible : création", () => {
    expect(decide({ tag: TAG, releases: [] }).action).toBe("create");
    expect(decide({ tag: TAG, releases: null as unknown as unknown[] }).action).toBe("create");
  });

  it("brouillon existant, vide ou avec les deux fichiers : compléter", () => {
    expect(decide({ tag: TAG, releases: [release()] }).action).toBe("complete");
    const d = decide({ tag: TAG, releases: [release({ assets: ASSET_NAMES.map((n) => asset(n)) })] });
    expect(d.action).toBe("complete");
    expect(d.release.id).toBe(7);
  });

  it("release publiée : refus, jamais remplacée", () => {
    const d = decide({ tag: TAG, releases: [release({ draft: false })] });
    expect(d.action).toBe("refuse");
    expect(d.reason).toContain("jamais remplacée");
  });

  it("pré-version publiée : refus aussi (draft=false)", () => {
    expect(decide({ tag: TAG, releases: [release({ draft: false, prerelease: true })] }).action).toBe("refuse");
  });

  it("champ draft absent : traité comme publié, refus", () => {
    const r: Record<string, unknown> = release();
    delete r.draft;
    expect(decide({ tag: TAG, releases: [r] }).action).toBe("refuse");
  });

  it("plusieurs releases pour le même tag : refus", () => {
    const d = decide({ tag: TAG, releases: [release({ id: 1 }), release({ id: 2 })] });
    expect(d.action).toBe("refuse");
    expect(d.matches).toBe(2);
  });

  it("brouillon avec un fichier inattendu : refus, rien n'est supprimé", () => {
    const d = decide({ tag: TAG, releases: [release({ assets: [asset("JobScout-Mac.dmg"), asset("JobScout_Setup_v3.4.18.exe")] })] });
    expect(d.action).toBe("refuse");
    expect(d.reason).toContain("JobScout_Setup_v3.4.18.exe");
  });
});

describe("publier.mjs — parseSums et checkCollection", () => {
  const sumsText = `${SHA}  JobScout-Mac.dmg\n`;
  const ok = {
    names: [...COLLECTION],
    sumsText,
    dmgSha256: SHA,
    dmgSize: 1000,
    reportText: JSON.stringify({ version: "3.4.18" }),
    version: "3.4.18",
  };

  it("lit le format de shasum (texte et binaire)", () => {
    expect(parseSums(sumsText)).toEqual({ entries: [{ sha256: SHA, name: "JobScout-Mac.dmg" }], errors: [] });
    expect(parseSums(`${SHA.toUpperCase()} *JobScout-Mac.dmg\r\n`).entries).toEqual([{ sha256: SHA, name: "JobScout-Mac.dmg" }]);
    expect(parseSums("pas une empreinte\n").errors).toHaveLength(1);
  });

  it("artefact conforme", () => {
    expect(checkCollection(ok)).toEqual({ ok: true, problems: [] });
  });

  it("fichier manquant ou en trop", () => {
    expect(checkCollection({ ...ok, names: ["JobScout-Mac.dmg", "SHA256SUMS.txt"] }).ok).toBe(false);
    const extra = checkCollection({ ...ok, names: [...COLLECTION, "JobScout.app.zip"] });
    expect(extra.ok).toBe(false);
    expect(extra.problems.join(" ")).toContain("JobScout.app.zip");
  });

  it("empreinte différente du DMG", () => {
    const r = checkCollection({ ...ok, dmgSha256: "c".repeat(64) });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("ne correspond pas");
  });

  it("SHA256SUMS : une seule ligne, pour le DMG", () => {
    expect(checkCollection({ ...ok, sumsText: `${SHA}  JobScout-Mac.dmg\n${SHA}  autre.dmg\n` }).ok).toBe(false);
    expect(checkCollection({ ...ok, sumsText: `${SHA}  installer/output/mac/JobScout-Mac.dmg\n` }).ok).toBe(false);
    expect(checkCollection({ ...ok, sumsText: "" }).ok).toBe(false);
  });

  it("rapport illisible ou d'une autre version", () => {
    expect(checkCollection({ ...ok, reportText: "{" }).ok).toBe(false);
    expect(checkCollection({ ...ok, reportText: JSON.stringify({ version: "3.4.17" }) }).ok).toBe(false);
    expect(checkCollection({ ...ok, reportText: JSON.stringify({ fichiers: 12 }) }).ok).toBe(true);
  });

  it("DMG vide", () => {
    expect(checkCollection({ ...ok, dmgSize: 0 }).ok).toBe(false);
  });
});

describe("publier.mjs — verifyRelease (constat)", () => {
  const good = () => [release({ assets: ASSET_NAMES.map((n) => asset(n)) })];

  it("brouillon conforme : empreintes relues dans l'API", () => {
    const v = verifyRelease({ tag: TAG, releases: good(), local, notes: EXPECTED });
    expect(v.ok).toBe(true);
    expect(v.problems).toEqual([]);
    expect(v.toDownload).toEqual([]);
  });

  it("digest absent : le fichier est à retélécharger, pas un succès supposé", () => {
    const v = verifyRelease({
      tag: TAG,
      releases: [release({ assets: [asset("JobScout-Mac.dmg", { digest: null }), asset("SHA256SUMS.txt")] })],
      local,
      notes: EXPECTED,
    });
    expect(v.ok).toBe(true);
    expect(v.toDownload).toEqual([{ id: 11, name: "JobScout-Mac.dmg" }]);
  });

  it("empreinte, taille ou état différents : échec", () => {
    const wrongDigest = [release({ assets: [asset("JobScout-Mac.dmg", { digest: `sha256:${"0".repeat(64)}` }), asset("SHA256SUMS.txt")] })];
    expect(verifyRelease({ tag: TAG, releases: wrongDigest, local, notes: EXPECTED }).ok).toBe(false);
    const wrongSize = [release({ assets: [asset("JobScout-Mac.dmg", { size: 999 }), asset("SHA256SUMS.txt")] })];
    expect(verifyRelease({ tag: TAG, releases: wrongSize, local, notes: EXPECTED }).ok).toBe(false);
    const pending = [release({ assets: [asset("JobScout-Mac.dmg", { state: "starter" }), asset("SHA256SUMS.txt")] })];
    expect(verifyRelease({ tag: TAG, releases: pending, local, notes: EXPECTED }).ok).toBe(false);
  });

  it("pas exactement deux fichiers : échec", () => {
    const one = [release({ assets: [asset("JobScout-Mac.dmg")] })];
    expect(verifyRelease({ tag: TAG, releases: one, local, notes: EXPECTED }).ok).toBe(false);
    const three = [release({ assets: [...ASSET_NAMES.map((n) => asset(n)), asset("rapport-construction.json", { id: 13 })] })];
    expect(verifyRelease({ tag: TAG, releases: three, local, notes: EXPECTED }).ok).toBe(false);
  });

  it("release publiée, absente ou en double : échec", () => {
    expect(verifyRelease({ tag: TAG, releases: [release({ draft: false, assets: ASSET_NAMES.map((n) => asset(n)) })], local, notes: EXPECTED }).ok).toBe(false);
    expect(verifyRelease({ tag: TAG, releases: [], local, notes: EXPECTED }).ok).toBe(false);
    expect(verifyRelease({ tag: TAG, releases: [...good(), ...good()], local, notes: EXPECTED }).ok).toBe(false);
  });

  it("texte périmé (empreinte de la construction précédente) : échec, même si les fichiers sont bons", () => {
    const stale = renderReleaseNotes({ ...NOTES_BASE, sha256: "c".repeat(64) });
    const v = verifyRelease({ tag: TAG, releases: [release({ body: stale, assets: ASSET_NAMES.map((n) => asset(n)) })], local, notes: EXPECTED });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("empreinte affichée cccccccccccc");
  });

  it("titre différent, texte vide ou texte attendu absent : échec", () => {
    const files = { assets: ASSET_NAMES.map((n) => asset(n)) };
    expect(verifyRelease({ tag: TAG, releases: [release({ ...files, name: "JobScout 3.4.17" })], local, notes: EXPECTED }).ok).toBe(false);
    expect(verifyRelease({ tag: TAG, releases: [release({ ...files, body: null })], local, notes: EXPECTED }).ok).toBe(false);
    const sans = verifyRelease({ tag: TAG, releases: [release(files)], local });
    expect(sans.ok).toBe(false);
    expect(sans.problems.join(" ")).toContain("texte attendu");
  });
});

describe("publier.mjs — checkReleaseBody (texte de la Release)", () => {
  const exp = (extra: Record<string, unknown> = {}) => ({ ...EXPECTED, sha256: SHA, sizeBytes: 1000, ...extra });

  it("texte identique : aucun problème ni avertissement ; fins de ligne CRLF acceptées", () => {
    expect(checkReleaseBody(NOTES, exp())).toEqual({ problems: [], warnings: [] });
    expect(checkReleaseBody(NOTES.replace(/\n/g, "\r\n"), exp())).toEqual({ problems: [], warnings: [] });
  });

  it("l'empreinte doit être seule sur sa ligne (pas un préfixe d'une autre)", () => {
    const glued = NOTES.replace(`\n${SHA}\n`, `\n${SHA}0\n`);
    expect(checkReleaseBody(glued, exp()).problems.join(" ")).toContain("empreinte");
  });

  it("mode ad hoc affiché pour une app Developer ID : échec dans les deux sens", () => {
    const adhoc = checkReleaseBody(NOTES, exp({ signature: "developer-id" }));
    expect(adhoc.problems.join(" ")).toContain(SIGNATURE_MARKERS["developer-id"]);
    expect(adhoc.problems.join(" ")).toContain(SIGNATURE_MARKERS.adhoc);
    const devid = renderReleaseNotes({ ...NOTES_BASE, signature: "developer-id" });
    expect(checkReleaseBody(devid, exp({ signature: "developer-id", body: devid })).problems).toEqual([]);
    expect(checkReleaseBody(devid, exp()).problems.length).toBeGreaterThan(0);
  });

  it("taille ou commit d'une autre construction : échec", () => {
    expect(checkReleaseBody(renderReleaseNotes({ ...NOTES_BASE, sizeBytes: 5 * 1024 * 1024 }), exp()).problems.join(" ")).toContain("taille");
    const c1 = "1".repeat(40);
    const c2 = "2".repeat(40);
    const old = renderReleaseNotes({ ...NOTES_BASE, commit: c1 });
    expect(checkReleaseBody(old, exp({ commit: c2 })).problems.join(" ")).toContain("commit");
    expect(checkReleaseBody(old, exp({ commit: c1, body: old })).problems).toEqual([]);
  });

  it("autre écart (Markdown retouché par l'API) : avertissement seulement", () => {
    const r = checkReleaseBody(NOTES.replace("## Windows et Linux", "## Windows  et Linux"), exp());
    expect(r.problems).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
});

describe("publier.mjs — evaluateTestRuns (attendre-tests)", () => {
  type Run = { databaseId: number; event: string; status: string; conclusion: string | null };
  const run = (extra: Partial<Run>): Run => ({ databaseId: 1, event: "push", status: "completed", conclusion: "success", ...extra });

  it("aucun run push : attendre", () => {
    expect(evaluateTestRuns([]).state).toBe("wait");
    expect(evaluateTestRuns([run({ event: "pull_request" })]).state).toBe("wait");
  });

  it("un run en cours : attendre", () => {
    expect(evaluateTestRuns([run({}), run({ databaseId: 2, status: "in_progress", conclusion: null })]).state).toBe("wait");
  });

  it("tous terminés et verts : ok", () => {
    expect(evaluateTestRuns([run({}), run({ databaseId: 2 })]).state).toBe("ok");
  });

  it("un seul échec ou annulation parmi les runs push : échec", () => {
    expect(evaluateTestRuns([run({}), run({ databaseId: 2, conclusion: "failure" })]).state).toBe("fail");
    expect(evaluateTestRuns([run({ conclusion: "cancelled" })]).state).toBe("fail");
  });

  it("un échec hors push (pull_request) ne compte pas", () => {
    expect(evaluateTestRuns([run({}), run({ databaseId: 3, event: "pull_request", conclusion: "failure" })]).state).toBe("ok");
  });
});

describe("ci-status.mjs — selectRuns et exitCodeFor (alignés sur attendre-tests)", () => {
  // Même commit S : ci.yml en échec sur verif/… (run A), puis main avancé sur S
  // et ci.yml vert (run B, plus récent). Mêmes workflow_id et événement.
  type ApiRun = { id: number; name: string; path: string; workflow_id: number; event: string; head_branch: string;
    status: string; conclusion: string | null; created_at: string; run_attempt: number };
  const apiRun = (extra: Partial<ApiRun>): ApiRun => ({
    id: 1, name: "CI", path: ".github/workflows/ci.yml", workflow_id: 55, event: "push", head_branch: "main",
    status: "completed", conclusion: "success", created_at: "2026-10-21T09:00:00Z", run_attempt: 1, ...extra,
  });
  const a = apiRun({ id: 101, head_branch: "verif/mac-installer-3.4.18", conclusion: "failure", created_at: "2026-10-21T08:00:00Z" });
  const b = apiRun({ id: 202 });
  const asGh = (runs: ApiRun[]) => runs.map((r) => ({ databaseId: r.id, event: r.event, status: r.status, conclusion: r.conclusion }));

  it("deux runs du même workflow sur le commit : les deux gardés, l'échec n'est pas masqué (code 1)", () => {
    const kept = selectRuns([b, a]);
    expect(kept.map((r) => r.id)).toEqual([101, 202]);
    expect(exitCodeFor(kept)).toBe(1);
    expect(evaluateTestRuns(asGh(kept)).state).toBe("fail");
  });

  it("un run en cours et l'autre vert : en cours (code 3), comme attendre-tests qui attend", () => {
    const running = apiRun({ id: 101, head_branch: "verif/mac-installer-3.4.18", status: "in_progress", conclusion: null, created_at: "2026-10-21T08:00:00Z" });
    const kept = selectRuns([b, running]);
    expect(kept).toHaveLength(2);
    expect(exitCodeFor(kept)).toBe(3);
    expect(evaluateTestRuns(asGh(kept)).state).toBe("wait");
  });

  it("filtre par workflow (nom ou fichier), doublon d'identifiant écarté, tri par nom puis date", () => {
    const mac = apiRun({ id: 303, name: "Installeur Mac", path: ".github/workflows/installeur-mac.yml", workflow_id: 66 });
    expect(selectRuns([mac, b, a], "ci.yml").map((r) => r.id)).toEqual([101, 202]);
    expect(selectRuns([mac, b, a], "Installeur Mac").map((r) => r.id)).toEqual([303]);
    expect(selectRuns([b, b, a]).map((r) => r.id)).toEqual([101, 202]);
    expect(selectRuns([mac, b, a]).map((r) => r.id)).toEqual([101, 202, 303]);
    expect(exitCodeFor(selectRuns([b]))).toBe(0);
    expect(exitCodeFor(selectRuns([]))).toBe(4);
  });
});

describe("release-notes.mjs — texte de la Release", () => {
  const base = { version: "3.4.18", repo: "exemple/jobscout", sha256: SHA, sizeBytes: 150 * 1024 * 1024 };

  it("ad hoc : parcours Gatekeeper, empreinte, taille, liens vers le tag", () => {
    const t = renderReleaseNotes({ ...base, commit: "0123456789abcdef0123456789abcdef01234567", changelog: "Application JobScout pour Mac." });
    expect(t).toContain("Ouvrir quand même");
    expect(t).toContain("Placer dans la corbeille");
    expect(t).toContain(SHA);
    expect(t).toContain("150,0 Mo");
    expect(t).toContain("https://github.com/exemple/jobscout/blob/v3.4.18/INSTALL-MAC.md#premier-lancement--autoriser-jobscout-une-fois-par-version");
    expect(t).toContain("## Nouveautés de la version 3.4.18");
    expect(t).toContain("gh attestation verify JobScout-Mac.dmg --repo exemple/jobscout");
  });

  it("aucun contournement par le Terminal (xattr) n'est proposé", () => {
    for (const signature of ["adhoc", "developer-id"]) {
      expect(renderReleaseNotes({ ...base, signature })).not.toMatch(/xattr|quarantine/i);
    }
  });

  it("Developer ID : pas d'étape « Ouvrir quand même »", () => {
    const t = renderReleaseNotes({ ...base, signature: "developer-id" });
    expect(t).toContain("signé et notarisé par Apple");
    expect(t).not.toContain("Ouvrir quand même");
  });

  it("entrées invalides refusées", () => {
    expect(() => renderReleaseNotes({ ...base, signature: "partielle" })).toThrow();
    expect(() => renderReleaseNotes({ ...base, sha256: "abc" })).toThrow();
    expect(() => renderReleaseNotes({ ...base, version: "3.4" })).toThrow();
    expect(() => renderReleaseNotes({ ...base, repo: "pas-un-depot" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Orchestration de bout en bout, avec un faux GitHub (aucun réseau) : seules
// les commandes gh attendues sont envoyées, et JAMAIS d'écriture sur une
// Release publiée.
// ---------------------------------------------------------------------------
type GhResult = { code: number | null; stdout: string; stderr: string };
type GhFn = (args: string[], opts?: { stdoutFile?: string | null }) => GhResult;
type FakeAsset = { id: number; name: string; size: number; state: string; digest: string | null };
type FakeRelease = { id: number; tag_name: string; name: string; body: string; draft: boolean; html_url: string; assets: FakeAsset[] };

const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex");
const fakeRelease = (extra: Partial<FakeRelease> = {}): FakeRelease => ({
  id: 7,
  tag_name: TAG,
  name: "JobScout 3.4.18",
  body: "",
  draft: true,
  html_url: "https://example.test/release/7",
  assets: [],
  ...extra,
});

/** Valeur de l'option `flag` (ex. --title) dans des arguments gh. */
const optionValue = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function fakeGitHub(
  initial: FakeRelease[],
  { digests = true, patch = "apply" }: { digests?: boolean; patch?: "apply" | "ignore" | "fail" } = {}
) {
  const releases: FakeRelease[] = JSON.parse(JSON.stringify(initial));
  const calls: string[][] = [];
  const stored = new Map<number, Buffer>();
  let runs: unknown[] = [];
  let nextId = 100;
  const addAsset = (rel: FakeRelease, file: string) => {
    const buf = fs.readFileSync(file);
    const name = path.basename(file);
    rel.assets = rel.assets.filter((a) => a.name !== name);
    const id = nextId++;
    stored.set(id, buf);
    rel.assets.push({ id, name, size: buf.length, state: "uploaded", digest: digests ? `sha256:${sha256(buf)}` : null });
  };
  const gh: GhFn = (args, opts = {}) => {
    calls.push(args);
    const ok = (stdout = ""): GhResult => ({ code: 0, stdout, stderr: "" });
    if (args[0] === "api" && /\/releases\?per_page=100&page=\d+$/.test(args[3] ?? "")) {
      return ok(args[3].endsWith("page=1") ? JSON.stringify(releases) : "[]");
    }
    const asset = /\/releases\/assets\/(\d+)$/.exec(args[3] ?? "");
    if (args[0] === "api" && asset && opts.stdoutFile) {
      fs.writeFileSync(opts.stdoutFile, stored.get(Number(asset[1])) ?? Buffer.alloc(0));
      return ok();
    }
    if (args[0] === "release" && args[1] === "create") {
      const rel = fakeRelease({
        id: nextId++,
        tag_name: args[2],
        name: optionValue(args, "--title") ?? "",
        body: fs.readFileSync(optionValue(args, "--notes-file") ?? "", "utf-8"),
        draft: args.includes("--draft"),
        html_url: "https://example.test/brouillon",
      });
      for (const f of args.slice(-2)) addAsset(rel, f);
      releases.push(rel);
      return ok();
    }
    if (args[0] === "release" && args[1] === "upload") {
      const rel = releases.find((r) => r.tag_name === args[2]);
      if (!rel) return { code: 1, stdout: "", stderr: "release not found" };
      for (const f of args.slice(-2)) addAsset(rel, f);
      return ok();
    }
    // PATCH repos/<dépôt>/releases/<id> -F body=@<fichier> -f name=<titre>
    const byId = args.map((a) => /^repos\/[^/]+\/[^/]+\/releases\/(\d+)$/.exec(a)).find(Boolean);
    if (args[0] === "api" && optionValue(args, "-X") === "PATCH" && byId) {
      if (patch === "fail") return { code: 1, stdout: "", stderr: "HTTP 422" };
      const rel = releases.find((r) => r.id === Number(byId[1]));
      if (!rel) return { code: 1, stdout: "", stderr: "HTTP 404" };
      if (patch === "apply") {
        for (let i = 0; i < args.length - 1; i++) {
          const v = args[i + 1];
          if (args[i] === "-F" && v.startsWith("body=@")) rel.body = fs.readFileSync(v.slice("body=@".length), "utf-8");
          if (args[i] === "-f" && v.startsWith("name=")) rel.name = v.slice("name=".length);
        }
      }
      return ok(JSON.stringify(rel));
    }
    if (args[0] === "run" && args[1] === "list") return ok(JSON.stringify(runs));
    return { code: 1, stdout: "", stderr: `commande inattendue : ${args.join(" ")}` };
  };
  return {
    gh,
    calls,
    releases,
    writes: () => calls.filter((c) => c[0] === "release" || (c[0] === "api" && optionValue(c, "-X") === "PATCH")),
    setRuns: (r: unknown[]) => {
      runs = r;
    },
  };
}

describe("publier.mjs — orchestration (faux GitHub, sans réseau)", () => {
  let dir = "";
  let out: string[] = [];
  const env = () => ({ GH_REPO: "exemple/jobscout", RUNNER_TEMP: dir, SIGNATURE: "adhoc", GITHUB_SHA: "0".repeat(40) });
  const deps = (gh: GhFn) => ({ gh, sleep: async () => undefined });
  const publier = (gh: GhFn, extra: string[] = []) =>
    main(["publier", "--dir", path.join(dir, "artefact"), "--tag", TAG, ...extra], env(), deps(gh));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-publier-"));
    const art = path.join(dir, "artefact");
    fs.mkdirSync(art);
    const dmg = Buffer.from("contenu du DMG de test");
    fs.writeFileSync(path.join(art, "JobScout-Mac.dmg"), dmg);
    fs.writeFileSync(path.join(art, "SHA256SUMS.txt"), `${sha256(dmg)}  JobScout-Mac.dmg\n`);
    fs.writeFileSync(path.join(art, "rapport-construction.json"), JSON.stringify({ version: "3.4.18" }));
    out = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("aucune release : brouillon créé (--draft --verify-tag), puis constaté par retéléchargement", async () => {
    const fake = fakeGitHub([], { digests: false });
    expect(await publier(fake.gh)).toBe(0);
    expect(fake.releases[0].body.split("\n")).toContain(sha256(fs.readFileSync(path.join(dir, "artefact", "JobScout-Mac.dmg"))));
    const create = fake.writes();
    expect(create).toHaveLength(1);
    expect(create[0].slice(0, 3)).toEqual(["release", "create", TAG]);
    expect(create[0]).toEqual(expect.arrayContaining(["--draft", "--verify-tag", "--title", "JobScout 3.4.18"]));
    expect(fake.releases[0].draft).toBe(true);
    expect(fake.releases[0].assets.map((a) => a.name).sort()).toEqual([...ASSET_NAMES].sort());
    expect(fake.calls.filter((c) => c[0] === "api" && /releases\/assets\//.test(c[3] ?? ""))).toHaveLength(2);
    expect(out.join("")).toContain("retéléchargé et recalculé");
  });

  it("brouillon existant : fichiers remplacés par upload --clobber, puis titre et texte réécrits par l'identifiant", async () => {
    const fake = fakeGitHub([fakeRelease()]);
    expect(await publier(fake.gh)).toBe(0);
    const w = fake.writes();
    expect(w).toHaveLength(2);
    expect(w[0]).toEqual(expect.arrayContaining(["release", "upload", TAG, "--clobber"]));
    expect(w[1]).toEqual(expect.arrayContaining(["api", "-X", "PATCH", "repos/exemple/jobscout/releases/7", "-f", "name=JobScout 3.4.18"]));
    expect(w[1]).not.toContain("draft=false");
    expect(fake.releases[0].draft).toBe(true);
    expect(out.join("")).toContain("empreinte relue dans l'API");
  });

  it("brouillon complété après une reconstruction Developer ID : l'ancien texte (autre SHA, ad hoc) est remplacé", async () => {
    const dmgSha = sha256(fs.readFileSync(path.join(dir, "artefact", "JobScout-Mac.dmg")));
    const oldBody = renderReleaseNotes({ version: "3.4.18", repo: "exemple/jobscout", sha256: "d".repeat(64), sizeBytes: 9 * 1024 * 1024, signature: "adhoc", commit: "1".repeat(40) });
    const fake = fakeGitHub([fakeRelease({ name: "Ancien titre", body: oldBody })]);
    const code = await main(["publier", "--dir", path.join(dir, "artefact"), "--tag", TAG], { ...env(), SIGNATURE: "developer-id" }, deps(fake.gh));
    expect(code).toBe(0);
    const body = fake.releases[0].body;
    expect(body.split("\n")).toContain(dmgSha);
    expect(body).not.toContain("d".repeat(64));
    expect(body).toContain(SIGNATURE_MARKERS["developer-id"]);
    expect(body).not.toContain(SIGNATURE_MARKERS.adhoc);
    expect(body).toContain(`/commit/${"0".repeat(40)})`);
    expect(fake.releases[0].name).toBe("JobScout 3.4.18");
  });

  it("brouillon complété mais texte non réécrit par GitHub : le constat échoue (code 1)", async () => {
    const oldBody = renderReleaseNotes({ version: "3.4.18", repo: "exemple/jobscout", sha256: "d".repeat(64), sizeBytes: 9 * 1024 * 1024 });
    const fake = fakeGitHub([fakeRelease({ body: oldBody })], { patch: "ignore" });
    expect(await publier(fake.gh)).toBe(1);
    expect(out.join("")).toContain("constat en échec");
    expect(out.join("")).toContain("empreinte affichée dddddddddddd");
  });

  it("brouillon complété mais réécriture du texte refusée : code 1, pas de constat", async () => {
    const fake = fakeGitHub([fakeRelease()], { patch: "fail" });
    expect(await publier(fake.gh)).toBe(1);
    expect(out.join("")).toContain("réécriture du texte du brouillon");
    expect(out.join("")).not.toContain("constat…");
  });

  it("release publiée : code 1 et AUCUNE écriture", async () => {
    const fake = fakeGitHub([fakeRelease({ draft: false })]);
    expect(await publier(fake.gh)).toBe(1);
    expect(fake.writes()).toEqual([]);
    expect(out.join("")).toContain("jamais remplacée");
  });

  it("essai à blanc : décision affichée, code 0, aucune écriture", async () => {
    for (const initial of [[], [fakeRelease({ draft: false })]]) {
      const fake = fakeGitHub(initial);
      expect(await publier(fake.gh, ["--dry-run"])).toBe(0);
      expect(fake.writes()).toEqual([]);
    }
    expect(out.join("")).toContain("créerait le brouillon");
    expect(out.join("")).toContain("refuserait");
  });

  it("artefact avec un fichier en trop : code 1 avant tout appel à GitHub", async () => {
    fs.writeFileSync(path.join(dir, "artefact", "JobScout.app.zip"), "x");
    const fake = fakeGitHub([]);
    expect(await publier(fake.gh)).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  it("constat en échec (taille en ligne différente) : code 1", async () => {
    const fake = fakeGitHub([]);
    const gh: GhFn = (args, opts) => {
      const r = fake.gh(args, opts);
      for (const rel of fake.releases) for (const a of rel.assets) if (a.name === "JobScout-Mac.dmg") a.size += 1;
      return r;
    };
    expect(await publier(gh)).toBe(1);
    expect(out.join("")).toContain("constat en échec");
  });

  it("usage : GH_REPO absent ou sous-commande inconnue → code 2, aucun appel", async () => {
    const fake = fakeGitHub([]);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await main(["publier", "--dir", dir], { RUNNER_TEMP: dir }, deps(fake.gh))).toBe(2);
    expect(await main(["publie"], env(), deps(fake.gh))).toBe(2);
    expect(fake.calls).toEqual([]);
  });

  it("attendre-tests : vert → 0, échec → 1", async () => {
    const fake = fakeGitHub([]);
    fake.setRuns([{ databaseId: 1, event: "push", status: "completed", conclusion: "success" }]);
    expect(await main(["attendre-tests", "--sha", "a".repeat(40), "--minutes", "1"], env(), deps(fake.gh))).toBe(0);
    fake.setRuns([{ databaseId: 2, event: "push", status: "completed", conclusion: "failure" }]);
    expect(await main(["attendre-tests", "--sha", "a".repeat(40), "--minutes", "1"], env(), deps(fake.gh))).toBe(1);
  });
});
