/**
 * Mode serveur (JOBSCOUT_SERVER_MODE=1) : JobScout tourne sur une autre machine
 * que le navigateur (conteneur Docker, homelab). Les gestes propres au poste
 * de travail — ouvrir un dossier dans l'explorateur, choisir le dossier des
 * documents sur le disque — n'y ont pas de sens : les documents se
 * téléchargent depuis le navigateur.
 */
export function isServerMode(): boolean {
  return process.env.JOBSCOUT_SERVER_MODE === "1";
}
