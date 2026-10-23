import { afterEach, describe, expect, it, vi } from "vitest";
import { descriptionTextFromHtml, isEscapedMarkup, repairEscapedMarkupHtml } from "@/lib/offres/escaped-markup";
import { cleanOffreDescriptionHtml, cleanOffreDescriptionText, repairEscapedMarkupDescription, sanitizeScrapedOffre } from "@/lib/offres/clean-text";
import { htmlToText, type ScrapedOffre } from "@/lib/scrapers/base";
import { unescapeEscapedHtml, unescapeOneLevel } from "@/lib/text/entities";
import { extractJobPostingLd, parseDocument } from "@/lib/scrapers/dom";
import { toScraped, type Hit } from "@/lib/scrapers/wttj";
import { enrich as enrichTalent } from "@/lib/scrapers/talent";
import { apecScraper } from "@/lib/scrapers/apec";
import { LATENT_CASES, LEGIT_CASES, STORED_CASES } from "./markup-cases";

/**
 * Balisage affiché en clair dans les descriptions : règle de réparation du HTML,
 * re-dérivation du texte selon la source, filet d'écriture et sources qui le servent
 * encore (Talent sans JSON-LD, APEC, LinkedIn, WTTJ). Cas : formes servies par les sources
 * en miniature (contenus fictifs), quasi-positifs et formes relevées en revue. Aucun
 * réseau, aucune base.
 */

// Pauses des scrapers supprimées (APEC attend 600 ms entre deux fiches).
vi.mock("@/lib/scrapers/dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scrapers/dom")>()),
  sleep: async () => {},
}));

const NBSP = " ";
const LITERAL_TAG_RE = /<[A-Za-z/]/;
const repair = (html: string) => repairEscapedMarkupHtml(html).html;

const offre = (over: Partial<ScrapedOffre>): ScrapedOffre => ({
  source_id: "x", url: "https://example.org/x", title: "Poste", company: "Org", country: "France", location: null,
  contract_type: null, salary: null, description_html: "", description_text: "", description_status: "ok",
  posted_at: null, is_vie: false, raw_payload: {}, ...over,
});

describe("repairEscapedMarkupHtml — formes stockées en miniature", () => {
  it.each(STORED_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const r = repairEscapedMarkupHtml(c.html);
    expect(r.html).toBe(c.repaired);
    expect(r.rules.join("+")).toBe(c.rules);
    if (c.text != null) expect(htmlToText(r.html)).toBe(c.text);
    // Plus aucune balise en clair, ni dans le texte (htmlToText) ni à l'affichage (textContent).
    expect(htmlToText(r.html)).not.toMatch(LITERAL_TAG_RE);
    expect(parseDocument(r.html).body.textContent).not.toMatch(LITERAL_TAG_RE);
    expect(parseDocument(c.html).body.textContent).toMatch(LITERAL_TAG_RE);
    // Idempotente : un second passage ne change plus rien.
    expect(repairEscapedMarkupHtml(r.html)).toEqual({ html: r.html, rules: [] });
  });

  it("A : même DOM que unescapeEscapedHtml, un seul niveau retiré (&eacute; et &nbsp; restent des références)", () => {
    const { html: input, repaired: expected } = STORED_CASES[0];
    expect(unescapeEscapedHtml(input)).toBe(expected);
    expect(unescapeOneLevel("&lt;p&gt;&amp;amp; &#60;&#x3E;&quot;&#39;&apos; &eacute;&nbsp;&rsquo;&lt;/p&gt;"))
      .toBe("<p>&amp; <>\"'' &eacute;&nbsp;&rsquo;</p>");
    // Le texte n'a plus d'U+00A0 littérale (recherche « chef de projet ») : espaces simples.
    expect(htmlToText(repair(input))).not.toContain(NBSP);
  });

  it("B : seul le bloc échappé change, le reste de la page est rendu octet pour octet", () => {
    const { html: input, repaired: expected } = STORED_CASES[1];
    const start = input.indexOf("&lt;p&gt;Exemple SA"), end = input.indexOf("</div><h5>");
    expect(expected.slice(0, start)).toBe(input.slice(0, start));
    expect(expected.slice(expected.indexOf("</div><h5>"))).toBe(input.slice(end));
  });

  it("le « < » échappé en référence numérique est reconnu aussi (&#60;, &#x3c;)", () => {
    expect(repair("&#60;p&#62;Un &#x3C;strong&#x3e;bloc&#x3c;/strong&#62;.&#60;/p&#62;")).toBe("<p>Un <strong>bloc</strong>.</p>");
  });
});

