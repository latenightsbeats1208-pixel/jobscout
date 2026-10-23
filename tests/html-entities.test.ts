import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeHtmlEntities,
  decodeHtmlEntitiesOrNull,
  escapeHtml,
  repairDoubleEscapedHtml,
  snippetToHtml,
  unescapeEscapedHtml,
} from "@/lib/text/entities";
import { htmlToText } from "@/lib/scrapers/base";
import { cleanOffreDescriptionHtml, cleanOffreDescriptionText, cleanOffreText, fixMojibake, sanitizeScrapedOffre } from "@/lib/offres/clean-text";
import { toScraped, type Hit } from "@/lib/scrapers/wttj";
import { extractJobPostingLd, parseDocument } from "@/lib/scrapers/dom";
import { ldFields } from "@/lib/scrapers/linkedin";
import { enrich as enrichTalent } from "@/lib/scrapers/talent";
import { enrichCard as enrichFranceTravail } from "@/lib/scrapers/francetravail";
import { PREVIEW_EXCERPT_LENGTH, previewExcerpt } from "@/lib/offres/preview";

/**
 * Entités HTML restées en clair dans les offres (« Chargé d&apos;études »,
 * « exp&eacute;rience », « Bac&#43;5 ») : décodeur, extraction du texte, filet
 * d'écriture et sources corrigées. Cas représentatifs des formes servies par les sources.
 * Aucun réseau, aucune base.
 */

const NBSP = " ";
const FFFD = "�";
const d = decodeHtmlEntities;

describe("decodeHtmlEntities — entités nommées", () => {
  it.each([
    ["Chargé d&apos;études", "Chargé d'études"],
    ["Développeur Java &amp; Cloud F/H", "Développeur Java & Cloud F/H"],
    ["Responsable de l&apos;équipe R&D &amp; Data", "Responsable de l'équipe R&D & Data"],
    ["d&eacute;veloppeur", "développeur"],
    ["&Eacute;quipe &Ecirc;tre", "Équipe Être"],
    ["c&rsquo;est", "c’est"],
    ["&lsquo;a&rsquo; &ldquo;b&rdquo; &sbquo;c&lsquo; &bdquo;d&ldquo;", "‘a’ “b” ‚c‘ „d“"],
    ["&laquo;&nbsp;Bonjour&nbsp;&raquo;", `«${NBSP}Bonjour${NBSP}»`],
    ["&oelig;uvre &OElig;", "œuvre Œ"],
    ["&hellip;&mdash;&ndash;&bull;&euro;&trade;&copy;&reg;&deg;", "…—–•€™©®°"],
    ["&thinsp;&ensp;&emsp;&zwnj;&zwj;&lrm;&rlm;&shy;", "   ‌‍‎‏­"],
    ["&AMP;&LT;&GT;&QUOT;&COPY;&REG;&TRADE;", "&<>\"©®™"],
    ["&frac12; &sup2; &plusmn; &times; &divide; &micro; &para; &sect;", "½ ² ± × ÷ µ ¶ §"],
    ["&agrave;&egrave;&ecirc;&icirc;&ocirc;&ucirc;&ugrave;&acirc;&ccedil;&euml;&iuml;&uuml;&yuml;&Yuml;", "àèêîôûùâçëïüÿŸ"],
  ])("%s", (input, expected) => {
    expect(d(input)).toBe(expected);
  });

  it.each([
    ["&rArr; Missions", "⇒ Missions"],
    ["&diams; Mutuelle &hearts; Ambiance &loz; &spades; &clubs;", "♦ Mutuelle ♥ Ambiance ◊ ♠ ♣"],
    ["&alpha;&beta;&Omega;&sigmaf;&thetasym;", "αβΩςϑ"],
    ["&lArr;&hArr;&uArr;&dArr;&crarr;", "⇐⇔⇑⇓↵"],
    ["&sdot;&radic;&sum;&prod;&lowast;&forall;&part;&exist;&empty;&isin;&notin;", "⋅√∑∏∗∀∂∃∅∈∉"],
    ["&and;&or;&cap;&cup;&int;&there4;&sim;&cong;&equiv;&sub;&sup;&sube;&supe;&oplus;&otimes;&perp;", "∧∨∩∪∫∴∼≅≡⊂⊃⊆⊇⊕⊗⊥"],
    ["&lceil;&rceil;&lfloor;&rfloor;&image;&weierp;&real;&alefsym;", "⌈⌉⌊⌋ℑ℘ℜℵ"],
    // Valeurs HTML5 (HTML 4.01 donnait U+2329 et U+232A).
    ["&lang;x&rang;", "\u27e8x\u27e9"],
  ])("HTML 4.01 complet : %s", (input, expected) => {
    expect(d(input)).toBe(expected);
  });

  it("respecte la casse : une variante inconnue reste intacte", () => {
    expect(d("&EACUTE; &Amp; &NBSP;")).toBe("&EACUTE; &Amp; &NBSP;");
  });
});

