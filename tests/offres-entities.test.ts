import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressEvent, Scraper } from "@/lib/scrapers/base";
import { getDb, getSetting, setSetting } from "@/lib/db";
import { createCandidature, listCandidatures, upcomingDeadlines } from "@/lib/db/candidatures";
import { getOffre, listOffres, searchOffres, upsertOffreFromSource, type ScrapedOffre } from "@/lib/db/offres";
import {
  ensureHtmlEntitiesRepaired,
  HTML_ENTITIES_REPAIR_KEY,
  readHtmlEntitiesRepair,
  registerCurrentScanRun,
  repairHtmlEntities,
} from "@/lib/db/repair-entities";
import { scoreOffreLocal } from "@/lib/scoring/local";
import { profile } from "./fixtures";

/**
 * Entités HTML dans les offres en base : filet d'écriture (upsertOffreFromSource),
 * réparation unique des offres déjà enregistrées (marque dans settings, transaction,
 * déclenchée par la première lecture ou écriture, score recalculé, attente d'un scan de
 * l'ancien code) et score du scan calculé sur le texte enregistré.
 * Base SQLite temporaire (tests/setup.ts), offres fictives, scrapers remplacés.
 */

// Compétence accentuée : « n&eacute;gociation » ne la trouve pas, « négociation » si.
const scanProfile = {
  ...profile,
  skills: [...profile.skills, { id: 33, name: "Négociation", category: "soft", level: "advanced", evidence_experience_ids: [11] }],
} as typeof profile;

const scan = vi.hoisted(() => ({ offres: [] as ScrapedOffre[], noProfile: false }));

vi.mock("@/lib/db/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/queries")>()),
  getProfile: () => (scan.noProfile ? null : scanProfile),
}));

vi.mock("@/lib/scrapers/registry", () => ({
  VALID_SOURCES: ["wttj"],
  getEnabledScrapers: (ids: string[]) =>
    ids.map((id): Scraper => ({
      name: id,
      async *scrape(_criteria, onEvent: (e: ProgressEvent) => void) {
        onEvent({ kind: "start", source: id });
        for (const o of scan.offres) yield o;
        onEvent({ kind: "done", source: id, seen: scan.offres.length, ok: scan.offres.length, failed: 0 });
      },
    })),
}));

let seq = 0;
function scraped(over: Partial<ScrapedOffre> = {}): ScrapedOffre {
  seq++;
  return {
    source_id: `e-${seq}`,
    url: `https://example.org/offre/${seq}`,
    title: `Poste ${seq}`,
    company: "Entreprise Exemple",
    country: "France",
    location: "Lyon",
    contract_type: "CDI",
    salary: null,
    description_html: "<p>Description</p>",
    description_text: "Description du poste en CDI.",
    description_status: "ok",
    posted_at: "2026-01-15",
    is_vie: false,
    raw_payload: {},
    ...over,
  };
}

/** Offre écrite telle quelle, sans le filet (comme une offre enregistrée avant ce correctif). */
function insertRaw(o: Partial<ScrapedOffre>): number {
  const s = scraped(o);
  const r = getDb().prepare(`
    INSERT INTO offres (source, source_id, url, title, company, country, location, contract_type, salary,
      description_html, description_text, description_status, posted_at, score, is_vie, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, 42, 0, '{}')
  `).run("wttj", s.source_id, s.url, s.title, s.company, s.country, s.location, s.contract_type, s.salary,
    s.description_html, s.description_text, s.posted_at);
  return Number(r.lastInsertRowid);
}

const row = (id: number) => ({ ...(getDb().prepare("SELECT * FROM offres WHERE id = ?").get(id) as Record<string, unknown>) });
const G = globalThis as typeof globalThis & { __jobscoutHtmlEntitiesRepairV1?: { done: boolean; retryAt: number } };

/** Score local de l'offre telle qu'elle est en base, au format de setOffreScore. */
function localScore(id: number) {
  const o = row(id) as { title: string; company: string; country: string | null; description_text: string; contract_type: string | null };
  const r = scoreOffreLocal(scanProfile, {
    title: o.title, company: o.company, country: o.country, description_text: o.description_text, contract_type: o.contract_type,
  });
  return { score: r.score, score_breakdown: JSON.stringify({ ...r.breakdown, reason: r.reason }) };
}

