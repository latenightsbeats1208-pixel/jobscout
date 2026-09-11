// ============================================================================
// installer/test-install.mjs — recette de bout en bout de l'installeur.
//
//   node installer/test-install.mjs
//   node installer/test-install.mjs --variant test   (installeur « JobScout Test »)
//
// Variant de test (voir variant.mjs) : installeur JobScout_Test_Setup_*, dossier
// et raccourcis « JobScout Test », données sous %LOCALAPPDATA%\JobScout Test,
// et contrôles supplémentaires — INFO-INSTALLATION.txt présent dans le dist,
// composants annoncés cohérents avec le dist réel (5 %), TOTAL annoncé cohérent
// avec l'arborescence RÉELLEMENT installée (désinstalleur compris, 5 %, jamais
// inférieur) et avec EstimatedSize du registre, base VIERGE, nom de
// désinstallation et pastille de version « JobScout Test ».
//
// Pour tous les variants : ressource de version du launcher (FileVersion,
// ProductName, FileDescription) et journal logs\server.log en UTF-8 lisible.
//
// Ce que le test prouve, sur cette machine, avant tout essai sur PC vierge :
//   1. l'installeur s'installe en silence, par utilisateur, sans élévation ;
//   2. l'arborescence installée ne contient AUCUNE donnée personnelle
//      (check-leaks rejoué sur les fichiers réellement posés sur le disque) ;
//   3. l'application démarre avec un PATH MINIMAL — donc sans le Node ni le
//      Python de la machine : seul le node.exe embarqué peut la faire tourner ;
//   4. sur données vierges, « / » renvoie sur l'onboarding (gate bloquant) ;
//   5. après création d'un profil, toutes les pages répondent 200 ;
//   6. la base se crée bien dans le répertoire de données, pas dans {app} ;
//   7. la désinstallation silencieuse nettoie {app} et conserve les données.
//
// Le test n'utilise JAMAIS la base réelle : il pointe JOBSCOUT_DATA_DIR sur un
// dossier temporaire et prend un port dédié (l'instance de dev reste libre).
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { checkLeaks } from "./check-leaks.mjs";
import { resolveVariant } from "./variant.mjs";
import { INFO_FILE_NAME, dirSize, measurePayload, parseInfoSizes, toMo } from "./install-info.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const TEST_PORT = 3921; // volontairement loin du 3000 de l'instance de dev

const log = (m) => process.stdout.write(`[test] ${m}\n`);
const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  process.stdout.write(`  ${ok ? "OK  " : "ÉCHEC"} ${label}${detail ? ` — ${detail}` : ""}\n`);
  return ok;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function version() {
  return JSON.parse(fs.readFileSync(path.join(PROJECT, "version.json"), "utf-8")).version;
}

async function waitFor(fn, timeoutMs, everyMs = 500) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(everyMs);
  }
  return false;
}

async function get(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    const text = res.status < 400 ? await res.text() : "";
    return { status: res.status, location: res.headers.get("location"), text };
  } catch (e) {
    return { status: 0, location: null, text: "", error: e.message };
  }
}

/**
 * Compte les lignes des tables qui portent des données utilisateur — lecture
 * SQLite directe (node:sqlite, comme l'application), en lecture seule.
 */
async function countRows(dbFile) {
  const { DatabaseSync } = await import("node:sqlite");
  let lastError = "";
  // La base est en WAL et le serveur la tient ouverte : quelques tentatives
  // absorbent un verrou transitoire (Windows relâche les handles avec retard).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const db = new DatabaseSync(dbFile, { readOnly: true });
      try {
        const n = (table) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
        const counts = { profile: n("profile"), offres: n("offres"), documents: n("documents") };
        return {
          ok: true,
          empty: counts.profile === 0 && counts.offres === 0 && counts.documents === 0,
          detail: `profil=${counts.profile} offres=${counts.offres} documents=${counts.documents}`,
        };
      } finally {
        db.close();
      }
    } catch (e) {
      lastError = e.message;
      await sleep(500);
    }
  }
  return { ok: false, empty: false, detail: lastError };
}