describe("decodeHtmlEntities — références numériques (règles HTML5)", () => {
  it.each([
    ["Bac&#43;5", "Bac+5"],
    ["&#39;&#039;&#x27;&#X27;&#x0027;", "'''''"],
    ["&#xa0;&#xA0;&#160;", NBSP.repeat(3)],
    ["&#x1f449; &#128640;", "\u{1f449} \u{1f680}"],
    ["&#x1f3d9;️", "\u{1f3d9}️"],
    ["&#x0000000041;&#00000065;", "AA"],
    ["&#13;&#9;&#10;", "\r\t\n"],
  ])("%s", (input, expected) => {
    expect(d(input)).toBe(expected);
  });

  it("0, hors plage et demi-codets donnent U+FFFD (jamais d'exception ni de demi-codet isolé)", () => {
    expect(d("&#0;&#x0;&#00;")).toBe(FFFD.repeat(3));
    expect(d("&#x110000;&#1114112;&#99999999999;&#x10FFFF;")).toBe(`${FFFD.repeat(3)}\u{10ffff}`);
    expect(d("&#xD800;&#xDFFF;&#55357;&#56393;")).toBe(FFFD.repeat(4));
  });

  it("0x80 à 0x9F suivent windows-1252, sauf les cinq positions non attribuées", () => {
    expect(d("&#128;")).toBe("€");
    expect(d("&#x80;&#150;&#146;&#156;&#x9F;&#x99;")).toBe("€–’œŸ™");
    expect(d("&#x81;&#x8D;&#x8F;&#x90;&#x9D;")).toBe("\u0081\u008d\u008f\u0090\u009d");
  });

  it("références mal formées : inchangées", () => {
    expect(d("&#x; &#; &#xZZ; &#-1; &# 39;")).toBe("&#x; &#; &#xZZ; &#-1; &# 39;");
  });
});