/** Ligne scan_runs « running » (scan de l'ancien code tant qu'elle n'est pas enregistrée). */
function insertRun(startedAt?: string): number {
  const db = getDb();
  const r = startedAt
    ? db.prepare("INSERT INTO scan_runs (status, started_at) VALUES ('running', ?)").run(startedAt)
    : db.prepare("INSERT INTO scan_runs (status) VALUES ('running')").run();
  return Number(r.lastInsertRowid);
}

/** Base sans offre ni marque, et état « jamais vérifié » (comme un serveur qui charge le correctif). */
function resetRepair() {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(HTML_ENTITIES_REPAIR_KEY);
  delete G.__jobscoutHtmlEntitiesRepairV1;
}

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM candidatures");
  db.exec("DELETE FROM documents");
  db.exec("DELETE FROM offres");
  db.exec("DELETE FROM scan_runs");
  scan.noProfile = false;
  resetRepair();
});

describe("upsertOffreFromSource — filet d'écriture", () => {
  it("enregistre titre, entreprise, lieu et texte décodés (« &apos; », « &amp; », « &eacute; »)", () => {
    const id = upsertOffreFromSource("wttj", scraped({
      title: "Chargé d&apos;études Données &amp; Qualité F/H",
      company: "L&apos;Agence Exemple &amp; Co",
      country: "C&ocirc;te d&rsquo;Ivoire",
      location: "Saint-&Eacute;tienne",
      contract_type: "Temps&nbsp;plein",
      description_text: "Vous &ecirc;tes titulaire d&rsquo;un Bac&#43;5&#xa0;! &#x1f680;",
    }));
    expect(row(id)).toMatchObject({
      title: "Chargé d'études Données & Qualité F/H",
      company: "L'Agence Exemple & Co",
      country: "Côte d’Ivoire",
      location: "Saint-Étienne",
      contract_type: "Temps\u00a0plein",
      description_text: "Vous êtes titulaire d’un Bac+5 ! \u{1f680}",
    });
  });

  it("garde le description_html légitime intact et ne répare que le double échappement", () => {
    const legit = '<p>Vous &ecirc;tes R&amp;D, Bac&#43;5, exemple &lt;div&gt;, <a href="https://x.org/?a=1&amp;b=2">lien</a></p>';
    expect(row(upsertOffreFromSource("wttj", scraped({ description_html: legit }))).description_html).toBe(legit);
    const twice = "<p>ind&amp;eacute;pendante &amp;#128640; P&amp;L; Budgeting</p>";
    expect(row(upsertOffreFromSource("talent", scraped({ description_html: twice }))).description_html)
      .toBe("<p>ind&eacute;pendante &#128640; P&amp;L; Budgeting</p>");
  });

  it("laisse les « & » légitimes (R&D, A&B, P&L;) et l'URL", () => {
    const url = "https://example.org/offre?a=1&copy=2&amp;b=3";
    const id = upsertOffreFromSource("wttj", scraped({ title: "Ingénieur R&D A&B", description_text: "P&L; Budgeting", url }));
    expect(row(id)).toMatchObject({ title: "Ingénieur R&D A&B", description_text: "P&L; Budgeting", url });
  });

  it("la recherche trouve le titre décodé", () => {
    const id = upsertOffreFromSource("wttj", scraped({ title: "Chargé d&apos;études", description_text: "D&eacute;veloppeur confirmé." }));
    expect(searchOffres({ query: "charge d'etudes" }).offers.map((o) => o.id)).toEqual([id]);
    expect(searchOffres({ query: "developpeur" }).offers.map((o) => o.id)).toEqual([id]);
  });
});

