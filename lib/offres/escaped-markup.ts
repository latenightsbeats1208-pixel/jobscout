import "server-only";
import { JSDOM } from "jsdom";
import { decodeHtmlEntities, unescapeOneLevel } from "@/lib/text/entities";
import { htmlToText } from "@/lib/scrapers/base";

/**
 * Balisage affiché en clair dans une description : « <p><img …> » ou « </p> » visibles
 * à l'écran et dans description_text. Trois formes, toutes servies ainsi par les sources :
 *
 * - « markup » : un élément (ou tout le document) ne contient que du texte qui est du HTML
 *   échappé d'un niveau (« &lt;p&gt;… &lt;/p&gt; ») : JSON-LD de Talent stocké avant le
 *   correctif des entités, bloc « Description de poste » d'une page Talent, profil WTTJ
 *   échappé par un ancien scan. On retire UN niveau d'échappement, dans ce seul nœud. Si
 *   l'élément est un <p> et que le HTML retrouvé commence par un bloc, l'enveloppe part avec
 *   (« markup-unwrap-p » : « <p><p>… » laisserait un paragraphe vide) ; du HTML en ligne
 *   (« &lt;b&gt;Lieu&lt;/b&gt; : Paris ») reste dans son paragraphe, sinon deux paragraphes
 *   se colleraient (« ParisContrat »). Les <br> d'origine restent des sauts de ligne, sauf
 *   entre des blocs : là ils venaient des retours à la ligne du HTML échappé (profil WTTJ).
 *   Si la description finit par une balise coupée dans ce nœud, elle est retirée d'abord
 *   (« truncated-tail » en plus).
 * - « doubled-end-tag » : un bloc dont le texte finit par sa propre fermante, coupée par
 *   une vraie balise (« 2026&lt;</strong>/p&gt;</p> », éditeur de LinkedIn) : le texte
 *   parasite est retiré, la vraie balise reste.
 * - « truncated-tail » : le document finit par une balise coupée (« marge ;&lt;li d »,
 *   texte APEC coupé à ~3 000 caractères à l'intérieur d'une balise) : elle est retirée.
 *
 * Critères stricts (sinon le HTML est rendu tel quel) : un texte qui CITE une balise
 * (« React, &lt;canvas&gt; et WebGL », « &lt;div&gt; est requis », « écrivez &lt;/p&gt; »),
 * une comparaison (« &lt; 50 salariés », « &lt;=1 mois »), une adresse entre chevrons,
 * du code (<code>, <pre>) ou une fermante orpheline restent du texte. Chaque « < » du HTML
 * retrouvé doit ouvrir une balise complète (un guillemet, un commentaire ou une balise
 * laissés ouverts avaleraient la suite), d'un nom connu (ni script, ni style, ni title, ni
 * formulaire, ni svg) ; puis le parseur vérifie, en place, que ce HTML ne ferme aucun
 * élément englobant et n'en laisse aucun ouvert (sauf en fin de document, où rien ne suit).
 * Faux positif accepté, le même que unescapeEscapedHtml : un élément dont TOUT le texte
 * commence par une balise et ferme un bloc (« &lt;p&gt; et &lt;/p&gt; délimitent un paragraphe »).
 *
 * jsdom ne sert qu'à repérer les nœuds et à vérifier : le remplacement se fait dans la
 * chaîne d'origine, aux positions du parseur, et tout le reste du HTML est rendu octet pour
 * octet. Un niveau d'échappement = unescapeOneLevel (lib/text/entities.ts) : &eacute;,
 * &nbsp;, &rsquo; restent des références. Idempotent : un second passage ne change rien.
 *
 * Une seule règle pour la réparation des offres en base (lib/db/repair-markup.ts) et pour
 * le filet d'écriture (lib/offres/clean-text.ts) : un nouveau scan réécrit exactement ce
 * que la réparation a produit. jsdom n'est lancé que si le HTML contient un « < » échappé.
 */

