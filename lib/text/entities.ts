/**
 * Entités HTML (&eacute;, &apos;, &#43;, &#x1f680;…) dans les textes des offres.
 * Aucune dépendance serveur (ni Buffer ni jsdom) : importable partout, aperçu de
 * la liste des offres compris.
 *
 * Règles du décodeur (écarts volontaires avec HTML5, qui décode « &para=2 » en « ¶=2 ») :
 * - point-virgule obligatoire : « R&D », « A&B », « ?a=1&copy=2 » restent intacts ;
 * - une seule passe : « &amp;lt; » donne « &lt; », jamais « < » ;
 * - nom exact, casse comprise, pris dans une table fermée : « &L; » (« P&L; »),
 *   « &EACUTE; », « &notit; » ou « &constructor; » restent tels quels ;
 * - références numériques selon HTML5 : 0, au-delà de U+10FFFF et demi-codets
 *   → U+FFFD ; 0x80 à 0x9F → windows-1252 (« &#146; » donne « ’ »).
 */

// 266 noms : tout HTML 4.01 (252 noms, le jeu des éditeurs WYSIWYG en encodage nommé :
// TinyMCE, CKEditor) plus les alias HTML5 courants. Valeurs identiques à HTML5, générées
// depuis html.entities.html5 de Python (« &lang; » et « &rang; » suivent donc HTML5 :
// U+27E8 et U+27E9, pas U+2329 et U+232A). Les noms rencontrés dans les offres y sont ;
// « L » (de « P&L; ») n'est pas une entité et reste intact.
const NAMED: ReadonlyMap<string, string> = new Map(
  ([
    // XML
    ["amp", 0x26], ["lt", 0x3c], ["gt", 0x3e], ["quot", 0x22], ["apos", 0x27],
    // Alias majuscules HTML5
    ["AMP", 0x26], ["LT", 0x3c], ["GT", 0x3e], ["QUOT", 0x22], ["COPY", 0xa9], ["REG", 0xae],
    ["TRADE", 0x2122],
    // ISO-8859-1 (U+00A0 à U+00FF)
    ["nbsp", 0xa0], ["iexcl", 0xa1], ["cent", 0xa2], ["pound", 0xa3], ["curren", 0xa4], ["yen", 0xa5],
    ["brvbar", 0xa6], ["sect", 0xa7], ["uml", 0xa8], ["copy", 0xa9], ["ordf", 0xaa], ["laquo", 0xab],
    ["not", 0xac], ["shy", 0xad], ["reg", 0xae], ["macr", 0xaf], ["deg", 0xb0], ["plusmn", 0xb1],
    ["sup2", 0xb2], ["sup3", 0xb3], ["acute", 0xb4], ["micro", 0xb5], ["para", 0xb6], ["middot", 0xb7],
    ["cedil", 0xb8], ["sup1", 0xb9], ["ordm", 0xba], ["raquo", 0xbb], ["frac14", 0xbc], ["frac12", 0xbd],
    ["frac34", 0xbe], ["iquest", 0xbf], ["Agrave", 0xc0], ["Aacute", 0xc1], ["Acirc", 0xc2], ["Atilde", 0xc3],
    ["Auml", 0xc4], ["Aring", 0xc5], ["AElig", 0xc6], ["Ccedil", 0xc7], ["Egrave", 0xc8], ["Eacute", 0xc9],
    ["Ecirc", 0xca], ["Euml", 0xcb], ["Igrave", 0xcc], ["Iacute", 0xcd], ["Icirc", 0xce], ["Iuml", 0xcf],
    ["ETH", 0xd0], ["Ntilde", 0xd1], ["Ograve", 0xd2], ["Oacute", 0xd3], ["Ocirc", 0xd4], ["Otilde", 0xd5],
    ["Ouml", 0xd6], ["times", 0xd7], ["Oslash", 0xd8], ["Ugrave", 0xd9], ["Uacute", 0xda], ["Ucirc", 0xdb],
    ["Uuml", 0xdc], ["Yacute", 0xdd], ["THORN", 0xde], ["szlig", 0xdf], ["agrave", 0xe0], ["aacute", 0xe1],
    ["acirc", 0xe2], ["atilde", 0xe3], ["auml", 0xe4], ["aring", 0xe5], ["aelig", 0xe6], ["ccedil", 0xe7],
    ["egrave", 0xe8], ["eacute", 0xe9], ["ecirc", 0xea], ["euml", 0xeb], ["igrave", 0xec], ["iacute", 0xed],
    ["icirc", 0xee], ["iuml", 0xef], ["eth", 0xf0], ["ntilde", 0xf1], ["ograve", 0xf2], ["oacute", 0xf3],
    ["ocirc", 0xf4], ["otilde", 0xf5], ["ouml", 0xf6], ["divide", 0xf7], ["oslash", 0xf8], ["ugrave", 0xf9],
    ["uacute", 0xfa], ["ucirc", 0xfb], ["uuml", 0xfc], ["yacute", 0xfd], ["thorn", 0xfe], ["yuml", 0xff],
    // Typographie
    ["OElig", 0x152], ["oelig", 0x153], ["Scaron", 0x160], ["scaron", 0x161], ["Yuml", 0x178], ["fnof", 0x192],
    ["circ", 0x2c6], ["tilde", 0x2dc], ["ensp", 0x2002], ["emsp", 0x2003], ["thinsp", 0x2009],
    ["zwnj", 0x200c], ["zwj", 0x200d], ["lrm", 0x200e], ["rlm", 0x200f], ["ndash", 0x2013], ["mdash", 0x2014],
    ["lsquo", 0x2018], ["rsquo", 0x2019], ["sbquo", 0x201a], ["ldquo", 0x201c], ["rdquo", 0x201d],
    ["bdquo", 0x201e], ["dagger", 0x2020], ["Dagger", 0x2021], ["bull", 0x2022], ["hellip", 0x2026],
    ["permil", 0x2030], ["prime", 0x2032], ["Prime", 0x2033], ["lsaquo", 0x2039], ["rsaquo", 0x203a],
    ["oline", 0x203e], ["frasl", 0x2044], ["euro", 0x20ac], ["trade", 0x2122], ["larr", 0x2190],
    ["rarr", 0x2192], ["uarr", 0x2191], ["darr", 0x2193], ["harr", 0x2194], ["minus", 0x2212], ["le", 0x2264],
    ["ge", 0x2265], ["ne", 0x2260], ["asymp", 0x2248], ["infin", 0x221e], ["hyphen", 0x2010],
    ["numsp", 0x2007], ["puncsp", 0x2008], ["hairsp", 0x200a], ["NoBreak", 0x2060], ["ZeroWidthSpace", 0x200b],
    // HTML 4.01 : grec, lettres et symboles mathématiques, flèches doubles, symboles divers
    ["Alpha", 0x391], ["Beta", 0x392], ["Gamma", 0x393], ["Delta", 0x394], ["Epsilon", 0x395],
    ["Zeta", 0x396], ["Eta", 0x397], ["Theta", 0x398], ["Iota", 0x399], ["Kappa", 0x39a], ["Lambda", 0x39b],
    ["Mu", 0x39c], ["Nu", 0x39d], ["Xi", 0x39e], ["Omicron", 0x39f], ["Pi", 0x3a0], ["Rho", 0x3a1],
    ["Sigma", 0x3a3], ["Tau", 0x3a4], ["Upsilon", 0x3a5], ["Phi", 0x3a6], ["Chi", 0x3a7], ["Psi", 0x3a8],
    ["Omega", 0x3a9], ["alpha", 0x3b1], ["beta", 0x3b2], ["gamma", 0x3b3], ["delta", 0x3b4],
    ["epsilon", 0x3b5], ["zeta", 0x3b6], ["eta", 0x3b7], ["theta", 0x3b8], ["iota", 0x3b9], ["kappa", 0x3ba],
    ["lambda", 0x3bb], ["mu", 0x3bc], ["nu", 0x3bd], ["xi", 0x3be], ["omicron", 0x3bf], ["pi", 0x3c0],
    ["rho", 0x3c1], ["sigmaf", 0x3c2], ["sigma", 0x3c3], ["tau", 0x3c4], ["upsilon", 0x3c5], ["phi", 0x3c6],
    ["chi", 0x3c7], ["psi", 0x3c8], ["omega", 0x3c9], ["thetasym", 0x3d1], ["upsih", 0x3d2], ["piv", 0x3d6],
    ["image", 0x2111], ["weierp", 0x2118], ["real", 0x211c], ["alefsym", 0x2135], ["crarr", 0x21b5],
    ["lArr", 0x21d0], ["uArr", 0x21d1], ["rArr", 0x21d2], ["dArr", 0x21d3], ["hArr", 0x21d4],
    ["forall", 0x2200], ["part", 0x2202], ["exist", 0x2203], ["empty", 0x2205], ["nabla", 0x2207],
    ["isin", 0x2208], ["notin", 0x2209], ["ni", 0x220b], ["prod", 0x220f], ["sum", 0x2211],
    ["lowast", 0x2217], ["radic", 0x221a], ["prop", 0x221d], ["ang", 0x2220], ["and", 0x2227], ["or", 0x2228],
    ["cap", 0x2229], ["cup", 0x222a], ["int", 0x222b], ["there4", 0x2234], ["sim", 0x223c], ["cong", 0x2245],
    ["equiv", 0x2261], ["sub", 0x2282], ["sup", 0x2283], ["nsub", 0x2284], ["sube", 0x2286], ["supe", 0x2287],
    ["oplus", 0x2295], ["otimes", 0x2297], ["perp", 0x22a5], ["sdot", 0x22c5], ["lceil", 0x2308],
    ["rceil", 0x2309], ["lfloor", 0x230a], ["rfloor", 0x230b], ["lang", 0x27e8], ["rang", 0x27e9],
    ["loz", 0x25ca], ["spades", 0x2660], ["clubs", 0x2663], ["hearts", 0x2665], ["diams", 0x2666],
  ] as [string, number][]).map(([name, cp]): [string, string] => [name, String.fromCodePoint(cp)])
);

