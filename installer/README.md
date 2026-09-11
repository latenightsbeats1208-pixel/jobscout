# Paquet Windows de JobScout

Chaîne de fabrication de `JobScout_Setup_vX.Y.Z.exe` : un installeur autonome
qui tourne sur un PC Windows vierge, sans Node ni Python.

## Fabriquer une release

```powershell
# 1. incrémenter version.json (et package.json à la même version)
# 2. rafraîchir la liste anti-fuite depuis la base locale (une fois par poste)
node installer/check-leaks.mjs --from-db
# 3. build complet : next build + assemblage + anti-fuite + démarrage à blanc + Inno Setup
npm run package
# 4. recette de bout en bout (installe, teste, désinstalle, ne laisse rien)
node installer/test-install.mjs
```

Sorties : `installer/dist/JobScout/` (charge utile) et
`installer/output/JobScout_Setup_<version>.exe` (installeur).

Variantes utiles :

| Commande | Effet |
| --- | --- |
| `node installer/build.mjs --no-next-build` | réutilise le `.next` existant |
| `node installer/build.mjs --assemble-only` | s'arrête avant Inno Setup |
| `node installer/build.mjs --variant test` | installeur de **test** « JobScout Test » (voir ci-dessous) |
| `node installer/fetch-node.mjs --refresh` | ré-épingle la dernière LTS Node 22.x |

## Variant de test (`--variant test`)

Un exécutable de test à installer sur un autre poste pour un retour terrain,
qui **coexiste avec un vrai JobScout** sans rien partager :

```powershell
node installer/build.mjs --variant test          # SEUL le flag compte (voir ci-dessous)
node installer/test-install.mjs --variant test   # recette dédiée
```

Sortie : `installer/output/JobScout_Test_Setup_v<version>.exe`. **Sans le
flag, le build standard ne change pas d'un octet** ; `installer/variant.mjs`
est la source unique des noms, et le variant se propage ainsi. La variable
d'environnement `JOBSCOUT_BUILD_VARIANT` n'est **pas** lue : si elle traîne
dans la session, elle est ignorée et un avertissement explicite s'affiche en
tête de build (un build standard ne peut pas devenir « test » en silence).

