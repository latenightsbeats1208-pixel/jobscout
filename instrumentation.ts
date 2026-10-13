/**
 * Démarrage du serveur (Next.js) : les notes en base calculées par une version
 * précédente de la note sont recalculées une fois, avant toute lecture de la
 * liste. Local, déterministe et gratuit (lib/scoring/rescore.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureScoresCurrent } = await import("@/lib/scoring/rescore");
    if (ensureScoresCurrent()) console.log("[jobscout] notes recalculées pour la nouvelle version de la note");
  } catch (e) {
    console.error("[jobscout] recalcul des notes au démarrage impossible :", e);
  }
}