// HTML5 : une référence numérique de 0x80 à 0x9F désigne le caractère windows-1252
// (0x81, 0x8D, 0x8F, 0x90 et 0x9D, non attribués, gardent leur point de code).
const WINDOWS_1252: ReadonlyMap<number, number> = new Map([
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e], [0x85, 0x2026], [0x86, 0x2020],
  [0x87, 0x2021], [0x88, 0x02c6], [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152],
  [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c], [0x94, 0x201d], [0x95, 0x2022],
  [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a],
  [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178],
]);

const ENTITY_RE = /&(?:#[xX]([0-9A-Fa-f]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]*));/g;
const REPLACEMENT = "�";

/** Point de code d'une référence numérique, ou null si elle est invalide (→ U+FFFD). */
function numericCodePoint(digits: string, radix: 16 | 10): number | null {
  const d = digits.replace(/^0+/, "") || "0";
  // Au-delà de 6 chiffres hexadécimaux ou 7 décimaux, la valeur dépasse U+10FFFF
  // (et parseInt perdrait en précision sur une très longue suite).
  if (d.length > (radix === 16 ? 6 : 7)) return null;
  const cp = parseInt(d, radix);
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
  return WINDOWS_1252.get(cp) ?? cp;
}

export type DecodeOptions = {
  /** Espace insécable (&nbsp;, &#160;, &#xa0;) → espace simple, comme le texte extrait par htmlToText. */
  nbspToSpace?: boolean;
};

/** Décode les entités HTML d'un texte brut, en une seule passe (règles en tête de fichier). */
export function decodeHtmlEntities(s: string, opts: DecodeOptions = {}): string {
  if (!s || !s.includes("&")) return s;
  return s.replace(ENTITY_RE, (match, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    let out: string | undefined;
    if (hex !== undefined || dec !== undefined) {
      const cp = hex !== undefined ? numericCodePoint(hex, 16) : numericCodePoint(dec!, 10);
      out = cp === null ? REPLACEMENT : String.fromCodePoint(cp);
    } else {
      out = NAMED.get(name!);
      if (out === undefined) return match;
    }
    return opts.nbspToSpace && out === " " ? " " : out;
  });
}

/** Variante qui laisse passer null (champs facultatifs des offres). */
export function decodeHtmlEntitiesOrNull(s: string | null, opts?: DecodeOptions): string | null {
  return s == null ? s : decodeHtmlEntities(s, opts);
}

/** Échappe un texte brut pour l'insérer dans du HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const DOUBLE_ESCAPED_RE = /&amp;(#[xX][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g;

/**
 * HTML échappé deux fois par la source (« ind&amp;eacute;pendante », « &amp;#128640; ») :
 * ramène « &amp;X; » à « &X; » quand X est un nom de la table ou une référence numérique
 * valide. Le HTML n'est jamais décodé : on ne produit qu'une référence de caractère,
 * jamais un « < » brut ; « P&amp;L; » (nom inconnu) reste intact. Une seule passe.
 */
export function repairDoubleEscapedHtml(html: string): string {
  if (!html || !html.includes("&amp;")) return html;
  return html.replace(DOUBLE_ESCAPED_RE, (match, ref: string) => {
    if (ref[0] === "#") {
      const hex = ref[1] === "x" || ref[1] === "X";
      return numericCodePoint(ref.slice(hex ? 2 : 1), hex ? 16 : 10) === null ? match : `&${ref};`;
    }
    return NAMED.has(ref) ? `&${ref};` : match;
  });
}

/** Extrait de recherche (textContent, déjà décodé) inséré en paragraphe HTML : échappé. */
export function snippetToHtml(snippet: string): string {
  return snippet ? `<p>${escapeHtml(snippet)}</p>` : "";
}

const REAL_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9]*(?:[\s/>]|$)/;
// Document échappé : commence par une balise échappée…
const ESCAPED_DOC_START_RE = /^&lt;\/?[A-Za-z][A-Za-z0-9]*(?:[\s/]|&gt;)/;
// …et ferme au moins un bloc échappé.
const ESCAPED_BLOCK_CLOSE_RE = /&lt;\/(?:p|li|ul|ol|div|strong|em|b|h[1-6])&gt;/i;