describe("decodeHtmlEntities — point-virgule obligatoire, une seule passe, faux positifs", () => {
  it("sans point-virgule, rien n'est décodé (HTML5 décoderait « &amp » et « &eacute »)", () => {
    expect(d("&#43 &eacute &amp &nbsp")).toBe("&#43 &eacute &amp &nbsp");
  });

  it("une seule passe : le résultat n'est jamais relu", () => {
    expect(d("&amp;lt; &amp;amp; &amp;eacute; &#38;lt; &amp;#39; &#38;#38;")).toBe("&lt; &amp; &eacute; &lt; &#39; &#38;");
    expect(d("&&amp;;")).toBe("&&;");
    expect(d("&amp&amp;")).toBe("&amp&");
  });

  it("le texte décodé peut contenir des chevrons : c'est du texte brut, rendu échappé par React", () => {
    expect(d("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe("<script>alert(1)</script>");
  });

  it.each([
    "R&D A&B ab&cd EXEMPLE&CO Q&As Martin&Durand S&OP P&IDs",
    "Solid business sense (P&L; Budgeting)",
    "Recherche & Développement && &; & ;",
    "?a=1&para=2&reg=fr&copy=1&not=3&times=4&lang=fr&region=eu&sect=x&curren=y",
    "&notit; &check; &L; &rArrow; &Hearts;",
    "&abcdefghijklmnopqrstuvwxyzabcdefgh;",
    "&constructor; &__proto__; &toString; &hasOwnProperty;",
    "",
  ])("inchangé : %s", (input) => {
    expect(d(input)).toBe(input);
  });

  it("null passe tel quel dans la variante qui l'accepte", () => {
    expect(decodeHtmlEntitiesOrNull(null)).toBeNull();
    expect(decodeHtmlEntitiesOrNull("l&apos;offre")).toBe("l'offre");
  });

  it("option nbspToSpace : l'espace insécable en entité devient une espace simple", () => {
    expect(d("a&nbsp;b&#160;c&#xa0;d", { nbspToSpace: true })).toBe("a b c d");
    expect(d(`déjà${NBSP}là`, { nbspToSpace: true })).toBe(`déjà${NBSP}là`);
  });
});

describe("HTML : double échappement, HTML échappé, échappement", () => {
  it("repairDoubleEscapedHtml ramène « &amp;X; » à « &X; » pour un nom connu ou une référence valide", () => {
    expect(repairDoubleEscapedHtml("<p>ind&amp;eacute;pendante &amp;#128640; &amp;#xa0;Design &amp;amp; Web</p>"))
      .toBe("<p>ind&eacute;pendante &#128640; &#xa0;Design &amp; Web</p>");
  });

  it("repairDoubleEscapedHtml couvre aussi les noms HTML 4.01 (« &amp;rArr; »)", () => {
    expect(repairDoubleEscapedHtml("&amp;rArr;")).toBe("&rArr;");
    expect(repairDoubleEscapedHtml("<p>&amp;rArr; x &amp;eacute; &amp;diams; &amp;L;</p>")).toBe("<p>&rArr; x &eacute; &diams; &amp;L;</p>");
  });

  it("repairDoubleEscapedHtml laisse le HTML légitime et les noms inconnus", () => {
    const legit = '<p>R&amp;D, P&amp;L; Budgeting, <a href="https://x.org/?a=1&amp;copy=2">lien</a> &eacute;quipe &lt;div&gt; &amp;#0; &amp;notit;</p>';
    expect(repairDoubleEscapedHtml(legit)).toBe(legit);
  });

  it("unescapeEscapedHtml retrouve le HTML d'une description entièrement échappée, une fois", () => {
    expect(unescapeEscapedHtml("&lt;p&gt;ind&amp;eacute;pendante &amp;amp; libre&lt;/p&gt;"))
      .toBe("<p>ind&eacute;pendante &amp; libre</p>");
  });

  it("unescapeEscapedHtml ne touche ni au vrai HTML ni au texte sans balise échappée", () => {
    expect(unescapeEscapedHtml("<p>Exemple : &lt;div&gt; en clair</p>")).toBe("<p>Exemple : &lt;div&gt; en clair</p>");
    expect(unescapeEscapedHtml("Salaire &lt; 40 k&euro;")).toBe("Salaire &lt; 40 k&euro;");
  });

  // Texte brut qui CITE des balises : sans document échappé (début par une balise ET
  // bloc fermé), rien n'est décodé, sinon la balise devenait réelle et le mot disparaissait.
  const quotedTags: [string, string][] = [
    ["Stack technique : React, TypeScript, &lt;canvas&gt; et WebGL, avec un texte assez long.", "<canvas>"],
    ["SEO : optimisation des balises &lt;title&gt; et meta description, maillage interne.", "<title> et meta description, maillage interne."],
    ["Intégration en HTML sémantique (&lt;article&gt;, &lt;section&gt;) et CSS moderne.", "(<article>, <section>)"],
    ["Maîtrise des balises &lt;div&gt;, &lt;span&gt; et &lt;table&gt;. CDI à Paris.", "<div>, <span> et <table>"],
    ["Sécurité : filtrer les &lt;script&gt; injectés, revue de code et tests.", "filtrer les <script> injectés, revue de code"],
    ["Candidature par courriel, l&apos;objet &lt;Nom Prénom&gt; à rh.", "l'objet <Nom Prénom> à rh."],
    ["&lt;div&gt; est requis pour ce poste d'intégrateur, avec un texte assez long.", "<div> est requis"],
    ["La balise &lt;/p&gt; ferme un paragraphe : notions de HTML attendues.", "La balise </p> ferme"],
  ];

  it.each(quotedTags)("unescapeEscapedHtml : texte brut inchangé — %s", (input) => {
    expect(unescapeEscapedHtml(input)).toBe(input);
  });

  it.each(quotedTags)("JSON-LD : la balise citée reste du texte — %s", (description, quoted) => {
    const doc = parseDocument(`<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Poste", description })}</script>`);
    const html = extractJobPostingLd(doc)!.description_html!;
    expect(html).toBe(description);
    expect(htmlToText(html)).toContain(quoted);
  });

  it("snippetToHtml échappe l'extrait (déjà décodé) avant de l'insérer en paragraphe", () => {
    expect(snippetToHtml("Salaire < 40 k€ & primes")).toBe("<p>Salaire &lt; 40 k€ &amp; primes</p>");
    expect(snippetToHtml('Maîtrise de <Python> "senior"')).toBe("<p>Maîtrise de &lt;Python&gt; &quot;senior&quot;</p>");
    expect(snippetToHtml("")).toBe("");
  });

  it("escapeHtml échappe & < > et les guillemets", () => {
    expect(escapeHtml('R&D <senior> "x"')).toBe("R&amp;D &lt;senior&gt; &quot;x&quot;");
  });
});

describe("htmlToText", () => {
  it.each([
    ["<p>Charg&eacute; d&apos;&eacute;tudes</p>", "Chargé d'études"],
    ["<p>a&nbsp;b</p>", "a b"],
    ["<p>x&#xa0;Bac&#43;5 Vous &ecirc;tes d&rsquo;un Bac&#43;4</p>", "x Bac+5 Vous êtes d’un Bac+4"],
    ["&lt;b&gt;gras&lt;/b&gt;", "<b>gras</b>"],
    ["<p>&amp;lt;div&amp;gt;</p>", "&lt;div&gt;"],
    ["<p>P&amp;L; Budgeting</p>", "P&L; Budgeting"],
    ["<p>R&amp;D</p><p>&#x1f680; Go</p>", "R&D\n\u{1f680} Go"],
    ["<p>&amp;nbsp;</p>", "&nbsp;"],
  ])("%s", (html, expected) => {
    expect(htmlToText(html)).toBe(expected);
  });

  it("garde une espace insécable littérale (seules les entités deviennent des espaces)", () => {
    expect(htmlToText(`<p>70${NBSP}K&euro;</p>`)).toBe(`70${NBSP}K€`);
  });
});

describe("filet d'écriture (lib/offres/clean-text.ts)", () => {
  it("champ texte : entités décodées puis mojibake réparé", () => {
    expect(cleanOffreText("Chargé d&apos;études")).toBe("Chargé d'études");
    expect(cleanOffreText("caf&Atilde;&copy;")).toBe("café");
    expect(cleanOffreText(null)).toBeNull();
    expect(cleanOffreDescriptionText("Bac&#43;5&#xa0;: exp&eacute;rience")).toBe("Bac+5 : expérience");
  });

  it("description_html : jamais décodée, seul le double échappement est réparé", () => {
    expect(cleanOffreDescriptionHtml("<p>&lt;div&gt; R&amp;D ind&amp;eacute;pendante &eacute;</p>"))
      .toBe("<p>&lt;div&gt; R&amp;D ind&eacute;pendante &eacute;</p>");
  });

  it("fixMojibake ne tronque plus un caractère au-delà de U+00FF (apostrophe, émoji)", () => {
    expect(fixMojibake("l’Ã©quipe \u{1f680}")).toBe("l’équipe \u{1f680}");
    expect(fixMojibake("Ã©tudes")).toBe("études");
    expect(fixMojibake("déjà propre")).toBe("déjà propre");
    expect(fixMojibake(null)).toBeNull();
  });

  it("sanitizeScrapedOffre nettoie chaque champ texte une fois et garde le reste", () => {
    const raw = {
      source_id: "x", url: "https://example.org/?a=1&amp;b=2", title: "Chargé d&apos;études", company: "A&amp;B",
      country: "C&ocirc;te d&rsquo;Ivoire", location: "Saint-&Eacute;tienne", contract_type: "Temps&nbsp;plein", salary: "45&nbsp;000 &euro;",
      description_html: "<p>R&amp;D &amp;eacute;</p>", description_text: "R&D &amp;lt;", description_status: "ok" as const,
      posted_at: null, is_vie: false, raw_payload: { name: "&amp;" },
    };
    const c = sanitizeScrapedOffre(raw, "wttj");
    expect(c).toMatchObject({
      title: "Chargé d'études", company: "A&B", country: "Côte d’Ivoire", location: "Saint-Étienne",
      contract_type: `Temps${NBSP}plein`, salary: `45${NBSP}000 €`,
      description_html: "<p>R&amp;D &eacute;</p>", description_text: "R&D &lt;",
      url: raw.url, raw_payload: raw.raw_payload,
    });
  });
});

describe("sources corrigées", () => {
  const hit = (over: Partial<Hit>): Hit => ({
    objectID: "o1", slug: "poste-exemple_paris", name: "Poste",
    organization: { name: "Org", slug: "org" }, offices: [{ city: "Paris", country_code: "FR" }],
    summary: "Résumé assez long pour dépasser le seuil de quatre-vingts caractères de la description.",
    ...over,
  });

  it("WTTJ : titre, entreprise et ville décodés", () => {
    const o = toScraped(hit({ name: "Développeur Java &amp; Cloud F/H", organization: { name: "L&apos;Agence Exemple", slug: "org" }, offices: [{ city: "Saint-&Eacute;tienne" }] }))!;
    expect(o.title).toBe("Développeur Java & Cloud F/H");
    expect(o.company).toBe("L'Agence Exemple");
    expect(o.location).toBe("Saint-Étienne");
    expect(toScraped(hit({ name: "Chargé d&apos;études" }))!.title).toBe("Chargé d'études");
  });

  it("WTTJ : bloc texte décodé avant esc(), plus de double échappement", () => {
    const o = toScraped(hit({ key_missions: "R&amp;D &eacute;quipe <senior> en Bac&#43;5, avec un texte assez long." }))!;
    expect(o.description_html).toContain("<p>R&amp;D équipe &lt;senior&gt; en Bac+5, avec un texte assez long.</p>");
    expect(o.description_html).not.toMatch(/&amp;(amp|eacute|#43);/);
    expect(o.description_text).toContain("R&D équipe <senior> en Bac+5");
  });

  it("WTTJ : l'espace insécable en entité d'un bloc texte devient une espace simple (comme la branche HTML)", () => {
    const o = toScraped(hit({ key_missions: "Chef&#xa0;de&nbsp;projet digital, Missions&#xa0;: avec un texte assez long." }))!;
    expect(o.description_text).toContain("Chef de projet digital, Missions : avec");
    expect(o.description_text).not.toContain(NBSP);
    expect(o.description_html).toContain("<p>Chef de projet digital, Missions : avec");
    // Même résultat que la branche HTML et que la réparation d'un ancien texte stocké.
    const viaHtml = toScraped(hit({ key_missions: "<p>Chef&#xa0;de&nbsp;projet digital, Missions&#xa0;: avec un texte assez long.</p>" }))!;
    expect(sanitizeScrapedOffre(o, "wttj").description_text).toBe(sanitizeScrapedOffre(viaHtml, "wttj").description_text);
    expect(cleanOffreDescriptionText("Chef&#xa0;de&nbsp;projet")).toBe("Chef de projet");
  });

  it.each([
    "<span>Vous &ecirc;tes curieux.</span>",
    "<ol>Liste</ol>",
    "<b>Gras</b> et texte",
    "<i>Italique</i> et texte",
    "<u>Souligné</u> et texte",
    '<a href="https://x.org">lien</a> et texte',
  ])("WTTJ : un champ en HTML reste du HTML — %s", (v) => {
    const o = toScraped(hit({ profile: v }))!;
    expect(o.description_html).toContain(v);
    expect(o.description_html).not.toContain("&lt;");
  });

  it("WTTJ : un chevron de texte n'est pas pris pour du HTML (« <senior> » reste échappé)", () => {
    const o = toScraped(hit({ profile: "Profil <senior> confirmé" }))!;
    expect(o.description_html).toContain("<p>Profil &lt;senior&gt; confirmé</p>");
    expect(o.description_text).toContain("Profil <senior> confirmé");
  });

  it("WTTJ : un champ en HTML avec <div> reste du HTML, ses entités légitimes intactes", () => {
    const o = toScraped(hit({ profile: "<div>Candidat en Bac&#43;4, vous &ecirc;tes d&rsquo;un naturel curieux.</div>" }))!;
    expect(o.description_html).toContain("<div>Candidat en Bac&#43;4, vous &ecirc;tes d&rsquo;un naturel curieux.</div>");
    expect(o.description_html).not.toContain("&lt;div&gt;");
    expect(o.description_text).toContain("Candidat en Bac+4, vous êtes d’un naturel curieux.");
  });

  it("JSON-LD (HelloWork, Talent, France Travail) : textes décodés, description échappée ramenée à du HTML", () => {
    const ld = {
      "@type": "JobPosting",
      title: "Responsable de l&apos;équipe Projets",
      hiringOrganization: { name: "Exemple &amp; Co" },
      jobLocation: { address: { addressLocality: "Saint-&Eacute;tienne", addressCountry: "C&ocirc;te d&rsquo;Ivoire" } },
      employmentType: ["CDI", "Temps&nbsp;plein"],
      description: "&lt;p&gt;&lt;strong&gt;Mission&lt;/strong&gt; ind&amp;eacute;pendante&lt;/p&gt;",
    };
    const doc = parseDocument(`<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`);
    const job = extractJobPostingLd(doc)!;
    expect(job.title).toBe("Responsable de l'équipe Projets");
    expect(job.company).toBe("Exemple & Co");
    expect(job.locality).toBe("Saint-Étienne");
    expect(job.country).toBe("Côte d’Ivoire");
    expect(job.contract_type).toBe(`CDI, Temps${NBSP}plein`);
    expect(job.description_html).toBe("<p><strong>Mission</strong> ind&eacute;pendante</p>");
    expect(htmlToText(job.description_html!)).toBe("Mission indépendante");
  });

  it("JSON-LD : une vraie description HTML reste telle quelle", () => {
    const description = "<p>Vous &ecirc;tes R&amp;D, exemple &lt;div&gt;</p>";
    const doc = parseDocument(`<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Poste", description })}</script>`);
    expect(extractJobPostingLd(doc)!.description_html).toBe(description);
  });

  it("LinkedIn (repli JSON-LD) : textes décodés, description échappée ramenée à du HTML", () => {
    expect(ldFields({
      title: "Responsable de l&apos;équipe Projets",
      hiringOrganization: { name: "A&amp;B" },
      jobLocation: { address: { addressLocality: "Saint-&Eacute;tienne", addressCountry: { name: "C&ocirc;te d&rsquo;Ivoire" } } },
      employmentType: ["CDI", "Temps&nbsp;plein"],
      description: "&lt;p&gt;Mission ind&amp;eacute;pendante&lt;/p&gt;",
    })).toEqual({
      title: "Responsable de l'équipe Projets",
      company: "A&B",
      locality: "Saint-Étienne",
      country: "Côte d’Ivoire",
      employmentType: `CDI, Temps${NBSP}plein`,
      description: "<p>Mission ind&eacute;pendante</p>",
    });
  });

  it("LinkedIn (repli JSON-LD) : pays en chaîne, JSON-LD absent, description citant une balise", () => {
    expect(ldFields({ jobLocation: { address: { addressCountry: "FR" } }, employmentType: "FULL_TIME" })).toMatchObject({ country: "FR", employmentType: "FULL_TIME" });
    const empty = { description: null, title: null, company: null, locality: null, country: null, employmentType: null };
    expect(ldFields(null)).toEqual(empty);
    expect(ldFields(undefined)).toEqual(empty);
    expect(ldFields({ description: "React, &lt;canvas&gt; et WebGL" }).description).toBe("React, &lt;canvas&gt; et WebGL");
  });

  describe("extrait de recherche quand la fiche est indisponible", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });
    const snippet = 'Salaire < 40 k€ & primes, maîtrise de <Python> "senior" exigée, poste en CDI à Lyon avec un texte assez long.';
    const expectedHtml = "<p>Salaire &lt; 40 k€ &amp; primes, maîtrise de &lt;Python&gt; &quot;senior&quot; exigée, poste en CDI à Lyon avec un texte assez long.</p>";
    const unavailable = () => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, text: async () => "" })));

    it("Talent : extrait échappé dans description_html, texte brut dans description_text", async () => {
      unavailable();
      const o = await enrichTalent({
        id: "t1", url: "https://fr.talent.com/view?id=t1", title: "Poste", company: "Org", city: "Lyon",
        country: "France", contract: "CDI", snippet,
      });
      expect(o.description_html).toBe(expectedHtml);
      expect(o.description_text).toBe(snippet);
    });

    it("France Travail : extrait échappé dans description_html, texte brut dans description_text", async () => {
      unavailable();
      const o = await enrichFranceTravail({ id: "ft1", title: "Poste", company: "Org", city: "Lyon", contract: "CDI", snippet });
      expect(o.description_html).toBe(expectedHtml);
      expect(o.description_text).toBe(snippet);
    });
  });
});

