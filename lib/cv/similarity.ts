// Lightweight similarity utilities for fuzzy matching of experiences/educations/skills.

const STOPWORDS = new Set([
  "le","la","les","un","une","des","de","du","et","ou","a","au","aux","en","sur","pour","par","avec","dans","chez",
  "the","a","an","of","and","or","to","in","on","for","with","as","at","from","by",
  "h","f","fh","hf","mf","mfd",
]);

export function normalizeStr(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string | null | undefined): Set<string> {
  const norm = normalizeStr(s);
  return new Set(
    norm
      .split(/[^a-z0-9+#]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );
}

/** Jaccard similarity between two token sets, 0..1 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

/** Token Jaccard between two strings */
export function strSim(a: string | null | undefined, b: string | null | undefined): number {
  return jaccard(tokens(a), tokens(b));
}

/** True if both ranges overlap (any of the dates may be null/"present") */
export function datesOverlap(
  a: { start_date?: string | null; end_date?: string | null },
  b: { start_date?: string | null; end_date?: string | null }
): boolean {
  // If neither has any date, can't compare → consider compatible
  if (!a.start_date && !a.end_date && !b.start_date && !b.end_date) return true;
  const open = "9999-12";
  const aStart = a.start_date ?? "0000-00";
  const aEnd = a.end_date === "present" ? open : a.end_date ?? aStart;
  const bStart = b.start_date ?? "0000-00";
  const bEnd = b.end_date === "present" ? open : b.end_date ?? bStart;
  return aStart <= bEnd && bStart <= aEnd;
}

export function pickLonger(a: string | null | undefined, b: string | null | undefined): string | null {
  const aa = (a ?? "").trim();
  const bb = (b ?? "").trim();
  if (!aa) return bb || null;
  if (!bb) return aa || null;
  return aa.length >= bb.length ? aa : bb;
}

export function pickEarliestDate(a?: string | null, b?: string | null): string | null {
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  return a <= b ? a : b;
}

export function pickLatestDate(a?: string | null, b?: string | null): string | null {
  // "present" wins over any explicit date
  if (a === "present" || b === "present") return "present";
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  return a >= b ? a : b;
}

/** Merge two arrays of strings, deduping by normalized form */
export function mergeStrings(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...a, ...b]) {
    const k = normalizeStr(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s.trim());
  }
  return out;
}

/** Merge two arrays of bullets, deduping by token Jaccard >= 0.7 */
export function mergeBullets(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const tokenized: Set<string>[] = [];
  for (const s of [...a, ...b]) {
    const t = tokens(s);
    let isDup = false;
    for (const existing of tokenized) {
      if (jaccard(t, existing) >= 0.7) {
        isDup = true;
        break;
      }
    }
    if (!isDup) {
      out.push(s.trim());
      tokenized.push(t);
    }
  }
  return out;
}