/**
 * Retire UN niveau d'échappement d'une source HTML : seules les références qui échappent
 * la syntaxe (« < », « > », « & », « " », « ' », sous toute forme que decodeHtmlEntities
 * connaît) redeviennent des caractères ; &eacute;, &nbsp;, &rsquo; restent des références.
 * Même DOM qu'un décodage complet, mais htmlToText change ensuite &nbsp; en espace, alors
 * qu'une U+00A0 littérale resterait dans le texte et casserait la recherche
 * « chef de projet ».
 */
export function unescapeOneLevel(source: string): string {
  if (!source || !source.includes("&")) return source;
  return source.replace(ENTITY_RE, (ref) => {
    const c = decodeHtmlEntities(ref);
    return c === "<" || c === ">" || c === "&" || c === '"' || c === "'" ? c : ref;
  });
}

/**
 * Description servie en HTML entièrement échappé (JSON-LD de Talent : « &lt;p&gt;… ») :
 * sans aucune vraie balise, commençant par une balise échappée et fermant au moins un
 * bloc échappé, on retire un niveau d'échappement pour retrouver le HTML (unescapeOneLevel,
 * même règle que la réparation des offres en base). Sinon la chaîne est rendue telle
 * quelle : un texte brut qui CITE une balise (« React, &lt;canvas&gt; et WebGL », « balises
 * &lt;title&gt; », « &lt;div&gt; est requis ») reste du texte, sinon la balise devenait
 * réelle et le mot disparaissait (un « <title> » ou un « <script> » non fermé avalait même
 * toute la suite à l'affichage).
 * Le résultat passe par DOMPurify à l'affichage, comme tout description_html.
 */
export function unescapeEscapedHtml(html: string): string {
  if (!html || REAL_TAG_RE.test(html)) return html;
  if (!ESCAPED_DOC_START_RE.test(html.trim()) || !ESCAPED_BLOCK_CLOSE_RE.test(html)) return html;
  return unescapeOneLevel(html);
}