describe("repairEscapedMarkupHtml — autres formes servies par les sources (filet d'écriture)", () => {
  it.each(LATENT_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const r = repairEscapedMarkupHtml(c.html);
    expect(r.html).toBe(c.repaired);
    expect(r.rules.join("+")).toBe(c.rules);
    // Filet complet, texte tiré par la source : re-dérivé du HTML réparé, sans mot collé ni balise en clair.
    const c2 = sanitizeScrapedOffre(offre({ description_html: c.html, description_text: descriptionTextFromHtml(c.source, c.html) }), c.source);
    expect([c2.description_html, c2.description_text]).toEqual([c.repaired, c.text]);
    expect(c2.description_text).not.toMatch(LITERAL_TAG_RE);
    expect(parseDocument(r.html).body.textContent).not.toMatch(LITERAL_TAG_RE);
    expect(parseDocument(c.html).body.textContent).toMatch(LITERAL_TAG_RE);
    expect(repairEscapedMarkupHtml(r.html)).toEqual({ html: r.html, rules: [] });
  });

  it("HTML en ligne dans un <p> : l'enveloppe reste (paragraphes séparés à l'écran) ; bloc en tête (Talent, WTTJ) : elle part", () => {
    expect(parseDocument(repair(LATENT_CASES[0].html)).querySelectorAll("p")).toHaveLength(3);
    expect(repairEscapedMarkupHtml(STORED_CASES[2].html).rules).toEqual(["markup-unwrap-p"]);
    expect(repairEscapedMarkupHtml(STORED_CASES[3].html).rules).toEqual(["markup-unwrap-p"]);
  });

  it("attributs entre guillemets avec « > » ou apostrophe : toujours réparés", () => {
    expect(repair("&lt;p title=&quot;a&gt;b&quot;&gt;x&lt;/p&gt;")).toBe('<p title="a>b">x</p>');
    expect(repair("&lt;p&gt;&lt;img alt=&quot;l&#39;eau&quot; src=x.png&gt;&lt;/p&gt;")).toBe(`<p><img alt="l'eau" src=x.png></p>`);
  });
});

describe("repairEscapedMarkupHtml — textes légitimes intacts", () => {
  it.each(LEGIT_CASES)("%s", (_name, input) => {
    expect(repairEscapedMarkupHtml(input)).toEqual({ html: input, rules: [] });
  });

  it("faux positif accepté (même règle que unescapeEscapedHtml) : tout le texte d'un élément commence par une balise et ferme un bloc", () => {
    expect(repair("<li>&lt;p&gt; et &lt;/p&gt; délimitent un paragraphe</li>")).toBe("<li><p> et </p> délimitent un paragraphe</li>");
  });

  it("isEscapedMarkup : balise connue en tête, bloc fermé, contenu fermé sur lui-même, rien de dangereux", () => {
    expect(isEscapedMarkup("<p>a</p>")).toBe(true);
    expect(isEscapedMarkup("  <ul><li>a</li></ul> ")).toBe(true);
    expect(isEscapedMarkup("<div> est requis")).toBe(false);
    expect(isEscapedMarkup("<Prénom> et </p>")).toBe(false);
    expect(isEscapedMarkup("<p>a</p><iframe src=x></iframe>")).toBe(false);
    expect(isEscapedMarkup("<p>a</p></div>")).toBe(false);
    expect(isEscapedMarkup("<foo>a</p>")).toBe(false);
    // Chaque « < » ouvre une balise complète : guillemet, commentaire ou balise ouverts refusés.
    expect(isEscapedMarkup('<p>a</p><p><img src="x</p>')).toBe(false);
    expect(isEscapedMarkup("<p>a <!-- b</p>")).toBe(false);
    expect(isEscapedMarkup("<p>a</p><li d")).toBe(false);
    expect(isEscapedMarkup('<p>a</p><title x="a<b">')).toBe(false);
    expect(isEscapedMarkup(`<p><img alt="l'eau" title="a>b"></p>`)).toBe(true);
    // Nom inconnu, même lexicalement complet ; balise lue jusque dans un attribut.
    expect(isEscapedMarkup("<p>Madame <NOM></p>")).toBe(false);
    expect(isEscapedMarkup('<p>a</p><svg x="<p>">')).toBe(false);
  });
});

