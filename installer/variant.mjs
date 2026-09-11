// ============================================================================
// installer/variant.mjs — variantes de build, source unique de vérité.
//
//   prod  (défaut)  : « JobScout », strictement le build d'aujourd'hui.
//   test            : « JobScout Test » — installeur de TEST destiné à un
//                     autre poste, qui COEXISTE avec un vrai JobScout :
//                     AppId Inno distinct, dossier d'installation, groupe,
//                     raccourcis, mutex et dossier de données distincts
//                     (%LOCALAPPDATA%\JobScout Test), nom de fichier distinct.
//
// Sélection : UNIQUEMENT le flag `--variant test` (ou `--variant=test`) sur
// build.mjs, assemble.mjs, test-install.mjs et launcher/build-launcher.mjs.
// Sans rien : prod. La variable d'environnement JOBSCOUT_BUILD_VARIANT n'est
// PAS lue : une variable oubliée dans une session ferait basculer un build
// standard en « test » sans que rien ne le montre sur la ligne de commande. Si
// elle est présente, elle est ignorée et un avertissement explicite est
// affiché en tête de build.
//
// Les GUID doivent rester IDENTIQUES à ceux de JobScout.iss (la recette relit
// la clé de désinstallation « {AppId}_is1 » : une divergence la fait échouer).
// ============================================================================

export const VARIANTS = {
  prod: {
    id: "prod",
    appName: "JobScout",
    dataDirName: "JobScout",
    appId: "{7E2C9A54-3B41-4F6D-9C77-1D0E8B5A2F31}",
    mutex: "Local\\JobScoutLauncherSingleton",
    setupBaseName: (version) => `JobScout_Setup_v${version}`,
  },
  test: {
    id: "test",
    appName: "JobScout Test",
    dataDirName: "JobScout Test",
    appId: "{A9C4E1B2-6D3F-4A57-8E21-5B7F0C9D3E64}",
    mutex: "Local\\JobScoutTestLauncherSingleton",
    setupBaseName: (version) => `JobScout_Test_Setup_v${version}`,
  },
};

/** Accepte un identifiant (« test ») ou un objet variant ; renvoie l'objet. */
export function asVariant(v) {
  if (v == null) return VARIANTS.prod;
  if (typeof v === "object") return v;
  const id = String(v).trim().toLowerCase();
  if (!VARIANTS[id]) {
    throw new Error(`Variant de build inconnu « ${v} » — attendu : prod | test.`);
  }
  return VARIANTS[id];
}

/** Nom de la variable d'environnement historique, désormais ignorée. */
export const IGNORED_ENV_VAR = "JOBSCOUT_BUILD_VARIANT";

/**
 * `--variant test`, `--variant=test`, sinon prod. SEUL le flag compte :
 * JOBSCOUT_BUILD_VARIANT, si présente dans l'environnement, est ignorée et
 * signalée (avertissement sur stderr, en tête de build).
 */
export function resolveVariant(
  argv = process.argv.slice(2),
  env = process.env,
  warn = (m) => process.stderr.write(m + "\n")
) {
  let id = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--variant") id = argv[i + 1] ?? "";
    else if (a.startsWith("--variant=")) id = a.slice("--variant=".length);
  }
  const variant = asVariant(id || "prod");
  if (env[IGNORED_ENV_VAR] !== undefined) {
    warn(
      `[variant] AVERTISSEMENT : ${IGNORED_ENV_VAR}=« ${env[IGNORED_ENV_VAR]} » est ` +
        `présente dans l'environnement et IGNORÉE. Seul le flag --variant sélectionne ` +
        `un variant de build ; ce build est « ${variant.id} » (${variant.appName}). ` +
        `Retirez la variable pour faire taire cet avertissement.`
    );
  }
  return variant;
}
