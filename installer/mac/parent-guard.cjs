"use strict";
// ============================================================================
// installer/mac/parent-guard.cjs — équivalent macOS du Job Object Windows
//
// Arrête le serveur et ses processus enfants quand JobScout.app disparaît
// (Quitter, plantage, Forcer à quitter). Chargé par le lanceur Mac avant
// server.js :
//
//   Contents/MacOS/node --require Contents/Resources/parent-guard.cjs server.js
//
// Armé uniquement par le lanceur (JOBSCOUT_PARENT_GUARD=1) : sans cette
// variable, ce fichier ne fait rien (npm run dev, tests, autres systèmes).
//
// Deux mécanismes indépendants, qui couvrent ensemble le SIGKILL du lanceur :
//   1. fin de stdin : le lanceur garde SEUL le côté écriture d'un tube branché
//      sur l'entrée standard de node ; le noyau le ferme à la mort du lanceur ;
//   2. changement de ppid : node est rattaché à launchd quand le lanceur meurt.
//
// node est chef de son groupe de processus (posix_spawn POSIX_SPAWN_SETPGROUP) :
// SIGTERM au groupe atteint aussi « cli.js install » (moteur LinkedIn). Chromium
// tourne dans son propre groupe : il est arrêté par le gestionnaire « exit » de
// Playwright et par le balayage du lanceur.
//
// Tout lancement de test avec la garde armée doit fournir un TUBE sur stdin :
// /dev/null donnerait une fin de fichier immédiate, donc un arrêt immédiat.
//
// Armée sur tout système POSIX (pas seulement darwin) : le mécanisme est le
// même sous Linux, ce qui permet au test tests/parent-guard.test.ts de tourner
// aussi sur les runners Ubuntu. Jamais sous Windows (pas de groupes de
// processus : le Job Object du lanceur C# y joue ce rôle).
// ============================================================================
if (process.env.JOBSCOUT_PARENT_GUARD === "1" && process.platform !== "win32") {
  const parent = process.ppid;
  let stopping = false;
  const stop = (why) => {
    if (stopping) return;
    stopping = true;
    console.log(`[jobscout] arrêt du serveur : ${why}`);
    try {
      process.kill(-process.pid, "SIGTERM");
    } catch {
      // node n'est pas chef de groupe (lancement manuel) : lui seul.
      process.kill(process.pid, "SIGTERM");
    }
    setTimeout(() => {
      try {
        process.kill(-process.pid, "SIGKILL");
      } catch {}
      process.exit(1);
    }, 5000).unref();
  };
  process.stdin.on("end", () => stop("lanceur fermé"));
  process.stdin.on("error", () => stop("lanceur fermé"));
  process.stdin.resume();
  setInterval(() => {
    if (process.ppid !== parent) stop("lanceur disparu");
  }, 1000).unref();
}