describe("description_text re-dérivé du HTML réparé, selon la source", () => {
  it("Talent (page entière) : htmlToText, en-tête « Entreprise • Lieu » conservé", () => {
    const { html } = STORED_CASES[1];
    const text = htmlToText(html);
    expect(text).toContain("<p>Exemple SA");
    const r = repairEscapedMarkupDescription("talent", html, text);
    expect(r).toMatchObject({ rules: ["markup"], textKept: false });
    expect(r.description_text).toBe(STORED_CASES[1].text);
    expect(r.description_text.startsWith("Chef de projet\nEXEMPLE SA • Lyon\n")).toBe(true);
    // Les deux premières lignes (titre, puis « Entreprise • Lieu ») sont celles du texte d'origine.
    const head = (s: string) => s.split("\n").slice(0, 2);
    expect(head(r.description_text)).toEqual(head(text));
  });

  it("APEC : textContent du <p> (et non htmlToText), balise coupée retirée des deux champs", () => {
    const html = "Vos missions :Piloter  la marge ;&lt;li d";
    const text = descriptionTextFromHtml("apec", html);
    expect(text).toBe("Vos missions :Piloter  la marge ;<li d");
    expect(repairEscapedMarkupDescription("apec", html, text)).toEqual({
      description_html: "Vos missions :Piloter  la marge ;",
      description_text: "Vos missions :Piloter  la marge ;",
      rules: ["truncated-tail"],
      textKept: false,
    });
    // htmlToText aurait ramené la double espace à une seule : ce n'est pas la règle APEC.
    expect(htmlToText("Vos missions :Piloter  la marge ;")).toBe("Vos missions :Piloter la marge ;");
  });

  it("texte stocké décalé de blancs par rapport au texte dérivé : re-dérivé quand même", () => {
    const html = "&lt;p&gt;Chef de projet&lt;/p&gt; &lt;ul&gt;&lt;li&gt;Epargne&lt;/li&gt;&lt;/ul&gt;";
    const exact = htmlToText(html);
    const drift = exact.replace("projet</p> <ul>", "projet</p>  <ul>").replace("Chef de", "Chef  de");
    expect(drift).not.toBe(exact);
    const r = repairEscapedMarkupDescription("talent", html, drift);
    expect(r).toMatchObject({ description_html: "<p>Chef de projet</p> <ul><li>Epargne</li></ul>", rules: ["markup"], textKept: false });
    expect(r.description_text).toBe(htmlToText(r.description_html));
    expect(r.description_text).not.toMatch(LITERAL_TAG_RE);
  });

  it("texte re-dérivé repassé au filet : double échappement LinkedIn (« l&amp;apos; ») décodé", () => {
    // Appel direct, comme la réparation en base (le filet d'écriture ramène d'abord le HTML à un niveau).
    const html = "<p>Rejoindre l&amp;apos;équipe<strong> le 15 janvier&lt;</strong>/p&gt;</p>";
    const r = repairEscapedMarkupDescription("linkedin", html, cleanOffreDescriptionText(htmlToText(html)));
    expect(r).toMatchObject({ rules: ["doubled-end-tag"], textKept: false });
    expect(r.description_text).toBe("Rejoindre l'équipe le 15 janvier");
  });

  it("texte qui ne dérive pas du HTML : HTML réparé, texte gardé (textKept)", () => {
    const html = "&lt;p&gt;Mission&lt;/p&gt;";
    const r = repairEscapedMarkupDescription("talent", html, "Résumé écrit à part, sans rapport avec le HTML.");
    expect(r).toEqual({ description_html: "<p>Mission</p>", description_text: "Résumé écrit à part, sans rapport avec le HTML.", rules: ["markup"], textKept: true });
  });

  it("rien à réparer : les deux champs rendus tels quels", () => {
    const html = "<p>React, &lt;canvas&gt; et WebGL</p>";
    expect(repairEscapedMarkupDescription("wttj", html, "texte")).toEqual({ description_html: html, description_text: "texte", rules: [], textKept: false });
  });
});