| Couche | Mécanisme | Effet en variant test |
| --- | --- | --- |
| Inno (`JobScout.iss`) | `/DVariant=test` | AppName, DefaultDirName (`{autopf}\JobScout Test`), groupe, raccourcis, `UninstallDisplayName` « JobScout Test », **AppId GUID distinct**, `AppMutex` distinct, dossier de données du désinstalleur, `OutputBaseFilename`, **installation par utilisateur imposée** (pas de `PrivilegesRequiredOverridesAllowed`, donc pas d'écran « pour tous les utilisateurs » qui contredirait la page d'information) |
| Launcher (`launcher/`) | **constante de compilation** `/define:JOBSCOUT_VARIANT_TEST` passée par `build-launcher.mjs`, lue par `#if` dans `JobScoutLauncher.cs` ; **ressource de version** (AssemblyInfo généré depuis `version.json` + variant) | nom affiché « JobScout Test » (tray, menus, messages), données sous `%LOCALAPPDATA%\JobScout Test`, mutex `Local\JobScoutTestLauncherSingleton`, FileVersion / ProductName / FileDescription « JobScout Test » (« JobScout » en standard). Figé dans l'exe : aucun fichier de configuration à côté du binaire, et le launcher standard est compilé à l'identique |
| Application | `assemble.mjs` écrit `"variant": "test"` dans le `version.json` réduit du paquet ; `lib/update/check.ts › currentVariant()` le lit | pastille « JobScout Test v<version> » en pied de barre latérale, `variant` dans `/api/update` |
| Installeur | `INFO-INSTALLATION.txt` généré par `install-info.mjs` **avec les tailles mesurées sur le dist** (+ désinstalleur estimé à 6 Mio, total arrondi au Mo supérieur), livré dans le paquet et branché en `InfoBeforeFile` | page « ce que cet installeur va faire » AVANT l'installation : composants et tailles (désinstalleur compris), raccourcis (groupe du menu Démarrer, icône Bureau décochable), emplacement des données, ce qui n'est pas installé (moteur LinkedIn ~100 Mo à télécharger / ~265 Mo sur le disque, aucune clé d'IA), prérequis, réseau, avertissement SmartScreen (build non signé) |

La recette `--variant test` ajoute aux contrôles standard : `INFO-INSTALLATION.txt`
présent dans le dist, composants annoncés cohérents avec le dist réel (5 %),
total annoncé cohérent avec l'arborescence **réellement installée**
(désinstalleur compris, 5 %, jamais inférieur) et avec `EstimatedSize` du
registre, base **vierge** (0 profil, 0 offre, 0 document), répertoire de
données « JobScout Test » créé par le launcher, JobScout standard du poste
intact, entrée de désinstallation « JobScout Test », pastille « JobScout Test ».
Pour tous les variants, elle vérifie aussi la ressource de version du launcher
et que `logs\server.log` est écrit en UTF-8 lisible.

Textes de l'assistant (`JobScout.iss`, UTF-8 avec BOM) : l'invite de fin de
désinstallation passe par `[CustomMessages]` (français / anglais, accents
corrects), pour les deux variants.

## Signature de code (Authenticode)

Sans signature, SmartScreen affiche « Éditeur inconnu » au premier lancement et
les navigateurs marquent le téléchargement comme potentiellement dangereux.
`build.mjs` signe automatiquement dès que l'environnement fournit un
certificat — **qui ne doit JAMAIS entrer dans le dépôt, ni son chemin ni son
mot de passe** (`installer/.gitignore` bloque `*.pfx` par ceinture de sécurité) :

```powershell
$env:JOBSCOUT_SIGN_PFX = "D:\coffre\jobscout-codesign.pfx"   # hors du dépôt
$env:JOBSCOUT_SIGN_PFX_PASSWORD = "…"
npm run package
```

Variables reconnues (voir `installer/sign.mjs`) :

| Variable | Rôle |
| --- | --- |
| `JOBSCOUT_SIGN_PFX` + `JOBSCOUT_SIGN_PFX_PASSWORD` | certificat fichier PFX |
| `JOBSCOUT_SIGN_THUMBPRINT` | alternative : empreinte SHA1 d'un certificat du magasin utilisateur (token EV, Trusted Signing) |
| `JOBSCOUT_SIGN_TIMESTAMP_URL` | serveur RFC 3161 (défaut DigiCert, repli Sectigo) |
| `JOBSCOUT_SIGNTOOL` | chemin de `signtool.exe` si le Windows SDK n'est pas détecté |

Ce qui est signé, dans l'ordre : le launcher `JobScout.exe` de la charge utile
(après anti-fuite et démarrage à blanc, AVANT compression Inno), puis
l'installeur **et** le désinstalleur (Inno Setup appelle `sign.mjs` via
`SignTool=`). L'**horodatage est obligatoire** — sans lui les signatures
expirent avec le certificat — et la fin de build vérifie chaque binaire avec
`Get-AuthenticodeSignature` (signé + horodaté, sinon échec).

Deux points de vigilance :

- **Le certificat porte l'identité de l'éditeur** (pour un auto-entrepreneur :
  le nom légal). C'est public par construction — c'est le nom que Windows
  affiche — et `check-leaks.mjs` excise la zone de signature PE avant son scan
  pour ne pas confondre ce nom d'éditeur avec une fuite. Tout le reste du
  binaire reste contrôlé.
- **Sans certificat, le build reste possible** : un avertissement explicite
  remplace la signature. Pour un essai local, un certificat auto-signé suffit
  (`New-SelfSignedCertificate -Type CodeSigningCert` + `Export-PfxCertificate`) ;
  la vérification signale alors « chaîne non approuvée » sans bloquer.

Le choix du certificat commercial (coûts et SmartScreen, état août 2026) :
l'EV ne donne **plus** de réputation SmartScreen immédiate depuis mars 2024 —
inutile de le payer. Les deux options sérieuses sont **Azure Artifact Signing**
(ex Trusted Signing, ~10 $/mois, micro-entreprise française éligible via la
validation « Organization », signature via `JOBSCOUT_SIGN_THUMBPRINT`/dlib) et
**Certum Standard Code Signing in the Cloud** (~209 €/an, accessible aussi en
personne physique, sans token matériel). La réputation SmartScreen se construit
ensuite avec le volume d'installations propres ; elle est attachée au
certificat et se transmet donc de version en version — signer chaque release
avec la même identité.

## Contenu du paquet