describe("repairHtmlEntities — offres enregistrées avant le correctif", () => {
  function seed() {
    return {
      title: insertRaw({ title: "Chargé d&apos;études", description_html: "<p>Charg&eacute; d&apos;&eacute;tudes</p>", description_text: "Chargé d'études, poste en CDI." }),
      amp: insertRaw({ title: "Développeur Java &amp; Cloud F/H" }),
      text: insertRaw({
        description_html: "<p>Vous &ecirc;tes titulaire d&rsquo;un Bac&#43;5&#xa0;!</p>",
        description_text: "Vous &ecirc;tes titulaire d&rsquo;un Bac&#43;5&#xa0;! &bull; &#x1f449; Go",
      }),
      html: insertRaw({ description_html: "<p>ind&amp;eacute;pendante &amp;amp; libre</p>", description_text: "ind&eacute;pendante &amp; libre" }),
      clean: insertRaw({ title: "Ingénieur R&D", description_html: "<p>R&amp;D, P&amp;L; Budgeting, &eacute;quipe &lt;div&gt;</p>", description_text: "R&D, P&L; Budgeting, équipe <div>" }),
    };
  }

  it("corrige les lignes concernées, champ par champ, et pose la marque dans settings", () => {
    const ids = seed();
    const cleanBefore = row(ids.clean);
    const titleBefore = row(ids.title);

    const result = repairHtmlEntities();
    expect(result?.ids).toEqual([ids.title, ids.amp, ids.text, ids.html]);
    expect(result?.fields).toEqual({ title: 2, description_text: 2, description_html: 1 });
    expect(result?.rescored).toBe(4);

    expect(row(ids.title).title).toBe("Chargé d'études");
    expect(row(ids.amp).title).toBe("Développeur Java & Cloud F/H");
    expect(row(ids.text).description_text).toBe("Vous êtes titulaire d’un Bac+5 ! • \u{1f449} Go");
    expect(row(ids.html)).toMatchObject({ description_html: "<p>ind&eacute;pendante &amp; libre</p>", description_text: "indépendante & libre" });

    // HTML légitime, ligne propre (score compris) et date de scan : intacts ; score des
    // lignes réparées recalculé sur le texte réparé.
    expect(row(ids.text).description_html).toBe("<p>Vous &ecirc;tes titulaire d&rsquo;un Bac&#43;5&#xa0;!</p>");
    expect(row(ids.clean)).toEqual(cleanBefore);
    expect(row(ids.title)).toEqual({ ...titleBefore, title: "Chargé d'études", ...localScore(ids.title) });
    for (const id of result!.ids) expect(row(id)).toMatchObject(localScore(id));

    const marker = JSON.parse(getSetting(HTML_ENTITIES_REPAIR_KEY)!);
    expect(marker).toEqual(result);
    expect(readHtmlEntitiesRepair()?.ids).toEqual(result?.ids);
  });

  it("second passage : rien (marque), et même forcé, aucun changement sur ces données", () => {
    seed();
    repairHtmlEntities();
    const snapshot = getDb().prepare("SELECT * FROM offres ORDER BY id").all().map((r) => ({ ...r }));
    expect(repairHtmlEntities()).toBeNull();
    const forced = repairHtmlEntities({ force: true });
    expect(forced?.ids).toEqual([]);
    expect(getDb().prepare("SELECT * FROM offres ORDER BY id").all().map((r) => ({ ...r }))).toEqual(snapshot);
  });

  it("la marque protège du double décodage (« &amp;lt; » ne devient jamais « < »)", () => {
    const id = insertRaw({ title: "Balise &amp;lt;div&amp;gt;" });
    repairHtmlEntities();
    expect(row(id).title).toBe("Balise &lt;div&gt;");
    expect(ensureHtmlEntitiesRepaired()).toBeNull();
    expect(repairHtmlEntities()).toBeNull();
    expect(row(id).title).toBe("Balise &lt;div&gt;");
  });

  it("annule tout en cas d'erreur (transaction) et ne pose pas la marque", () => {
    // Échec sur la SECONDE ligne : sans transaction, la première resterait décodée sans
    // marque, et le nouvel essai la décoderait une deuxième fois.
    const id = insertRaw({ title: "Chargé d&apos;études" });
    const b = insertRaw({ title: "Responsable de l&apos;unité" });
    getDb().exec(`CREATE TEMP TRIGGER fail_repair BEFORE UPDATE OF title ON offres WHEN NEW.id = ${b} BEGIN SELECT RAISE(ABORT, 'refus'); END`);
    try {
      expect(() => repairHtmlEntities()).toThrow(/refus/);
      // ensureHtmlEntitiesRepaired ne lève jamais : nouvel essai plus tard.
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(ensureHtmlEntitiesRepaired()).toBeNull();
      expect(err).toHaveBeenCalledOnce();
      err.mockRestore();
      expect(G.__jobscoutHtmlEntitiesRepairV1?.done).toBe(false);
      expect(G.__jobscoutHtmlEntitiesRepairV1!.retryAt).toBeGreaterThan(Date.now());
    } finally {
      getDb().exec("DROP TRIGGER fail_repair");
    }
    // Avant la minute : pas de nouvel essai, même une fois la cause levée (sinon chaque
    // lecture des offres retenterait l'écriture sur une base verrouillée).
    expect(ensureHtmlEntitiesRepaired()).toBeNull();
    expect(row(id)).toMatchObject({ title: "Chargé d&apos;études", score: 42 });
    expect(row(b).title).toBe("Responsable de l&apos;unité");
    expect(getSetting(HTML_ENTITIES_REPAIR_KEY)).toBeNull();
    // Une minute plus tard : le nouvel essai répare les deux, une seule fois.
    G.__jobscoutHtmlEntitiesRepairV1!.retryAt = 0;
    expect(ensureHtmlEntitiesRepaired()?.ids).toEqual([id, b]);
    expect([row(id).title, row(b).title]).toEqual(["Chargé d'études", "Responsable de l'unité"]);
  });

  it("première lecture par getOffre (génération de LM) : réparation", () => {
    const id = insertRaw({ title: "Chargé d&apos;études" });
    expect(getOffre(id)?.title).toBe("Chargé d'études");
    expect(readHtmlEntitiesRepair()?.ids).toEqual([id]);
  });

  it("première lecture par listOffres (re-score) : réparation", () => {
    const id = insertRaw({ title: "Chargé d&apos;études" });
    expect(listOffres().find((o) => o.id === id)?.title).toBe("Chargé d'études");
    expect(readHtmlEntitiesRepair()?.ids).toEqual([id]);
  });

  it("première écriture (scan lancé avant toute page) : réparation avant d'écrire", () => {
    const old = insertRaw({ title: "Balise &amp;lt;div&amp;gt;" });
    const id = upsertOffreFromSource("wttj", scraped({ title: "Balise &amp;lt;span&amp;gt;" }));
    expect(readHtmlEntitiesRepair()?.ids).toEqual([old]);
    // Une seule passe chacune : jamais « < ».
    expect([row(old).title, row(id).title]).toEqual(["Balise &lt;div&gt;", "Balise &lt;span&gt;"]);
  });

  it("score recalculé sur le texte réparé (« alternance » sorti de la fenêtre de 1 500 caractères)", () => {
    // Brut : « alternance » au caractère 1 510, hors de la fenêtre de classifyContract ;
    // décodé : au caractère 810, contrat « alternance » (non ciblé par le profil).
    const description_text = `${"&eacute;".repeat(100)} ${"x ".repeat(350)}Poste en alternance.`;
    const id = insertRaw({ title: "Chargé d&apos;affaires", contract_type: null, description_text });
    const clean = insertRaw({ title: "Ingénieur R&D", description_text: "Poste propre en CDI." });
    const input = { company: "Entreprise Exemple", country: "France", contract_type: null };
    const rawScore = scoreOffreLocal(scanProfile, { ...input, title: "Chargé d&apos;affaires", description_text }).score;

    const result = repairHtmlEntities();
    expect(result).toMatchObject({ ids: [id], rescored: 1 });
    expect(row(id)).toMatchObject(localScore(id));
    // Garde-fou du test : le texte encodé donnait bien un autre score.
    expect(row(id).score).not.toBe(rawScore);
    expect(row(clean)).toMatchObject({ score: 42, score_breakdown: null });
    // Le cache (liste) sert le score recalculé, avec la catégorie de contrat à jour.
    const listed = searchOffres().offers.find((o) => o.id === id)!;
    expect(listed.score).toBe(localScore(id).score);
  });

  it("sans profil : textes réparés, score inchangé (« Re-scorer » reste le recours)", () => {
    scan.noProfile = true;
    const id = insertRaw({ title: "Chargé d&apos;études" });
    expect(repairHtmlEntities()).toMatchObject({ ids: [id], rescored: 0 });
    expect(row(id)).toMatchObject({ title: "Chargé d'études", score: 42, score_breakdown: null });
  });

  it("attend la fin d'un scan lancé dans ce processus par l'ancien code (rechargement à chaud), puis répare", () => {
    const id = insertRaw({ title: "Chargé d&apos;études" });
    const run = insertRun();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(ensureHtmlEntitiesRepaired()).toBeNull();
      expect(searchOffres().offers[0].title).toBe("Chargé d&apos;études");
      // L'ancien scan écrit encore, sans le filet : ces lignes seront aussi réparées.
      const late = insertRaw({ title: "Charg&eacute; de mission" });
      expect(getSetting(HTML_ENTITIES_REPAIR_KEY)).toBeNull();
      expect(G.__jobscoutHtmlEntitiesRepairV1).toMatchObject({ done: false });
      // Scan terminé, nouvel essai une minute plus tard.
      getDb().prepare("UPDATE scan_runs SET status = 'done', finished_at = datetime('now') WHERE id = ?").run(run);
      G.__jobscoutHtmlEntitiesRepairV1!.retryAt = 0;
      expect(searchOffres({ query: "charge" }).offers.map((o) => o.title).sort()).toEqual(["Chargé d'études", "Chargé de mission"]);
      expect(readHtmlEntitiesRepair()?.ids).toEqual([id, late]);
      expect(info).toHaveBeenCalledOnce();
    } finally {
      info.mockRestore();
    }
  });

  it("n'attend ni un scan figé (plus de 30 min), ni un scan du code actuel", () => {
    // Processus lancé il y a 5 h : seule la règle des 30 min écarte les lignes ci-dessous.
    const uptime = vi.spyOn(process, "uptime").mockReturnValue(5 * 3600);
    try {
      insertRun("2026-01-01 10:00:00"); // ancienne ligne « running » restée figée
      const old = getDb().prepare("SELECT datetime('now', '-6 hours') AS t").get() as { t: string };
      insertRun(old.t); // au-delà des deux bornes
      const stale = getDb().prepare("SELECT datetime('now', '-40 minutes') AS t").get() as { t: string };
      insertRun(stale.t); // plus de 30 min : tenu pour figé
      registerCurrentScanRun(insertRun()); // scan du code actuel
      const id = insertRaw({ title: "Chargé d&apos;études" });
      expect(ensureHtmlEntitiesRepaired()?.ids).toEqual([id]);

      // Contrôle : un scan de l'ancien code démarré il y a 10 min fait bien attendre.
      resetRepair();
      getDb().exec("DELETE FROM offres");
      const recent = getDb().prepare("SELECT datetime('now', '-10 minutes') AS t").get() as { t: string };
      insertRun(recent.t);
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      expect(ensureHtmlEntitiesRepaired()).toBeNull();
      expect(getSetting(HTML_ENTITIES_REPAIR_KEY)).toBeNull();
      info.mockRestore();
    } finally {
      uptime.mockRestore();
    }
  });

  it("n'attend pas un scan d'avant le démarrage du processus (serveur arrêté pendant un scan, relancé peu après)", () => {
    // Processus lancé il y a 5 min : une ligne « running » de 10 min, sous la règle des
    // 30 min, ne peut venir que d'un serveur arrêté avant ; seule la borne du démarrage l'écarte.
    const uptime = vi.spyOn(process, "uptime").mockReturnValue(5 * 60);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const dead = getDb().prepare("SELECT datetime('now', '-10 minutes') AS t").get() as { t: string };
      insertRun(dead.t);
      const id = insertRaw({ title: "Chargé d&apos;études" });
      expect(ensureHtmlEntitiesRepaired()?.ids).toEqual([id]);
      expect(row(id).title).toBe("Chargé d'études");

      // Contrôle : un scan de l'ancien code démarré il y a 2 min, après le démarrage, fait attendre.
      resetRepair();
      getDb().exec("DELETE FROM offres");
      const recent = getDb().prepare("SELECT datetime('now', '-2 minutes') AS t").get() as { t: string };
      insertRun(recent.t);
      insertRaw({ title: "Charg&eacute; de mission" });
      expect(ensureHtmlEntitiesRepaired()).toBeNull();
      expect(getSetting(HTML_ENTITIES_REPAIR_KEY)).toBeNull();
      expect(info).toHaveBeenCalledOnce();
    } finally {
      info.mockRestore();
      uptime.mockRestore();
    }
  });

  it("première lecture par listCandidatures (page Candidatures, sans la liste des offres) : réparation", () => {
    const id = insertRaw({ title: "Chargé d&apos;études", company: "Exemple SA &amp; Fils" });
    createCandidature({ offre_id: id });
    expect(listCandidatures().map((c) => [c.offre_id, c.offre_title, c.offre_company])).toEqual([[id, "Chargé d'études", "Exemple SA & Fils"]]);
    expect(readHtmlEntitiesRepair()?.ids).toEqual([id]);
  });

  it("première lecture par upcomingDeadlines (échéances de l'accueil) : réparation", () => {
    const id = insertRaw({ title: "Chargé d&apos;études" });
    createCandidature({ offre_id: id, deadline: "2999-12-31" });
    expect(upcomingDeadlines().map((d) => [d.offre_id, d.title])).toEqual([[id, "Chargé d'études"]]);
    expect(readHtmlEntitiesRepair()?.ids).toEqual([id]);
  });

  it("première lecture d'un serveur déjà lancé : réparation, puis cache des offres reconstruit", () => {
    const id = insertRaw({ title: "Chargé d&apos;études" });
    // Ancien code : cache construit sur les titres encodés (marque simulée pour qu'il ne répare pas).
    setSetting(HTML_ENTITIES_REPAIR_KEY, "{}");
    expect(searchOffres({ query: "charge d'etudes" }).total).toBe(0);
    expect(searchOffres().offers[0].title).toBe("Chargé d&apos;études");
    // Le correctif est chargé : marque absente, état jamais vérifié.
    resetRepair();
    const found = searchOffres({ query: "charge d'etudes" });
    expect(found.offers.map((o) => [o.id, o.title])).toEqual([[id, "Chargé d'études"]]);
    expect(getOffre(id)?.title).toBe("Chargé d'études");
    expect(readHtmlEntitiesRepair()?.ids).toEqual([id]);
    expect(G.__jobscoutHtmlEntitiesRepairV1?.done).toBe(true);
  });
});