describe("prévention : le filet d'écriture répare ce que les sources servent encore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respond = (body: string | object) => ({
    ok: true,
    status: 200,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  });

  it("Talent sans JSON-LD : la colonne de la page garde son en-tête, le bloc échappé devient du HTML", async () => {
    const escaped =
      "&lt;p&gt;&lt;img src=&quot;https://x.test/logo.png&quot; /&gt;&lt;/p&gt; &lt;p&gt;Exemple SA est un&amp;nbsp;&lt;strong&gt;atelier " +
      "de mobilier&lt;/strong&gt;, d&amp;rsquo;usage courant et de qualit&amp;eacute;, install&amp;eacute; à " +
      "Lyon.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Pr&amp;eacute;parer les commandes&lt;/li&gt;&lt;li&gt;Suivre les livraisons&lt;/li&gt;&lt;/ul&gt;";
    const page =
      `<html><body><div class="sc-1 jobDescriptionColumn"><header><h1>Chef de projet industriel</h1>` +
      `<p>EXEMPLE SA • Lyon</p><span>Il y a plus de 30 jours</span><a>Postuler</a></header>` +
      `<span>Description de poste</span><div class="sc-2 desc">${escaped}</div><h5>Créer une alerte</h5></div></body></html>`;
    vi.stubGlobal("fetch", vi.fn(async () => respond(page)));
    const o = await enrichTalent({
      id: "t1", url: "https://fr.talent.com/view?id=t1", title: "Chef de projet industriel", company: "",
      city: null, country: "France", contract: null, snippet: "",
    });
    // Le scraper sert toujours le bloc tel que la page l'affiche : balises en clair.
    expect(o.description_html).toContain("&lt;p&gt;Exemple SA");
    expect(o.description_text).toContain("<p>Exemple SA");

    const c = sanitizeScrapedOffre(o, "talent");
    expect(c.description_html).not.toMatch(/&lt;/);
    expect(c.description_html).toContain('<div class="sc-2 desc"><p><img src="https://x.test/logo.png" /></p> <p>Exemple SA est un&nbsp;<strong>atelier');
    expect(c.description_text).not.toMatch(LITERAL_TAG_RE);
    expect(c.description_text).not.toContain(NBSP);
    expect(c.description_text).toContain("Exemple SA est un atelier de mobilier, d’usage courant et de qualité, installé à Lyon.");
    expect(c.description_text).toContain("Préparer les commandes\nSuivre les livraisons");
    expect(c.description_text.startsWith("Chef de projet industriel\nEXEMPLE SA • Lyon\n")).toBe(true);
    // Repasser le filet ne change plus rien.
    expect(sanitizeScrapedOffre(c, "talent")).toMatchObject({ description_html: c.description_html, description_text: c.description_text });
  });

  it("Talent par JSON-LD (cas A) : un niveau retiré à la source, mêmes octets que la réparation de l'ancien HTML stocké", () => {
    const description = "&lt;p&gt;Exemple SA&nbsp;: c&rsquo;est l&#39;&eacute;nergie&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Chef&nbsp;de projet&lt;/li&gt;&lt;/ul&gt;";
    const doc = parseDocument(`<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Poste", description })}</script>`);
    const html = extractJobPostingLd(doc)!.description_html!;
    expect(html).toBe("<p>Exemple SA&nbsp;: c&rsquo;est l'&eacute;nergie</p><ul><li>Chef&nbsp;de projet</li></ul>");
    expect(html).toBe(repair(description));
    // &nbsp; resté une référence : espace simple dans le texte (« chef de projet » se trouve).
    expect(htmlToText(html)).toBe("Exemple SA : c’est l'énergie\nChef de projet");
  });

  it("APEC : la source coupe le texte dans une balise, le filet la retire des deux champs", async () => {
    const body = "Au sein de l'équipe commerciale, vous développez un portefeuille de clients grands comptes. ".repeat(4);
    const page = `<html><body><h1>Chargé de clientèle H/F</h1><p>${body}Suivre les indicateurs et piloter la marge ;&lt;li d</p></body></html>`;
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("rechercheOffre")
        ? respond({ resultats: [{ numeroOffre: "123456789X", intitule: "Chargé de clientèle H/F", lieuTexte: "Lyon 03 - 69", typeContrat: "101888" }], totalCount: 1 })
        : respond(page)
    );
    vi.stubGlobal("fetch", fetchMock);
    const out: ScrapedOffre[] = [];
    for await (const o of apecScraper.scrape({ sectors: ["commercial"], countries: ["France"] }, () => {})) out.push(o);
    expect(out).toHaveLength(1);
    expect(out[0].description_html.endsWith("piloter la marge ;&lt;li d")).toBe(true);
    expect(out[0].description_text.endsWith("piloter la marge ;<li d")).toBe(true);

    const c = sanitizeScrapedOffre(out[0], "apec");
    expect(c.description_html).toBe(`${body}Suivre les indicateurs et piloter la marge ;`);
    expect(c.description_text).toBe(`${body}Suivre les indicateurs et piloter la marge ;`.trim());
    expect(c.description_text).not.toMatch(LITERAL_TAG_RE);
  });

  it("LinkedIn : fermante tapée en texte et coupée par l'éditeur, réparée dans le HTML et le texte", () => {
    // Comme lib/scrapers/linkedin.ts : description_html = innerHTML, description_text = htmlToText.
    const desc =
      "<strong><p>Description du poste</p><p><br></p><p>Lieu : Lyon</p></strong><p><br></p>" +
      "<p>⏳<strong> Date limite : 15 janvier 2026&lt;</strong>/p&gt;</p><p><br></p>" +
      "<p>⚠<strong>️ Candidatures en français uniquement&lt;</strong>/p&gt;</p><p></p>.";
    const raw = offre({ description_html: desc, description_text: htmlToText(desc) });
    expect(raw.description_text).toContain("2026</p>");
    const c = sanitizeScrapedOffre(raw, "linkedin");
    expect(c.description_html).toContain("<p>⏳<strong> Date limite : 15 janvier 2026</strong></p>");
    expect(c.description_html).toContain("<p>⚠<strong>️ Candidatures en français uniquement</strong></p>");
    expect(c.description_text).toBe(raw.description_text.replaceAll("</p>", ""));
    expect(c.description_text).not.toMatch(LITERAL_TAG_RE);
  });

  it("WTTJ : déjà réglé à la source par le correctif des entités ; l'ancien HTML échappé, réparé, redonne exactement le HTML d'un scan actuel", () => {
    const profile = '<div>Candidat en Bac+5 marketing digital.</div>\r\n<div><span lang="FR-FR">Maîtrise des outils bureautiques et des réseaux sociaux.</span></div>';
    const hit: Hit = {
      objectID: "o1", slug: "assistant-marketing_lyon", name: "Assistant marketing digital",
      organization: { name: "Exemple SA", slug: "exemple-sa" }, offices: [{ city: "Lyon", country_code: "FR" }],
      summary: "Rejoignez une entreprise de services en pleine croissance, présente dans plusieurs villes de France.", profile,
    };
    const now = toScraped(hit)!;
    expect(now.description_html).not.toContain("&lt;");
    expect(sanitizeScrapedOffre(now, "wttj")).toMatchObject({ description_html: now.description_html, description_text: now.description_text });
    // Ancien block() (3.4.x) : div et span non reconnus, le champ était échappé comme du texte.
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const old = now.description_html.replace(profile, profile.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join(""));
    expect(old).toContain("&lt;div&gt;Candidat");
    const fixed = repairEscapedMarkupDescription("wttj", old, htmlToText(old));
    expect(fixed.description_html).toBe(now.description_html);
    expect(fixed.description_text).toBe(sanitizeScrapedOffre(now, "wttj").description_text);
  });

  it("WTTJ : champ Algolia en HTML en ligne échappé (rendu en <p> par block()) : balises réparées, paragraphes et lignes gardés", () => {
    const hit: Hit = {
      objectID: "o2", slug: "chef-de-projet_paris", name: "Chef de projet",
      organization: { name: "Org", slug: "org" }, offices: [{ city: "Paris", country_code: "FR" }],
      summary: "Rejoignez une entreprise de services en pleine croissance, présente dans plusieurs villes de France.",
      key_missions: "&lt;strong&gt;Vos missions&lt;/strong&gt; :\n- Piloter le budget\n- Animer les équipes",
      profile: "&lt;strong&gt;Formation&lt;/strong&gt; : Bac+5 école de commerce\n\n&lt;strong&gt;Langues&lt;/strong&gt; : anglais courant",
    };
    const raw = toScraped(hit)!;
    expect(raw.description_html).toContain("<p>&lt;strong&gt;Vos missions&lt;/strong&gt; :<br>- Piloter le budget<br>- Animer les équipes</p>");
    const c = sanitizeScrapedOffre(raw, "wttj");
    expect(c.description_html).toContain(
      "<h2>Missions</h2><p><strong>Vos missions</strong> :<br>- Piloter le budget<br>- Animer les équipes</p>" +
        "<h2>Profil recherché</h2><p><strong>Formation</strong> : Bac+5 école de commerce</p><p><strong>Langues</strong> : anglais courant</p>"
    );
    expect(c.description_text).toBe(
      "Résumé\nRejoignez une entreprise de services en pleine croissance, présente dans plusieurs villes de France.\nMissions\nVos missions :\n" +
        "- Piloter le budget\n- Animer les équipes\nProfil recherché\nFormation : Bac+5 école de commerce\nLangues : anglais courant"
    );
  });

  it("balise coupée au milieu d'une page, quelle que soit la source (APEC comprise) : HTML et texte intacts, la suite gardée", () => {
    const html = `<div class="c">&lt;p&gt;Mission&lt;/p&gt;&lt;li class=&quot;x</div><p>Suite importante</p>`;
    for (const source of ["talent", "wttj", "apec", "linkedin"]) {
      const text = descriptionTextFromHtml(source, html);
      expect(text).toContain("Suite importante");
      expect(sanitizeScrapedOffre(offre({ description_html: html, description_text: text }), source)).toMatchObject({
        description_html: html,
        description_text: text,
      });
    }
  });

  it("texte légitime citant une balise, quelle que soit la source : intact", () => {
    for (const source of ["talent", "wttj", "apec", "linkedin", "hellowork", "francetravail"]) {
      const html = "<p>Intégration HTML (&lt;div&gt;, &lt;canvas&gt;), écrivez &lt;/p&gt; pour fermer, salaire &lt; 40 k€.</p>";
      const text = descriptionTextFromHtml(source, html);
      expect(sanitizeScrapedOffre(offre({ description_html: html, description_text: text }), source)).toMatchObject({
        description_html: html,
        description_text: text,
      });
    }
  });

  it("le filet garde les règles des entités (« &lt;div&gt; R&amp;D » cité, double échappement ramené à un niveau)", () => {
    expect(cleanOffreDescriptionHtml("<p>&lt;div&gt; R&amp;D ind&amp;eacute;pendante &amp;eacute;</p>"))
      .toBe("<p>&lt;div&gt; R&amp;D ind&eacute;pendante &eacute;</p>");
    const o = offre({ description_html: "<p>&lt;div&gt; R&amp;D ind&amp;eacute;pendante</p>", description_text: "<div> R&D ind&eacute;pendante" });
    expect(sanitizeScrapedOffre(o, "talent")).toMatchObject({
      description_html: "<p>&lt;div&gt; R&amp;D ind&eacute;pendante</p>",
      description_text: "<div> R&D indépendante",
    });
  });
});
