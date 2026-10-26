/**
 * Point d'entrée exécuté une fois au démarrage du serveur Next.js. Sert à
 * programmer le scan quotidien (lib/scan/daily.ts) quand JOBSCOUT_DAILY_SCAN
 * est défini ; sans elle, rien ne se passe.
 *
 * Le test NEXT_RUNTIME doit encadrer l'import tel quel : remplacé à la
 * compilation, il retire la base SQLite du paquet Edge, qui ne la supporte pas.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDailyScan } = await import("@/lib/scan/daily");
    startDailyScan();
  }
}