describe("aperçu de la liste des offres (composant client)", () => {
  it("previewExcerpt décode, ramène les espaces à une seule et coupe sans demi-codet", () => {
    expect(previewExcerpt("Exp&eacute;rience&nbsp;:  Bac&#43;5\n\n  requise ")).toBe("Expérience : Bac+5 requise");
    expect(previewExcerpt("x&#xD800;y")).toBe(`x${FFFD}y`);
    expect(previewExcerpt(null)).toBe("");
    expect(previewExcerpt("a".repeat(PREVIEW_EXCERPT_LENGTH + 50))).toBe("a".repeat(PREVIEW_EXCERPT_LENGTH));
    // Émoji à cheval sur la coupe : retiré entier, jamais un demi-codet isolé.
    expect(previewExcerpt(`${"a".repeat(PREVIEW_EXCERPT_LENGTH - 1)}&#x1f680;fin`)).toBe("a".repeat(PREVIEW_EXCERPT_LENGTH - 1));
    expect(previewExcerpt(`${"a".repeat(PREVIEW_EXCERPT_LENGTH - 2)}&#x1f680;fin`)).toBe(`${"a".repeat(PREVIEW_EXCERPT_LENGTH - 2)}\u{1f680}`);
  });

  it("app/(app)/offres/list.tsx passe par previewExcerpt", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app", "(app)", "offres", "list.tsx"), "utf8");
    expect(src).toMatch(/import \{ previewExcerpt \} from "@\/lib\/offres\/preview"/);
    expect(src).toMatch(/const excerpt = previewExcerpt\(offer\.description_text\)/);
  });

  // Seul déclencheur des réparations pour la page Documents (titres lus directement dans
  // offres), filet pour toute autre lecture hors lib/db/offres.ts : un appel retiré resterait
  // vert partout ailleurs.
  it("app/(app)/layout.tsx déclenche les réparations des offres à chaque rendu", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app", "(app)", "layout.tsx"), "utf8");
    expect(src).toMatch(/^import \{ ensureOffresRepaired \} from "@\/lib\/db\/repair-markup";\r?$/m);
    const start = src.indexOf("export default function AppLayout");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start);
    expect(body).toMatch(/^\s*ensureOffresRepaired\(\);\r?$/m);
    expect(body.indexOf("ensureOffresRepaired();")).toBeLessThan(body.indexOf("return ("));
  });

  // vitest neutralise « server-only » : sans ce test, un import serveur dans ces modules
  // resterait vert ici et ne casserait qu'au build Next du composant client.
  it.each([
    ["lib/text/entities.ts", []],
    ["lib/offres/preview.ts", ["@/lib/text/entities"]],
  ] as [string, string[]][])("%s n'importe aucun module serveur", (file, allowed) => {
    const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    const imports = [...src.matchAll(/^\s*(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+[^'";]*?\s+from\s+)["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(imports).toEqual(allowed);
    expect(src).not.toMatch(/server-only|require\(|from "node:/);
  });
});