/** Valeur brute d'une entrée « Applications » écrite par Inno (HKCU, AppId_is1). */
function readUninstallValue(appId, name) {
  const key = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appId}_is1`;
  try {
    const out = execFileSync("reg", ["query", key, "/v", name], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = new RegExp(name + "\\s+REG_(?:SZ|DWORD)\\s+(.+?)\\s*$", "m").exec(out);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function readUninstallDisplayName(appId) {
  return readUninstallValue(appId, "DisplayName");
}

/** EstimatedSize (Ko) calculé par Inno à l'installation — REG_DWORD en hexa. */
function readUninstallEstimatedKb(appId) {
  const raw = readUninstallValue(appId, "EstimatedSize");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ressource de version d'un exécutable (FileVersion, ProductName,
 * FileDescription…), lue par PowerShell — ce que SmartScreen et le
 * Gestionnaire des tâches affichent.
 */
function readVersionInfo(exe) {
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
          `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo | ` +
          "Select-Object FileVersion, ProductVersion, ProductName, FileDescription, CompanyName | " +
          "ConvertTo-Json -Compress",
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return JSON.parse(out);
  } catch {
    return {};
  }
}

export async function run() {
  const v = version();
  const variant = resolveVariant();
  const isTest = variant.id !== "prod";
  if (isTest) log(`variant : ${variant.id} (${variant.appName})`);
  const setup = path.join(HERE, "output", `${variant.setupBaseName(v)}.exe`);
  if (!fs.existsSync(setup)) throw new Error(`Installeur absent : ${setup}`);

  // Le bac à sable est placé hors du profil utilisateur : Inno Setup écrit le
  // chemin d'installation dans son journal `unins000.dat`, et un dossier sous
  // C:\Users\<nom> ferait échouer le contrôle anti-fuite pour une raison qui
  // n'a rien à voir avec le paquet.
  const sandboxRoot = path.join(
    process.env.PUBLIC || path.join(process.env.SystemDrive || "C:", "Users", "Public"),
    "JobScoutRecette"
  );
  fs.mkdirSync(sandboxRoot, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(sandboxRoot, "e2e-"));
  const installDir = path.join(sandbox, "Program");
  const dataDir = path.join(sandbox, "Data");
  const setupLog = path.join(sandbox, "setup.log");
  log(`bac à sable : ${sandbox}`);

  let server = null;
  try {
    // ------------------------------------------------------- 1. installation
    log("installation silencieuse…");
    execFileSync(
      setup,
      [
        "/VERYSILENT",
        "/SUPPRESSMSGBOXES",
        "/NORESTART",
        "/NOCANCEL",
        "/CURRENTUSER",
        `/DIR=${installDir}`,
        `/LOG=${setupLog}`,
        "/TASKS=", // aucun raccourci : on ne pollue pas le Bureau de la machine
      ],
      { stdio: "inherit" }
    );
    check("installation silencieuse par utilisateur", fs.existsSync(installDir));

    const expected = [
      "JobScout.exe",
      "jobscout.ico",
      "LISEZ-MOI.txt",
      ...(isTest ? [INFO_FILE_NAME] : []),
      path.join("runtime", "node.exe"),
      path.join("app", "server.js"),
      path.join("app", "version.json"),
      path.join("app", "lib", "db", "schema.sql"),
      path.join("app", "prompts", "generate-cv.md"),
      path.join("app", ".next", "static"),
      path.join("app", "node_modules", "playwright-core", "cli.js"),
      path.join("app", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
      path.join("app", "node_modules", "next", "dist", "lib", "metadata", "get-metadata-route.js"),
      path.join("app", "data", "LISEZ-MOI.txt"),
    ];
    for (const rel of expected) {
      check(`présent : ${rel}`, fs.existsSync(path.join(installDir, rel)));
    }
    check(
      "aucun .env installé",
      !fs.existsSync(path.join(installDir, "app", ".env"))
    );

    // Ressource de version du launcher : sans elle JobScout.exe est anonyme
    // dans SmartScreen et le Gestionnaire des tâches (FileVersion 0.0.0.0,
    // ProductName vide). Générée par launcher/build-launcher.mjs depuis
    // version.json et le variant.
    const vi = readVersionInfo(path.join(installDir, "JobScout.exe"));
    check(
      `launcher : FileVersion ${vi.FileVersion ?? "absent"} (attendu ${v}.0)`,
      vi.FileVersion === `${v}.0`
    );
    check(
      `launcher : ProductName et FileDescription « ${variant.appName} »`,
      vi.ProductName === variant.appName && vi.FileDescription === variant.appName,
      `ProductName=${vi.ProductName ?? "absent"} FileDescription=${vi.FileDescription ?? "absent"} CompanyName=${vi.CompanyName ?? "absent"}`
    );
    check(
      "aucun navigateur Chromium embarqué (LinkedIn opt-in)",
      !fs.existsSync(path.join(installDir, "app", "node_modules", "playwright-core", ".local-browsers"))
    );

    // Entrée « Applications » de Windows : « JobScout 3.4.4 » / « JobScout Test
    // 3.4.4 », sous l'AppId du variant (clé distincte = coexistence possible).
    const displayName = readUninstallDisplayName(variant.appId);
    check(
      `désinstallation enregistrée sous « ${variant.appName} ${v} »`,
      displayName === `${variant.appName} ${v}`,
      displayName ?? "clé de désinstallation absente du registre"
    );

    // ------------------------------- 1 bis. page d'information (variant test)
    // INFO-INSTALLATION.txt est généré par assemble.mjs avec des tailles
    // MESURÉES : on le relit dans le dist et dans l'arborescence installée, et
    // on confronte chaque chiffre annoncé au dist réel — tolérance 5 %, ou
    // 1 Mo pour absorber l'arrondi des petits composants (le lanceur < 1 Mo).
    if (isTest) {
      const distPayload = path.join(HERE, "dist", "JobScout");
      const distInfo = path.join(distPayload, INFO_FILE_NAME);
      check(`${INFO_FILE_NAME} présent dans le dist`, fs.existsSync(distInfo), distInfo);
      let text = "";
      try { text = fs.readFileSync(distInfo, "utf-8"); } catch {}
      const installedInfo = path.join(installDir, INFO_FILE_NAME);
      check(
        `${INFO_FILE_NAME} installé identique au dist`,
        !!text && fs.existsSync(installedInfo) && fs.readFileSync(installedInfo, "utf-8") === text
      );
      check(
        `${INFO_FILE_NAME} : titre « ${variant.appName} — build de test v${v} »`,
        text.includes(`${variant.appName} — build de test v${v}`)
      );
      const announced = parseInfoSizes(text);
      const real = measurePayload(distPayload);
      // Composants de la charge utile : confrontés au dist (ce qui est dans
      // le paquet).
      for (const key of ["launcher", "runtime", "app"]) {
        const realMo = toMo(real[key]);
        const a = announced[key];
        const tolerance = Math.max(1, realMo * 0.05);
        check(
          `${INFO_FILE_NAME} : ${key} annoncé ${a ?? "?"} Mo, dist réel ${realMo.toFixed(1)} Mo (±5 %)`,
          a != null && Math.abs(a - realMo) <= tolerance
        );
      }
      // Désinstalleur et TOTAL : confrontés à l'arborescence RÉELLEMENT
      // installée — unins000.exe / unins000.dat sont écrits par Inno sur la
      // machine cible, ils n'existent pas dans le dist. Le total annoncé ne
      // doit jamais être inférieur à ce qui est posé sur le disque.
      const uninsFiles = fs
        .readdirSync(installDir)
        .filter((n) => /^unins\d+\.(exe|dat)$/i.test(n));
      const uninsBytes = uninsFiles.reduce(
        (n, name) => n + fs.statSync(path.join(installDir, name)).size,
        0
      );
      const uninsMo = toMo(uninsBytes);
      check(
        `${INFO_FILE_NAME} : désinstalleur annoncé ${announced.uninstaller ?? "?"} Mo, réel ${uninsMo.toFixed(2)} Mo (${uninsFiles.join(" + ") || "aucun unins*"}) (±1 Mo)`,
        announced.uninstaller != null && Math.abs(announced.uninstaller - uninsMo) <= 1
      );
      const installedMo = toMo(dirSize(installDir));
      check(
        `${INFO_FILE_NAME} : total annoncé ${announced.total ?? "?"} Mo, réellement installé ${installedMo.toFixed(2)} Mo désinstalleur compris (±5 %)`,
        announced.total != null && Math.abs(announced.total - installedMo) <= installedMo * 0.05
      );
      check(
        `${INFO_FILE_NAME} : total annoncé jamais inférieur à la réalité (${announced.total ?? "?"} ≥ ${installedMo.toFixed(2)})`,
        announced.total != null && announced.total >= installedMo
      );
      const estimatedKb = readUninstallEstimatedKb(variant.appId);
      const estimatedMo = estimatedKb != null ? estimatedKb / 1024 : null;
      check(
        `registre EstimatedSize ${estimatedMo != null ? estimatedMo.toFixed(2) : "absent"} Mo cohérent avec le total annoncé ${announced.total ?? "?"} Mo (±5 %)`,
        estimatedMo != null &&
          announced.total != null &&
          Math.abs(announced.total - estimatedMo) <= estimatedMo * 0.05
      );
      const mentions = [
        `%LOCALAPPDATA%\\${variant.dataDirName}`,
        "base de données VIERGE",
        "~100 Mo à télécharger",
        "~265 Mo sur le disque",
        "clé API Anthropic",
        "127.0.0.1",
        ".NET Framework 4",
        "Raccourcis : groupe « " + variant.appName + " » dans le menu Démarrer",
        "Tâches supplémentaires",
        "Le désinstalleur (créé par l'assistant)",
      ];
      if (text.includes("(non signé)")) mentions.push("SmartScreen", "Exécuter quand même");
      check(
        `${INFO_FILE_NAME} : mentions attendues (données, base vierge, LinkedIn, clé IA, réseau, prérequis, raccourcis, désinstalleur)`,
        mentions.every((s) => text.includes(s)),
        mentions.filter((s) => !text.includes(s)).join(" | ") || "toutes présentes"
      );
    }

    // ------------------------------------------- 2. anti-fuite sur l'installé
    log("contrôle anti-fuite sur l'arborescence INSTALLÉE…");
    // unins000.* est écrit par Inno Setup SUR LA MACHINE CIBLE au moment de
    // l'installation : il journalise les chemins choisis là-bas (groupe du menu
    // Démarrer du testeur, etc.). Ces fichiers ne font pas partie du paquet et
    // contiendront toujours le nom du compte qui installe — les scanner
    // reviendrait à mesurer la machine de test, pas la distribution.
    const leaks = checkLeaks([installDir], {
      verbose: false,
      exclude: [/(^|[\\/])unins\d+\.(dat|exe|msg)$/i],
    });
    check(
      `anti-fuite (${leaks.scanned} fichiers, ${leaks.needleCount} termes)`,
      leaks.findings.length === 0,
      leaks.findings.length
        ? leaks.findings.slice(0, 5).map((f) => `${f.file} :: ${f.kind}`).join(" | ")
        : "0 occurrence"
    );

    // ----------------------------------- 3. démarrage avec un PATH MINIMAL
    // Aucun Node, aucun Python, aucun npm accessible : si le serveur démarre,
    // c'est que le runtime embarqué suffit.
    const winDir = process.env.WINDIR || "C:\\Windows";
    const minimalEnv = {
      SystemRoot: winDir,
      windir: winDir,
      TEMP: sandbox,
      TMP: sandbox,
      PATH: `${winDir}\\system32;${winDir}`,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(TEST_PORT),
      JOBSCOUT_DATA_DIR: dataDir,
      JOBSCOUT_DB_PATH: path.join(dataDir, "jobscout.db"),
      JOBSCOUT_DOCS_PATH: path.join(dataDir, "documents"),
      PLAYWRIGHT_BROWSERS_PATH: path.join(dataDir, "browsers"),
      // Isolation du moteur LinkedIn : browser-engine.ts se rabat sur le
      // registre Playwright global (%LOCALAPPDATA%\ms-playwright) — et libuv
      // réinjecte USERPROFILE même avec un env explicite. Sur un poste de
      // développement ce registre contient déjà un Chromium, qui ferait
      // passer « rien téléchargé » pour faux ; LOCALAPPDATA pointe donc sur
      // le bac à sable, comme sur un PC vierge.
      LOCALAPPDATA: dataDir,
      // Pas d'appel réseau vers un endpoint qui n'existe pas encore.
      JOBSCOUT_DISABLE_UPDATE_CHECK: "1",
      // Ceinture ET bretelles : le mode IA non configuré ne doit produire
      // AUCUN appel réseau — si une régression en déclenchait un quand même,
      // ce port local fermé le ferait échouer instantanément au lieu de
      // laisser la recette dépendre d'internet.
      JOBSCOUT_PROXY_URL: "http://127.0.0.1:9",
      // Pollution VOLONTAIRE : ces variables traînent sur les postes de
      // développement, et un jeton ambiant est déjà parti en clair vers le
      // proxy par le passé. L'app ne doit ni les ramasser (l'IA doit rester
      // « non configurée » — contrôle 4bis, qui vérifie aussi qu'aucun
      // sk-ant- ne ressort) ni les émettre : une requête accidentelle vise le
      // port fermé ci-dessus et casserait « aucune erreur serveur ».
      ANTHROPIC_API_KEY: "sk-ant-recette-jamais-utilisee-0000000000",
      ANTHROPIC_AUTH_TOKEN: "jeton-recette-jamais-utilise",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
    };
    const nodeExe = path.join(installDir, "runtime", "node.exe");
    const appDir = path.join(installDir, "app");

    log(`démarrage du serveur (PATH minimal, port ${TEST_PORT})…`);
    const serverLog = [];
    server = spawn(nodeExe, ["server.js"], {
      cwd: appDir,
      env: minimalEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (b) => serverLog.push(b.toString()));
    server.stderr.on("data", (b) => serverLog.push(b.toString()));

    const base = `http://127.0.0.1:${TEST_PORT}`;
    const up = await waitFor(async () => (await get(base + "/")).status !== 0, 90000);
    if (!check("serveur démarré sans Node système dans le PATH", up)) {
      throw new Error("Serveur injoignable.\n" + serverLog.join("").slice(-3000));
    }

    // ------------------------------------------ 4. onboarding bloquant
    const root = await get(base + "/");
    check(
      "« / » sur base vierge redirige vers l'onboarding",
      root.status >= 300 && root.status < 400 && (root.location || "").includes("/onboarding"),
      `HTTP ${root.status} → ${root.location}`
    );
    const onboarding = await get(base + "/onboarding/upload");
    check("page d'onboarding servie", onboarding.status === 200, `HTTP ${onboarding.status}`);
    check(
      "carte de configuration IA visible sur /onboarding/upload",
      onboarding.text.includes('data-testid="ai-settings"')
    );

    // ---------------------------------- 4bis. IA non configurée = état propre
    // Sur base vierge : mode « unset », pas de quota, et AUCUN appel réseau
    // (le GET ne tente le proxy que si le mode pack est configuré ; toute
    // tentative parasite taperait le port local fermé posé dans minimalEnv et
    // laisserait une trace dans le contrôle « aucune erreur serveur »).
    const llm = await get(base + "/api/settings/llm");
    let llmJson = {};
    try { llmJson = JSON.parse(llm.text); } catch {}
    check(
      "IA non configurée : mode unset, aucun quota",
      llm.status === 200 &&
        llmJson.configured === false &&
        llmJson.mode === "unset" &&
        llmJson.quota === null,
      `HTTP ${llm.status} — mode=${llmJson.mode} configured=${llmJson.configured}`
    );
    check(
      "IA non configurée : aucune clé renvoyée en clair",
      !/JSC-[A-Z0-9]{8,}|sk-ant-/.test(llm.text)
    );

    // ------------------------------------------ 5. API version et moteur
    const upd = await get(base + "/api/update");
    let updJson = {};
    try { updJson = JSON.parse(upd.text); } catch {}
    check(
      "/api/update renvoie la version courante",
      upd.status === 200 && updJson.current === v,
      `HTTP ${upd.status} — current=${updJson.current}`
    );
    if (isTest) {
      check(
        `/api/update annonce le variant « ${variant.id} »`,
        updJson.variant === variant.id,
        `variant=${updJson.variant}`
      );
    }

    // ------------------------------------------ 5 bis. base VIERGE
    // « / » a déjà ouvert la base (gate d'onboarding) : elle existe, et elle
    // doit être vide — aucun profil, aucune offre, aucun document.
    const blank = await countRows(path.join(dataDir, "jobscout.db"));
    check(
      "base vierge à l'installation : 0 profil, 0 offre, 0 document",
      blank.ok && blank.empty,
      blank.detail
    );
    const eng = await get(base + "/api/engine");
    let engJson = {};
    try { engJson = JSON.parse(eng.text); } catch {}
    check(
      "/api/engine : moteur LinkedIn absent (rien téléchargé)",
      eng.status === 200 && engJson.installed === false,
      `HTTP ${eng.status} — installed=${engJson.installed}`
    );

    // ------------------------------------------ 6. profil + pages principales
    // POST en JSON accentué depuis node (jamais PowerShell : encodage Latin-1).
    const profile = {
      full_name: "Profil de recette",
      email: "recette@example.test",
      phone: null,
      location: "Paris, Île-de-France",
      linkedin_url: null,
      portfolio_url: null,
      summary: "Profil éphémère créé par la recette d'installation.",
      raw_cv_text: "Chargé de projet — médiation culturelle, régie générale.",
      sectors: ["Communication digitale", "Médiation culturelle"],
      target_countries: ["France", "Belgique"],
      sources_enabled: ["apec", "hellowork"],
      preferred_contracts: ["cdi", "cdd"],
      extraction_confidence: 90,
      experiences: [
        {
          title: "Chargé de communication",
          company: "Théâtre de l'Élan",
          location: "Paris",
          start_date: "2023-01",
          end_date: null,
          description: "Stratégie éditoriale et réseaux sociaux.",
          bullet_points: ["Refonte du site", "Croissance de 40 % de l'audience"],
          skills_used: ["Community management"],
        },
      ],
      educations: [
        {
          school: "Université Paris 1",
          degree: "Master",
          field: "Gestion culturelle",
          location: "Paris",
          start_date: "2020-09",
          end_date: "2022-06",
          description: null,
        },
      ],
      skills: [{ name: "Rédaction", category: "soft", evidence_experience_ids: [] }],
      languages: [{ name: "Français", level: "Natif" }],
    };
    const post = await fetch(base + "/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(profile),
    });
    check("création du profil (POST /api/profile)", post.ok, `HTTP ${post.status}`);

    // ------------------------------------------ 7. base créée hors de {app}
    check(
      "base créée dans le répertoire de données",
      fs.existsSync(path.join(dataDir, "jobscout.db")),
      path.join(dataDir, "jobscout.db")
    );
    check(
      "aucune base écrite dans le répertoire d'installation",
      !fs.existsSync(path.join(appDir, "data", "jobscout.db"))
    );

    const reread = await get(base + "/api/profile");
    check(
      "accents préservés (pas de mojibake)",
      reread.text.includes("Théâtre de l'Élan") && reread.text.includes("Île-de-France")
    );

    for (const p of ["/dashboard", "/offres", "/candidatures", "/documents", "/profile"]) {
      const r = await get(base + p);
      check(`page ${p}`, r.status === 200, `HTTP ${r.status}`);
    }
    const afterOnboarding = await get(base + "/");
    check(
      "« / » redirige vers le dashboard une fois l'onboarding fait",
      (afterOnboarding.location || "").includes("/dashboard"),
      `→ ${afterOnboarding.location}`
    );

    // Le rendu HTML doit contenir la version (pied de barre latérale) — avec le
    // nom du variant : « JobScout Test v3.4.4 » pour l'installeur de test.
    const dash = await get(base + "/dashboard");
    check(
      `version affichée dans l'interface (« ${variant.appName} v${v} »)`,
      dash.text.includes(`${variant.appName} v${v}`)
    );

    // Avertissements connus et inoffensifs, à ne pas confondre avec une panne.
    const BENIGN = [
      // pdfjs journalise l'absence de @napi-rs/canvas (37 Mo de binaire natif)
      // au chargement. Ce paquet ne sert qu'à RASTÉRISER un PDF en image :
      // JobScout n'extrait que du texte (getTextContent), vérifié fonctionnel
      // dans le paquet. On ne l'embarque donc pas.
      /Cannot find module '@napi-rs\/canvas'/,
    ];
    const errors = (serverLog.join("").match(/Error:[^\n]*/g) || []).filter(
      (line) => !BENIGN.some((re) => re.test(line))
    );
    check(
      "aucune erreur serveur pendant la recette",
      errors.length === 0,
      errors.slice(0, 3).join(" | ")
    );
    // -------------------------------- 8. le launcher natif (JobScout.exe)
    // Le reste de la recette pilote node.exe directement ; ici on vérifie le
    // chemin réel de l'utilisateur : choix du port, données sous
    // %LOCALAPPDATA%\JobScout, et surtout l'arrêt propre (le Job Object doit
    // emporter le serveur node quand le launcher se termine).
    try { server.kill(); } catch {}
    await sleep(2000);
    server = null;

    const localAppData =
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const localData = path.join(localAppData, variant.dataDirName);
    const preExisting = fs.existsSync(localData);
    // Isolation du variant de test : un JobScout standard installé sur ce
    // poste ne doit pas être touché — sa base doit garder sa date exacte.
    const prodDb = path.join(localAppData, "JobScout", "jobscout.db");
    const prodDbMtime = isTest && fs.existsSync(prodDb) ? fs.statSync(prodDb).mtimeMs : null;
    const launcher = spawn(path.join(installDir, "JobScout.exe"), ["--no-browser"], {
      detached: false,
      windowsHide: true,
      stdio: "ignore",
    });
    const runtimeFile = path.join(localData, "runtime.json");
    // Le launcher n'efface runtime.json qu'à l'arrêt propre : un lancement
    // tué brutalement (cette recette comprise) en laisse un reliquat. On
    // n'accepte donc que le fichier publié par CE lancement (mtime plus
    // récent que l'éventuel reliquat), jamais l'URL d'un serveur défunt.
    const staleMtime = (() => {
      try { return fs.statSync(runtimeFile).mtimeMs; } catch { return -1; }
    })();
    const launched = await waitFor(() => {
      try { return fs.statSync(runtimeFile).mtimeMs > staleMtime; } catch { return false; }
    }, 120000, 1000);
    check("launcher : serveur démarré et URL publiée", launched, runtimeFile);

    let launcherUrl = null;
    if (launched) {
      try {
        launcherUrl = JSON.parse(fs.readFileSync(runtimeFile, "utf-8")).url;
      } catch {}
      check(
        "launcher : serveur lié à 127.0.0.1 (rien exposé au réseau)",
        !!launcherUrl && launcherUrl.startsWith("http://127.0.0.1:"),
        launcherUrl || "url illisible"
      );
      const r = await get(launcherUrl);
      check("launcher : l'application répond", r.status > 0, `HTTP ${r.status}`);
      check(
        `launcher : données sous %LOCALAPPDATA%\\${variant.dataDirName}`,
        fs.existsSync(path.join(localData, "jobscout.db"))
      );
      // Le launcher relit la sortie UTF-8 de node et écrit le journal en
      // UTF-8 : « ▲ Next.js » doit s'y lire tel quel, jamais « â–² Next.js ».
      let serverLogText = "";
      try {
        serverLogText = fs.readFileSync(path.join(localData, "logs", "server.log"), "utf-8");
      } catch {}
      const logHead = serverLogText.split(/\r?\n/).filter(Boolean).slice(0, 3).join(" | ");
      check(
        "launcher : logs\\server.log en UTF-8 lisible (« ▲ Next.js », pas « â–² »)",
        serverLogText.includes("▲ Next.js") && !serverLogText.includes("â–²"),
        logHead || "journal vide ou absent"
      );
      if (isTest) {
        // Le vrai chemin utilisateur du variant de test : la base créée par
        // le launcher sous « JobScout Test » est VIERGE. Lue pendant que le
        // serveur tourne (la base est ouverte proprement, en WAL) — après
        // l'arrêt, Windows peut encore retenir les handles quelques instants.
        const launcherDb = await countRows(path.join(localData, "jobscout.db"));
        check(
          `launcher : base vierge sous %LOCALAPPDATA%\\${variant.dataDirName} (0 profil, 0 offre, 0 document)`,
          launcherDb.ok && launcherDb.empty,
          launcherDb.detail
        );
      }
    }

    try { launcher.kill(); } catch {}
    const stopped = launcherUrl
      ? await waitFor(async () => (await get(launcherUrl)).status === 0, 30000)
      : true;
    check("launcher : arrêt propre, plus aucun serveur en écoute", stopped);

    if (isTest) {
      // Le JobScout standard éventuellement installé sur ce poste n'a pas bougé.
      if (prodDbMtime != null) {
        check(
          "launcher : données du JobScout standard de ce poste intactes",
          fs.statSync(prodDb).mtimeMs === prodDbMtime
        );
      }
    }

    if (!preExisting) {
      try { fs.rmSync(localData, { recursive: true, force: true }); } catch {}
    }
  } finally {
    if (server && !server.killed) {
      try { server.kill(); } catch {}
      await sleep(1500);
    }

    // ------------------------------------------ 8. désinstallation silencieuse
    const unins = path.join(installDir, "unins000.exe");
    if (fs.existsSync(unins)) {
      log("désinstallation silencieuse…");
      try {
        execFileSync(unins, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], {
          stdio: "inherit",
        });
      } catch {
        /* l'uninstaller se relance en copie et rend la main immédiatement */
      }
      const gone = await waitFor(
        async () => !fs.existsSync(path.join(installDir, "JobScout.exe")),
        60000
      );
      check("désinstallation : répertoire d'installation nettoyé", gone);
      check(
        "désinstallation : données utilisateur PRÉSERVÉES",
        fs.existsSync(path.join(dataDir, "jobscout.db"))
      );
    }
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
    try { fs.rmdirSync(sandboxRoot); } catch {}
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(
    `\n[test] ${results.length - failed.length}/${results.length} contrôles passés\n`
  );
  if (failed.length) {
    for (const f of failed) process.stdout.write(`  ÉCHEC : ${f.label} ${f.detail}\n`);
    process.exitCode = 1;
  }
  return { total: results.length, failed: failed.length };
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run().catch((e) => {
    console.error(`[test] ÉCHEC : ${e.message}`);
    process.exit(1);
  });
}