// Éléments HTML connus (73) : « <Prénom> », « <prenom.nom@exemple.fr> » ou
// « <https://…> » ne sont pas du balisage. Aucun élément de texte brut, de contenu
// étranger ou de formulaire (script, style, title, textarea, iframe, svg, math, form,
// input…) : réinterprétés, ils avaleraient la suite.
const KNOWN_ELEMENTS = new Set(
  ("a abbr address article aside b bdi bdo big blockquote br caption center cite code col colgroup dd del " +
    "details dfn div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd label " +
    "li main mark nav ol p pre q s samp section small span strike strong sub summary sup table tbody td " +
    "tfoot th thead time tr tt u ul var wbr").split(" ")
);
const VOID_ELEMENTS = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
// Blocs : leur balise ouvrante ferme un <p> ouvert (HTML5).
const BLOCK_ELEMENTS = new Set(
  ("address article aside blockquote center dd details div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 " +
    "header hr li main nav ol p pre section summary table ul").split(" ")
);
// Nœuds jamais réinterprétés : code cité, texte brut.
const SKIP_ANCESTORS = "code, pre, kbd, samp, script, style, textarea, title, noscript, xmp, template, svg, math";
// Critères de unescapeEscapedHtml (lib/text/entities.ts), sur le texte décodé : commence
// par une balise (ici d'un nom connu) et ferme au moins un bloc.
const TAG_START_RE = /^<\/?([A-Za-z][A-Za-z0-9]*)(?:[\s/>]|$)/;
const BLOCK_CLOSE_RE = /<\/(?:p|li|ul|ol|div|strong|em|b|h[1-6])>/i;
// Ce qui ouvre une balise, un commentaire ou une instruction pour le parseur…
const TAG_OPEN_RE = /<(?=[A-Za-z/!?])/g;
// …et une balise lexicalement complète : nom, attributs nus ou entre guillemets fermés
// (un « > » ou une apostrophe entre guillemets comptent), « / » final.
const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9]*)(?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*(\/?)>/y;
// Découpage de la source d'un nœud texte : une référence, une fin de ligne, un caractère.
const SOURCE_PIECE_RE = /&(?:#[xX][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);|\r\n?|[\s\S]/g;
const BLOCK_SELECTOR = "p, div, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt";
// Balise coupée en fin de texte, pas collée à une lettre ou un chiffre (« a<b » reste).
const TRUNCATED_TAIL_RE = /(?<![\p{L}\p{N}])<\/?([A-Za-z][A-Za-z0-9]*)(?:\s[^<>]*)?$/u;
const END_TAGS_RE = /<\/[A-Za-z][A-Za-z0-9]*\s*>/g;
// Préfiltre : un « < » échappé, sous une forme que decodeHtmlEntities décode.
const ESCAPED_LT_RE = /&(?:lt|LT|#0*60|#[xX]0*3[cC]);/;
// Marqueurs de la vérification en place (noms inconnus : jamais acceptés dans le balisage).
const START_MARK = "jobscout-debut";
const END_MARK = "jobscout-fin";

export type EscapedMarkupRule = "markup" | "markup-unwrap-p" | "doubled-end-tag" | "truncated-tail";

type Tag = { close: boolean; name: string; selfClosing: boolean };

/** Balises du texte, lues à chaque « < » ; null si l'un d'eux n'ouvre pas une balise complète. */
function readTags(markup: string): Tag[] | null {
  const tags: Tag[] = [];
  for (const m of markup.matchAll(TAG_OPEN_RE)) {
    TAG_RE.lastIndex = m.index!;
    const t = TAG_RE.exec(markup);
    if (!t) return null;
    tags.push({ close: t[1] === "/", name: t[2].toLowerCase(), selfClosing: t[3] === "/" });
  }
  return tags;
}

/** Toute balise a un nom connu ; aucune fermante sans ouvrante plus tôt (le contenu reste dans son nœud). */
function selfContained(tags: Tag[]): boolean {
  const open = new Map<string, number>();
  for (const { close, name, selfClosing } of tags) {
    if (!KNOWN_ELEMENTS.has(name)) return false;
    if (VOID_ELEMENTS.has(name)) continue;
    if (close) {
      const n = (open.get(name) ?? 0) - 1;
      if (n < 0) return false;
      open.set(name, n);
    } else if (!selfClosing) open.set(name, (open.get(name) ?? 0) + 1);
  }
  return true;
}

/** Texte affiché qui est du HTML échappé d'un niveau (formes « markup »). */
export function isEscapedMarkup(text: string): boolean {
  const t = text.trim();
  const m = TAG_START_RE.exec(t);
  if (!m || !KNOWN_ELEMENTS.has(m[1].toLowerCase()) || !BLOCK_CLOSE_RE.test(t)) return false;
  const tags = readTags(t);
  return !!tags && selfContained(tags);
}

/**
 * Position dans la source de chaque caractère du texte d'un nœud, lue avec
 * decodeHtmlEntities (une passe, point-virgule obligatoire) et la normalisation des fins
 * de ligne du parseur. null si décodeur et parseur ne lisent pas le même texte (« &ampx ») :
 * le nœud n'est alors pas touché.
 */
function sourceMap(source: string, data: string): number[] | null {
  const bounds: number[] = [];
  let out = "";
  for (const m of source.matchAll(SOURCE_PIECE_RE)) {
    const raw = m[0];
    const piece = raw[0] === "&" ? decodeHtmlEntities(raw) : raw[0] === "\r" ? "\n" : raw;
    const at = m.index!;
    if (piece === raw && piece.length > 1) for (let k = 0; k < piece.length; k++) bounds.push(at + k);
    else for (let k = 0; k < piece.length; k++) bounds.push(at);
    out += piece;
  }
  bounds.push(source.length);
  return out === data ? bounds : null;
}

/**
 * Le balisage, mis à la place de l'édit (source d'origine jusque-là, puis le balisage), est
 * lu par le parseur comme un contenu fermé sur lui-même, enfant de `container` : rien n'y
 * est avalé (texte brut, guillemet), il ne ferme aucun élément englobant (« <ul> » dans un
 * <p>, « <li> » dans un <li>) et n'en laisse aucun ouvert qui contiendrait la suite (mise
 * en forme reconstruite, liste, tableau). En fin de document (`atEnd` : rien ne suit que
 * des fermantes), un élément laissé ouvert ne contient rien et reste accepté.
 */
function staysInPlace(parser: DOMParser, prefix: string, markup: string, container: Node, atEnd: boolean): boolean {
  const doc = parser.parseFromString(`${prefix}<${START_MARK}></${START_MARK}>${markup}<${END_MARK}></${END_MARK}>`, "text/html");
  const a = doc.getElementsByTagName(START_MARK), b = doc.getElementsByTagName(END_MARK);
  if (a.length !== 1 || b.length !== 1) return false;
  const box = a[0].parentNode;
  if (!box || box.nodeName !== container.nodeName) return false;
  for (let n: Node = b[0]; n !== box; n = n.parentNode!) {
    const up: Node | null = n.parentNode;
    if (!up || up.lastChild !== n || (!atEnd && up !== box)) return false;
  }
  return true;
}

type Location = { startOffset: number; endOffset: number; startTag?: { startOffset: number }; endTag?: { endOffset: number } };
type TextInfo = { loc: Location; source: string; map: number[] | null };
type Edit = { start: number; end: number; text: string };

/**
 * HTML réparé (formes en tête de fichier) et règles appliquées ; le HTML d'entrée est rendu
 * tel quel s'il n'y a rien à réparer ou si deux réparations se chevauchaient.
 */
export function repairEscapedMarkupHtml(html: string): { html: string; rules: EscapedMarkupRule[] } {
  if (!html || !ESCAPED_LT_RE.test(html)) return { html, rules: [] };
  const dom = new JSDOM(html, { includeNodeLocations: true });
  try {
    const { document: doc, NodeFilter, DOMParser } = dom.window;
    const parser = new DOMParser();
    const loc = (n: Node) => dom.nodeLocation(n) as Location | null;
    const atEnd = (offset: number) => html.slice(offset).replace(END_TAGS_RE, "").trim() === "";
    const rules: EscapedMarkupRule[] = [];
    const edits: Edit[] = [];
    const info = new Map<Text, TextInfo>();
    const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
      if (t.parentElement?.closest(SKIP_ANCESTORS)) continue;
      const l = loc(t);
      if (!l) continue;
      const source = html.slice(l.startOffset, l.endOffset);
      info.set(t, { loc: l, source, map: sourceMap(source, t.data) });
    }
    const done = new Set<Node>();

    // Balise coupée en fin de document : dernier texte non vide, suivi seulement de fermantes
    // et de blancs ; [cut, end[ dans son texte.
    let tail: { node: Text; cut: number; end: number } | null = null;
    const lastText = [...info.keys()].reverse().find((t) => t.data.trim());
    if (lastText) {
      const { loc: l, map } = info.get(lastText)!;
      const end = lastText.data.trimEnd().length;
      const m = TRUNCATED_TAIL_RE.exec(lastText.data.slice(0, end));
      if (m && map && KNOWN_ELEMENTS.has(m[1].toLowerCase()) && atEnd(l.endOffset)) tail = { node: lastText, cut: m.index, end };
    }

    // « markup » : élément dont les enfants ne sont que du texte (et des <br> nus) formant du HTML échappé.
    for (const parent of new Set([...info.keys()].map((t) => t.parentNode!))) {
      const kids = Array.from(parent.childNodes);
      const plain = (k: ChildNode) =>
        (k.nodeType === 3 && !!info.get(k as Text)?.map) ||
        (k.nodeType === 1 && (k as Element).localName === "br" && !(k as Element).attributes.length && !k.childNodes.length);
      if (!kids.length || !kids.every(plain)) continue;
      // Balise coupée en fin de document dans ce nœud : retirée avant les contrôles.
      const cut = tail && kids.includes(tail.node) ? tail : null;
      const shownOf = (t: Text) => (cut?.node === t ? t.data.slice(0, cut.cut) + t.data.slice(cut.end) : t.data);
      const sourceOf = (t: Text) => {
        const { source, map } = info.get(t)!;
        return cut?.node === t ? source.slice(0, map![cut.cut]) + source.slice(map![cut.end]) : source;
      };
      const shown = kids.map((k) => (k.nodeType === 1 ? "\n" : shownOf(k as Text))).join("");
      if (!isEscapedMarkup(shown)) continue;
      const parts = kids.map((k) => (k.nodeType === 1 ? null : unescapeOneLevel(sourceOf(k as Text))));
      const tags = readTags(parts.map((s) => s ?? "\n").join(""));
      if (!tags) continue;
      // Entre des blocs, un <br> venait d'un retour à la ligne du HTML échappé (ancien block()
      // de WTTJ) : redevenu ce retour à la ligne. Sinon c'est un vrai saut de ligne.
      const hasBlock = tags.some((t) => !t.close && BLOCK_ELEMENTS.has(t.name));
      const brs = kids.map((k) => (k.nodeType === 1 ? loc(k) : null));
      if (!hasBlock && parts.some((s, i) => s == null && !brs[i])) continue;
      const markup = parts.map((s, i) => s ?? (hasBlock ? "\n" : html.slice(brs[i]!.startOffset, brs[i]!.endOffset))).join("");
      const first = kids[0], last = kids[kids.length - 1];
      const start = first.nodeType === 3 ? info.get(first as Text)!.loc.startOffset : loc(first)?.startOffset;
      const end = last.nodeType === 3 ? info.get(last as Text)!.loc.endOffset : loc(last)?.endOffset;
      if (start == null || end == null) continue;
      // Enveloppe <p> retirée seulement si le HTML retrouvé commence par un bloc (qui la
      // fermerait de toute façon) ; du HTML en ligne reste dans son paragraphe.
      const el = parent.nodeType === 1 ? (parent as Element) : null;
      const p = el?.localName === "p" ? loc(el) : null;
      const head = TAG_START_RE.exec(markup.trim());
      const unwrap = !!(p?.startTag && el!.parentNode && head && BLOCK_ELEMENTS.has(head[1].toLowerCase()));
      const from = unwrap ? p!.startOffset : start;
      const to = unwrap ? (p!.endTag ? p!.endTag.endOffset : end) : end;
      if (!staysInPlace(parser, html.slice(0, from), markup, unwrap ? el!.parentNode! : parent, atEnd(to))) continue;
      edits.push({ start: from, end: to, text: markup });
      rules.push(unwrap ? "markup-unwrap-p" : "markup");
      if (cut) rules.push("truncated-tail");
      kids.forEach((k) => done.add(k));
    }

    // « doubled-end-tag » : le texte du bloc finit par sa propre fermante, éclatée sur au moins deux nœuds.
    for (const el of Array.from(doc.querySelectorAll(BLOCK_SELECTOR))) {
      const tag = `</${el.localName}>`;
      const shown = el.textContent ?? "";
      const end = shown.trimEnd().length;
      if (end < tag.length || shown.slice(end - tag.length, end).toLowerCase() !== tag) continue;
      const nodes: Text[] = [];
      const tw = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = tw.nextNode() as Text | null; t; t = tw.nextNode() as Text | null) nodes.push(t);
      if (nodes.some((t) => done.has(t) || !info.get(t)?.map)) continue;
      const local: Edit[] = [];
      let pos = 0;
      for (const t of nodes) {
        const a = pos, b = pos + t.data.length;
        pos = b;
        const from = Math.max(a, end - tag.length), to = Math.min(b, end);
        if (from >= to) continue;
        const { loc: l, map } = info.get(t)!;
        local.push({ start: l.startOffset + map![from - a], end: l.startOffset + map![to - a], text: "" });
      }
      if (local.length < 2) continue;
      edits.push(...local);
      nodes.forEach((t) => done.add(t));
      rules.push("doubled-end-tag");
    }

    // « truncated-tail » seule : balise coupée hors d'un HTML échappé réparé ci-dessus.
    if (tail && !done.has(tail.node)) {
      const { loc: l, map } = info.get(tail.node)!;
      edits.push({ start: l.startOffset + map![tail.cut], end: l.startOffset + map![tail.end], text: "" });
      rules.push("truncated-tail");
    }

    if (!edits.length) return { html, rules: [] };
    edits.sort((a, b) => b.start - a.start);
    for (let i = 1; i < edits.length; i++) if (edits[i].end > edits[i - 1].start) return { html, rules: [] };
    let out = html;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return { html: out, rules };
  } finally {
    dom.window.close();
  }
}

/**
 * description_text tel que le scraper de la source le tire de description_html : texte du
 * <p> (textContent) pour l'APEC (lib/scrapers/apec.ts), htmlToText pour les autres.
 */
export function descriptionTextFromHtml(source: string, html: string): string {
  if (source !== "apec") return htmlToText(html);
  const dom = new JSDOM(`<div>${html}</div>`);
  try {
    return dom.window.document.body.textContent?.trim() ?? "";
  } finally {
    dom.window.close();
  }
}
