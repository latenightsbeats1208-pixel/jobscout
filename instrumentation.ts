/**
 * Démarrage du serveur (Next.js) : les notes en base calculées par une version
 * précédente de la note sont recalculées une fois, avant toute lecture de la
 * liste. Local, déterministe et gratuit (lib/scoring/rescore.ts).
 *
 * L'import reste DANS le test sur NEXT_RUNTIME : Next compile aussi ce fichier
 * pour le runtime edge, qui ne connaît pas node:crypto, et ne retire le code
 * Node que sous cette forme (un retour anticipé ne suffit pas).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureScoresCurrent } = await import("@/lib/scoring/rescore");
    try {
      if (ensureScoresCurrent()) console.log("[jobscout] notes recalculées pour la nouvelle version de la note");
    } catch (e) {
      console.error("[jobscout] recalcul des notes au démarrage impossible :", e);
    }
  }
}
