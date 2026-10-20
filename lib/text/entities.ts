/**
 * Entités HTML restées dans le texte d'une annonce. Welcome to the Jungle en
 * laisse dans ses champs texte (« 6&#xa0;ans d'expérience », « Bac &#43;5 »,
 * « exp&eacute;rience ») : l'expérience exigée et les compétences n'y étaient
 * pas reconnues — un poste à 6 ans d'expérience passait pour un poste junior.
 */
const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  laquo: "«", raquo: "»", hellip: "…", ndash: "–", mdash: "—", euro: "€", deg: "°", middot: "·", bull: "•",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", auml: "ä", ccedil: "ç",
  icirc: "î", iuml: "ï", ocirc: "ô", ouml: "ö", ugrave: "ù", ucirc: "û", uuml: "ü", oelig: "œ", aelig: "æ",
  Eacute: "É", Egrave: "È", Ecirc: "Ê", Agrave: "À", Ccedil: "Ç", Ocirc: "Ô", OElig: "Œ",
};

/** Décode aussi le double encodage (« &amp;#xa0; ») des champs déjà échappés une fois. */
export function decodeHtmlEntities(text: string): string {
  let out = text;
  for (let i = 0; i < 3 && out.includes("&"); i++) {
    const next = decodeOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function decodeOnce(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const point = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(point) || point > 0x10ffff) return match;
      // Espaces insécables : de simples espaces pour les recherches de texte.
      return point === 0xa0 || point === 0x202f ? " " : String.fromCodePoint(point);
    }
    return NAMED[body] ?? match;
  });
}