```
JobScout/
  JobScout.exe        launcher natif (C#/.NET Framework 4, aucun runtime à installer)
  jobscout.ico        icône générée par make-icon.mjs
  LISEZ-MOI.txt
  runtime/node.exe    Node 22 LTS officiel, SHA256 vérifié contre SHASUMS256.txt
  app/                sortie Next « standalone » + statiques + prompts + schema.sql
    data/             VIDE — les données réelles vivent dans %LOCALAPPDATA%\JobScout
```

## Emplacements à l'exécution

| Quoi | Où |
| --- | --- |
| Installation | `%LOCALAPPDATA%\Programs\JobScout` (par utilisateur, sans admin) |
| Base, documents, journaux | `%LOCALAPPDATA%\JobScout` |
| Moteur LinkedIn (Chromium) | `%LOCALAPPDATA%\JobScout\browsers`, téléchargé à la demande |
| Variant de test | `%LOCALAPPDATA%\Programs\JobScout Test` et `%LOCALAPPDATA%\JobScout Test` — totalement séparés |

Le launcher pose `JOBSCOUT_DATA_DIR`, `JOBSCOUT_DB_PATH`, `JOBSCOUT_DOCS_PATH`
et `PLAYWRIGHT_BROWSERS_PATH` ; `lib/paths.ts` est le seul point de résolution.
Le répertoire d'installation n'est jamais écrit. La désinstallation conserve les
données (elle propose seulement de les effacer, réponse par défaut « Non »).

## Les trois pièges du packaging Next, et leur traitement

1. **`.env` et `data/` recopiés dans la sortie standalone.** `next build` copie
   `.env` (donc la clé API du poste) et tout ce que le traceur croise sous
   `data/`. `assemble.mjs` ne fait donc jamais de copie brute : exclusions
   explicites, plus `outputFileTracingExcludes` dans `next.config.ts`. Les
   manifests `*.nft.json` sont supprimés : ils listent les fichiers rencontrés,
   noms de CV générés compris.

2. **Chemins absolus du poste de build.** Webpack inscrit le chemin du projet
   dans les identifiants de modules (`.next/server/**/page.js`, manifests de
   références client) — environ 1 400 occurrences. Aucune option de build ne les
   retire : `assemble.mjs` les réécrit uniformément vers `C:\JobScout\build`
   dans les trois encodages rencontrés (échappé, brut, slashs avant). Ce sont
   des identifiants, pas des chemins ouverts à l'exécution ; la substitution est
   cohérente sur toute l'arborescence, et le démarrage à blanc le prouve.

3. **Modules manquants dans la sortie tracée.** Le traceur rate certains
   modules chargés dynamiquement : le runtime interne de Next
   (`next/dist/{lib,shared,server,client}`, sinon le serveur ne démarre pas),
   le `cli.js` de `playwright-core` (installateur du moteur LinkedIn), et le
   `pdf.worker.mjs` de `pdfjs-dist`. `assemble.mjs` les complète, et un
   **démarrage à blanc** avec PATH minimal échoue le build avant compression si
   quelque chose manque encore.

## Contrôle anti-fuite

`installer/check-leaks.mjs` est un verrou de release : le build s'arrête si un
terme personnel subsiste. Il cherche une liste générique versionnée et une liste
locale `leak-needles.local.txt` (jamais versionnée) régénérée par `--from-db` à
partir du profil, des snapshots et du texte brut du CV de la base locale.

Le contrôle porte sur **la charge utile** (`installer/dist`) et sur
**l'arborescence réellement installée** (`test-install.mjs`). Grepper le `.exe`
ne prouve rien : Inno compresse sa charge utile en LZMA.

Les fichiers `unins000.*` sont exclus de la recette : Inno les écrit sur la
machine cible et ils journalisent forcément les chemins du compte qui installe.

## Non embarqué, volontairement

- **Chromium / Playwright (~100 Mo à télécharger, ~265 Mo sur le disque une
  fois décompressé — headless shell seul via `--only-shell`, mesures du
  30/08/2026)** — seule la source LinkedIn en a besoin.
  Téléchargé depuis Profil › Sources ; si LinkedIn reste décoché, rien n'est
  téléchargé. Voir `lib/scrapers/browser-engine.ts` et `/api/engine`.
- **`@napi-rs/canvas` (37 Mo)** — pdfjs signale son absence au chargement, mais
  ce paquet ne sert qu'à rastériser un PDF en image. JobScout n'extrait que du
  texte (`getTextContent`), vérifié fonctionnel dans le paquet.
- **`next/dist/compiled` (56 Mo)** et les sourcemaps — le traceur couvre le
  nécessaire.