describe("runScan — score calculé sur le texte enregistré", () => {
  it("l'offre est notée décodée, comme elle est stockée", async () => {
    const raw = scraped({
      title: "Chargé d&apos;affaires",
      description_text: "Vous menez la n&eacute;gociation commerciale et la gestion de projet. Poste en CDI &agrave; Lyon.",
    });
    scan.offres = [raw];
    const { runScan } = await import("@/lib/scan/orchestrator");
    for await (const _ of runScan(() => {}, { onlySource: "wttj" })) void _;

    const stored = getDb().prepare("SELECT title, description_text, score FROM offres WHERE source_id = ?").get(raw.source_id) as {
      title: string; description_text: string; score: number;
    };
    expect(stored.title).toBe("Chargé d'affaires");
    // Réparation faite avant la première écriture : le scan du code actuel ne la fait
    // pas attendre, et la ligne écrite décodée n'est pas repassée.
    expect(readHtmlEntitiesRepair()?.ids).toEqual([]);
    const input = (o: { title: string; description_text: string }) => ({
      title: o.title, company: raw.company, country: raw.country, description_text: o.description_text, contract_type: raw.contract_type,
    });
    const clean = scoreOffreLocal(scanProfile, input(stored)).score;
    // Garde-fou du test : le texte encodé donnait bien un autre score.
    expect(scoreOffreLocal(scanProfile, input(raw)).score).not.toBe(clean);
    expect(stored.score).toBe(clean);
  });
});
