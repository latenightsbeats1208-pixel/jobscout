# Paquet Mac de JobScout

Chaîne de fabrication de `JobScout-Mac.dmg` : une image disque qui contient
`JobScout.app`, une application **universelle** (puce Apple et Intel) qui tourne
sur un Mac vierge, sans Node ni Terminal. Elle est construite et recettée sur
les runners macOS de GitHub Actions, puis publiée en Release **brouillon** sur
un tag `v*`. Guide utilisateur : [`INSTALL-MAC.md`](../../INSTALL-MAC.md).
Paquet Windows : [`installer/README.md`](../README.md).

## Décisions

| Sujet | Valeur |
| --- | --- |
| Livrables | `JobScout-Mac.dmg` (universel) et `SHA256SUMS.txt`, sans numéro de version dans les noms. Lien fixe : `https://github.com/latenightsbeats1208-pixel/jobscout/releases/latest/download/JobScout-Mac.dmg` |
| Volume | « JobScout <version> » |
| Identifiant | `fr.jobscout.app`, **figé dès la première publication** : le changer ferait de l'application une autre application pour macOS |
| macOS minimum | 11.0 déclaré (`LSMinimumSystemVersion`). Le build échoue si le `minos` de node ou du lanceur le dépasse : jamais de décalage silencieux |
| Node | v22.23.2, même version épinglée que Windows (`installer/node-runtime.json`) ; les deux archives officielles darwin réunies par `lipo`, puis re-signées ad hoc |
| Données | `~/Library/Application Support/JobScout/` |
| Signature | ad hoc par défaut. Developer ID et notarisation si les **5** secrets sont présents. Configuration partielle : **erreur** |
| Publication | tag `v*` sur un commit de `main` → Release **brouillon**. La publication se fait à la main, après la recette manuelle sur un vrai Mac |
| Mise à jour | aucune vérification automatique. Menu « Page des versions » |
| Variante test | refusée sur Mac (`--variant test` → erreur) |
| Pièces Windows inchangées | `ci.yml`, `JobScout.iss`, lanceur C#, `fetch-node.mjs`, `node-runtime.json`, `variant.mjs`, `sign.mjs`, `test-install.mjs` |

## Construire sur un Mac

Prérequis : macOS, les outils de développement en ligne de commande d'Apple
(`xcode-select --install` : `swiftc lipo codesign hdiutil iconutil ditto plutil
xattr xcrun`), Node ≥ 22.13 pour les scripts, et un accès à `nodejs.org` au
premier build (archives darwin de Node, gardées ensuite dans
`installer/vendor/node/v22.23.2/darwin-universal/`, ignoré par Git).

```bash
npm ci
node installer/mac/build-mac.mjs      # next build → app scellée ad hoc (étapes ci-dessous) ; --no-next-build réutilise .next
node installer/mac/sign-mac.mjs app   # Developer ID + notarisation si les 5 secrets sont là ; sinon l'app garde son sceau ad hoc
node installer/mac/make-dmg.mjs       # JobScout-Mac.dmg + SHA256SUMS.txt
node installer/mac/test-install-mac.mjs \
  --dmg installer/output/mac/JobScout-Mac.dmg \
  --sums installer/output/mac/SHA256SUMS.txt \
  --rapport installer/output/mac/rapport-construction.json
```

Sorties : `installer/dist/JobScout/app` (charge utile assemblée),
`installer/output/mac/JobScout.app`, `JobScout-Mac.dmg`, `SHA256SUMS.txt` et
`rapport-construction.json` (version, nombre de fichiers, Mo de `app/` et de
node, architectures, `minos`, durées).

Aucun dossier **source** ne doit s'appeler `build/`, `out/` ou `dist/` : le
`.gitignore` racine les ignore partout. Le lanceur se compile donc dans `out/`.

### Étapes de `build-mac.mjs`

Chaque étape bloque (`::error` puis code 1).

1. **Préconditions** : `darwin`, outils présents, `--variant test` refusé ;
   versions des outils publiées en `::notice`.
2. **`next build`**, appelé comme dans `build.mjs` (node direct,
   `NEXT_TELEMETRY_DISABLED=1`).
3. **`assemble({ target: "mac" })`** → `installer/dist/JobScout/app` : racine
   neutre POSIX `/JobScout/build` pour les chemins absolus réécrits,
   `data/LISEZ-MOI.txt` aux chemins Mac (fins de ligne `\n`), retour avant les
   étapes propres à Windows (node.exe, .ico, lanceur C#, textes Windows).
4. **Élagage** : `node_modules/sharp` et `node_modules/@img` supprimés, liste et
   taille journalisées. Un futur `next/image` casserait `/_next/image` : la garde
   Mach-O et le balayage des routes le verraient.
5. **Gardes sur `app/`** : 0 Mach-O (détecté par le contenu), 0 occurrence de
   `process.cwd()` ni de `os.homedir()` sous les formes `/…` et `\/…`, 0 lien,
   0 nom non ASCII ; absence des `.wasm` de tesseract-core : `::warning` seulement.
6. **Anti-fuite** : `checkLeaks([app], { extraNeedles: [dossier personnel du poste] })`, 0 occurrence.
7. **Node universel** (`fetch-node-mac.mjs`, voir plus bas).
8. **Démarrage à blanc** : node embarqué + `--require parent-guard.cjs server.js`,
   `JOBSCOUT_PARENT_GUARD=1`, stdin en **tube**, `PATH=/usr/bin:/bin`, `HOME`,
   `TMPDIR` et `JOBSCOUT_DATA_DIR` dans un bac à sable, port 3919 ; toutes les
   routes de `allRoutes()` (importé de `build.mjs`) sans 5xx ; fermeture de stdin
   → arrêt en moins de 10 s ; `tree-digest` de `app/` identique avant et après,
   sinon « le serveur a écrit dans l'app : … ».
9. **Lanceur** et **icône** (`make-icns.mjs` : `render(size, { margin: 0.1 })`
   de 16 à 1024 px, `JobScout.iconset`, `iconutil -c icns`).
10. **Bundle** (`bundle.mjs`) dans `installer/output/mac/JobScout.app` : `ditto`
    de `app/` vers `Resources/app`, Info.plist, PkgInfo, licences,
    `parent-guard.cjs`, `chmod 755` des deux exécutables, `xattr -cr`, contrôles
    du contenu livré.
11. **Anti-fuite sur le `.app`**, avant signature.
12. **Scellement ad hoc** : `codesign --force --sign - --timestamp=none
    JobScout.app` (sans `--deep`), puis `codesign --verify --deep --strict
    --verbose=2`.
13. **`rapport-construction.json`**, synthèse en `::notice` et dans
    `$GITHUB_STEP_SUMMARY`.

`make-dmg.mjs` : dossier de préparation (`ditto` de l'app, lien `Applications`
→ `/Applications`, `LISEZ-MOI.txt`), `hdiutil create -volname "JobScout
<version>" -fs HFS+ -format UDZO -imagekey zlib-level=9` (3 essais espacés,
`detach -force` en dernier recours), `hdiutil verify`, en mode Developer ID
signature + notarisation + agrafage du DMG, puis `shasum -a 256` →
`SHA256SUMS.txt`.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `installer/macho.mjs` | détection Mach-O, PE et ELF **par le contenu** ; architectures. Partagé, sans effet de bord |
| `installer/tree-digest.mjs` | liste triée « sha256 taille chemin » d'un dossier : non-régression Windows, instantanés du build et de la recette |
| `installer/mac/mac.json` | configuration unique : identifiant, noms, URL `https://github.com/…`, ports, macOS minimum |
| `installer/mac/node-darwin.json` | version et empreintes SHA-256 des archives darwin de Node |
| `installer/mac/fetch-node-mac.mjs` | Node universel |
| `installer/mac/build-mac.mjs` | orchestration du build |
| `installer/mac/bundle.mjs` | arborescence `.app`, Info.plist, PkgInfo, droits, contrôles |
| `installer/mac/make-icns.mjs` | icône |
| `installer/mac/launcher/main.swift`, `Supervisor.swift`, `AppUI.swift`, `build-launcher-mac.mjs` | lanceur |
| `installer/mac/parent-guard.cjs` | arrêt du serveur quand le lanceur disparaît |
| `installer/mac/LISEZ-MOI.txt` | texte du DMG |
| `installer/mac/make-dmg.mjs` | DMG et `SHA256SUMS.txt` |
| `installer/mac/sign-mac.mjs`, `node.entitlements.plist` | signature |
| `installer/mac/test-install-mac.mjs`, `recette-app.mjs` | recette automatisée |
| `installer/mac/check-version.mjs` | cohérence des versions |
| `installer/mac/release-notes.mjs`, `publier.mjs`, `ci-status.mjs` | publication et suivi de la CI |
| `.github/workflows/installeur-mac.yml` | construction, recette, publication |
| `tests/installer-*.test.ts`, `tests/parent-guard.test.ts` | tests Vitest de ces pièces (ceux qui exigent macOS sont ignorés sous Windows) |

## Contenu livré

```
Volume « JobScout <version> »
  JobScout.app
  Applications -> /Applications
  LISEZ-MOI.txt

JobScout.app/Contents/
  Info.plist  PkgInfo ("APPL????")
  MacOS/JobScout        lanceur Swift universel (x86_64 + arm64)
  MacOS/node            Node v22.23.2 universel, ad hoc
  Resources/JobScout.icns
  Resources/parent-guard.cjs
  Resources/THIRD_PARTY_NOTICES.txt
  Resources/LICENSE-Node.js.txt
  Resources/app/        standalone assemblé : server.js, .next/, node_modules/ (sans sharp ni @img),
                        prompts/, lib/db/schema.sql, lib/geo/data/*.json.gz, version.json réduit,
                        data/LISEZ-MOI.txt
  _CodeSignature/CodeResources
```

Interdits, vérifiés par le build **et** par la recette : un Mach-O ailleurs que
`MacOS/JobScout` et `MacOS/node`, un lien symbolique dans le `.app`, un nom de
fichier non ASCII, `.DS_Store` et `._*`, des attributs étendus.

`Info.plist` est généré depuis `mac.json` et `version.json`, puis contrôlé par
`plutil -lint`. Clés notables : `CFBundleIdentifier` `fr.jobscout.app`,
`CFBundleShortVersionString` et `CFBundleVersion` = version, `LSMinimumSystemVersion`
`11.0`, `NSAppTransportSecurity` `{NSAllowsLocalNetworking: true}`,
`NSLocalNetworkUsageDescription`, `NSDocumentsFolderUsageDescription` et
`NSDesktopFolderUsageDescription`, `JobScoutDataDirName`, `JobScoutReleasesURL`,
`JobScoutPortFirst` 3477 et `JobScoutPortLast` 3500. Volontairement absentes :
`LSUIElement`, `LSMultipleInstancesProhibited` (chaque compte macOS a son verrou,
son dossier et son port), `LSFileQuarantineEnabled` (Chromium téléchargé serait
mis en quarantaine), `NSSupportsSuddenTermination`.

## Le lanceur (`launcher/*.swift`)

Compilé sur le runner, sans `async/await` ni Swift Concurrency (la bibliothèque
de rétroportage n'est pas embarquée) : GCD, callbacks `URLSession`,
`posix_spawn`, `DispatchSource`.

`node installer/mac/launcher/build-launcher-mac.mjs [<dossier> | --out <dossier>]
[--no-self-test]` (appelé par `build-mac.mjs` avec `installer/output/mac/lanceur`,
sinon `installer/mac/launcher/out`) lance, depuis le dossier des sources (chemins
relatifs : aucun chemin de la machine de construction dans le binaire) :

```bash
swiftc -O -swift-version 5 -strict-concurrency=minimal -enable-upcoming-feature ConciseMagicFile \
  -module-name JobScoutLauncher -target x86_64-apple-macos11.0 -framework AppKit -Xlinker -dead_strip_dylibs \
  main.swift Supervisor.swift AppUI.swift -o <dossier>/JobScout-x86_64      # puis la même chose en arm64
lipo -create -output <dossier>/JobScout <dossier>/JobScout-x86_64 <dossier>/JobScout-arm64
codesign --force -s - --timestamp=none <dossier>/JobScout
<dossier>/selftest/JobScout.app/Contents/MacOS/JobScout --self-test       # paquet d'essai avec le vrai Info.plist
```

Contrôles bloquants : aucune dépendance forte à `libswift_Concurrency` (absente de
macOS 11), `lipo -archs` exactement `x86_64 arm64`, `minos` ≤ 11.0, aucun chemin
de la machine de construction dans le binaire, self-test à 0.

| Option | Effet |
| --- | --- |
| `--no-browser` | n'ouvre pas le navigateur |
| `--non-interactive` | sans AppKit (`dispatchMain()`) : messages sur stderr et dans le journal, sortie par un code. Mode de la recette |
| `--self-test` | contrôles sans serveur, sans rien écrire dans le vrai dossier de données : Info.plist, `proc_pidpath(getpid())`, table des processus, port, verrou, environnement de node, `runtime.json` ; une ligne `[self-test] OK\|ÉCHEC <nom> : …` par contrôle, puis `[self-test] N/N contrôles OK` |

Tout autre argument (`-psn_…` des anciens macOS) est ignoré et noté dans le journal.

| Code de sortie | Cas |
| --- | --- |
| 0 | arrêt normal |
| 1 | `--self-test` en échec |
| 2 | déjà ouvert (l'URL de `runtime.json` est rouverte, « JobScout est déjà ouvert : <url> » sur stderr) |
| 64 | mauvais emplacement (`/Volumes/…`, `…/AppTranslocation/…` ou tout volume en lecture seule) |
| 66 | dossier de données non inscriptible |
| 69 | paquet incomplet : `MacOS/node` absent ou non exécutable, `Resources/app/server.js` ou `Resources/parent-guard.cjs` absent, clé d'Info.plist manquante |
| 70 | serveur arrêté (pendant le démarrage ; de lui-même en mode sans interface ; « Quitter » après l'alerte E6 en mode fenêtre) |
| 71 | délai de démarrage dépassé (120 s) |

**Démarrage**, dans l'ordre : emplacement (jamais de copie automatique) ;
intégrité de node ; dossier de données (`JOBSCOUT_DATA_DIR` s'il est défini et
absolu, sinon Application Support / `JobScoutDataDirName`, créé en 0700 avec
`logs/` et `browsers/`, ce dernier exclu de Time Machine) ; verrou
`launcher.lock` (`flock`, relâché par le noyau même après un SIGKILL) ; état
périmé (ancien serveur de **ce** node arrêté, processus sous `browsers/` tués,
`runtime.json` supprimé) ; journal (`server.log` renommé `server.previous.log`,
nouveau journal en 0600 avec l'en-tête `[lanceur] <ISO> JobScout <version>,
macOS x.y (arm64|x86_64), dossier <d>`) ; port (premier de 3477 à 3500 qui se
lie **sans** `SO_REUSEADDR` et refuse un `connect`, sinon port système ; seul
cas de nouvel essai avec `SO_REUSEADDR` : un `EADDRINUSE` dû aux connexions du
serveur précédent en `TIME_WAIT`, qu'un autre programme à l'écoute ferait encore
échouer — sans lui, une relance rapide changerait d'adresse) ;
lancement de node par `posix_spawn` ; attente ; publication atomique de
`runtime.json` (`url`, `pid`, `serverPid`, `version`, `startedAt`) ;
`beginActivity(.userInitiated)` (pas de veille automatique ni d'App Nap) ;
navigateur.

**Environnement de node** : on part de l'environnement hérité. Retirés :
`NODE_OPTIONS`, `NODE_PATH`, `HOSTNAME`, `PORT`, `JOBSCOUT_VERSION`,
`JOBSCOUT_DB_PATH`, `JOBSCOUT_DOCS_PATH`, `PLAYWRIGHT_BROWSERS_PATH`. Posés :
`HOSTNAME=127.0.0.1` (le standalone écoute sur `0.0.0.0` sinon), `PORT`,
`NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, `JOBSCOUT_DATA_DIR`,
`JOBSCOUT_DB_PATH`, `JOBSCOUT_DOCS_PATH`, `PLAYWRIGHT_BROWSERS_PATH`,
`JOBSCOUT_PARENT_GUARD=1`, `HOME` s'il manque, un `PATH` qui contient au moins
`/usr/bin:/bin:/usr/sbin:/sbin`. Jamais posés : `JOBSCOUT_UPDATE_URL`,
`JOBSCOUT_VERSION`.

**Lancement** : argv `[MacOS/node, --require, Resources/parent-guard.cjs,
server.js]`, drapeaux `POSIX_SPAWN_SETPGROUP` (groupe propre),
`POSIX_SPAWN_CLOEXEC_DEFAULT`, `SETSIGDEF`, `SETSIGMASK` vide ; stdin = côté
lecture d'un tube dont seul le lanceur garde l'écriture ; stdout et stderr =
journal ; `cwd` = `Resources/app`.

**Attente** : `GET http://127.0.0.1:<port>/api/update` toutes les 400 ms
(`URLSession` éphémère, sans proxy, 2,5 s par requête), 120 s au plus. Prêt
**seulement si** HTTP 200 **et** `current` = `CFBundleShortVersionString` : un
autre serveur sur le port n'est jamais pris pour JobScout. Node meurt pendant
l'attente : `EADDRINUSE` dans les 40 dernières lignes du journal → port suivant
(3 essais), sinon alerte E2.

**Arrêt** (⌘Q, Dock, fermeture de session, SIGTERM/SIGINT/SIGHUP) :
`.terminateLater`, `kill(-pgid, SIGTERM)`, 5 s au plus, puis `SIGKILL` et 2 s ;
balayage final (processus sous `browsers/` et tout `MacOS/node` de ce bundle) ;
suppression de `runtime.json` ; ligne `[lanceur] arrêt (cause, x,y s)`. Next
attend la fin des requêtes en cours : un flux `/api/scan/start` ouvert retarde
l'arrêt, d'où le SIGKILL à 5 s.

**Interface** : fenêtre de 420 × 170 au moins (plus haute si le texte l'exige),
qui se masque à la fermeture (elle n'arrête rien) ; menus construits par code ;
menu JobScout (À propos de JobScout, Ouvrir JobScout ⌘O, Dossier de données,
Journal du serveur, Page des versions, Masquer JobScout, Quitter JobScout ⌘Q) ;
menu Édition (Copier, Tout sélectionner : l'adresse affichée se copie) ; menu
Fenêtre (État de JobScout, Réduire, Fermer) ; menu du Dock (Ouvrir JobScout,
Dossier de données, Journal du serveur) ; un clic sur l'icône rouvre la fenêtre
et le navigateur.

### Textes affichés

Ils sont cités mot pour mot dans `INSTALL-MAC.md` et dans `LISEZ-MOI.txt` :
modifiez-les ensemble.

| Repère | Texte |
| --- | --- |
| F1 | « JobScout démarre… », puis « Temps écoulé : N s » |
| F2 (après 30 s) | « Le premier démarrage peut prendre jusqu'à une minute : macOS vérifie l'application. » |
| F3 | « JobScout est prêt », « Il s'ouvre dans votre navigateur : http://127.0.0.1:3477 », boutons [Ouvrir dans le navigateur] [Quitter JobScout], « Fermer cette fenêtre n'arrête pas JobScout. Pour l'arrêter : menu JobScout › Quitter JobScout (⌘Q). » |
| E1 | « Glissez d'abord JobScout dans Applications » ; « JobScout est ouvert depuis le disque téléchargé ou depuis un emplacement temporaire. Glissez l'icône JobScout sur le dossier Applications, puis ouvrez-le depuis Applications. » ; [Ouvrir le dossier Applications] [Quitter] |
| E2 | « JobScout n'a pas pu démarrer » ; « Le serveur local s'est arrêté pendant le démarrage. Le journal en indique la cause. » ; [Ouvrir le journal] [Quitter] |
| E3 | « JobScout met trop de temps à démarrer » ; « Le serveur local n'a pas répondu en 120 secondes. Le journal en indique la cause. » ; [Ouvrir le journal] [Quitter] |
| E4 | « JobScout ne peut pas écrire dans son dossier de données », suivi du chemin ; [Quitter] |
| E5 | « L'application est incomplète. » (titre) ; « Retéléchargez JobScout. » ; [Quitter] |
| E6 | « JobScout s'est arrêté de façon inattendue » ; « Le serveur local s'est arrêté. Le journal en indique la cause. » ; [Relancer] [Ouvrir le journal] [Quitter] |

Chaque alerte est aussi écrite sur stderr (« JobScout : <titre> », puis le
message) et dans le journal, y compris en mode sans interface, où elle vaut
« Quitter ».

## `parent-guard.cjs`

Chargé par `--require`, armé seulement si `JOBSCOUT_PARENT_GUARD=1` (sur tout
système POSIX, pour que son test tourne aussi sous Linux ; jamais sous
Windows) : l'équivalent du Job Object Windows. Deux mécanismes indépendants
arrêtent le groupe de processus du serveur (SIGTERM, puis SIGKILL à 5 s) : la
fin de stdin et le changement de `ppid`. Ensemble, ils couvrent le SIGKILL du
lanceur. Chromium tourne dans son propre groupe : il est arrêté par le
gestionnaire `exit` de Playwright et par le balayage du lanceur.

**Tout lancement de test avec la garde armée doit fournir un tube sur stdin** :
`/dev/null` donne une fin de fichier immédiate, donc un arrêt immédiat.

## Données à l'exécution

| `~/Library/Application Support/JobScout/` | Contenu |
| --- | --- |
| `jobscout.db`, `-wal`, `-shm` | base |
| `documents/` | CV et lettres (le dossier choisi dans Profil l'emporte ; un dossier dans Documents déclenche la demande d'accès de macOS) |
| `browsers/` | moteur LinkedIn, exclu de Time Machine |
| `ocr/` | `fra.traineddata` et `eng.traineddata` (`lib/cv/text-extract.ts`, `cachePath`, tous systèmes depuis la 3.4.18) |
| `logs/server.log`, `logs/server.previous.log` | journaux, en 0600 |
| `runtime.json`, `launcher.lock` | état d'exécution |

Le dossier lui-même est en 0700. Rien n'est écrit dans le bundle : la recette
lance le serveur depuis le volume en lecture seule et compare les instantanés
avant et après.

## Node embarqué (`fetch-node-mac.mjs`)

- `node-darwin.json` : `{ "version", "darwin-arm64", "darwin-x64" }` (empreintes
  SHA-256 des `.tar.gz` officiels). Si `version` diffère de
  `installer/node-runtime.json` : `::error` « ré-épingler ».
- Pour chaque archive, de façon bloquante : SHA-256 égal à l'empreinte épinglée
  **et** à la ligne de `SHASUMS256.txt` téléchargée ; `tar -xzf` de `bin/node` et
  `LICENSE` ; `codesign --verify --strict` sur le binaire fin (Authority et
  TeamIdentifier publiés en `::notice`).
- Assemblage : `lipo -create` ; `lipo -archs` doit afficher exactement
  `x86_64 arm64` ; `codesign --force --sign - --timestamp=none` ;
  `codesign --verify` ; `node -v` = `v22.23.2` ; `xcrun vtool -show-build` :
  `minos` ≤ 11.0.
- **Ré-épingler** quand `node-runtime.json` change (Windows) : reporter la
  nouvelle version dans `node-darwin.json` avec les deux empreintes de son
  `SHASUMS256.txt` (`node-v<version>-darwin-arm64.tar.gz` et
  `node-v<version>-darwin-x64.tar.gz`). Node 22 est en fin de vie le
  30/04/2027 : passer les deux systèmes à Node 24 avant cette date (Node 24
  porte le minimum à macOS 13.5).

## Anti-fuite

Modifications **additives** de `installer/check-leaks.mjs` :

1. **Détection par le contenu** (`macho.mjs`, `isExecutableBinary(buf)`) :
   Mach-O fin (`feedface`, `cefaedfe`, `feedfacf`, `cffaedfe`), fat (`cafebabe`
   ou `cafebabf` avec au plus 30 architectures, pour écarter les `.class` Java),
   PE (`MZ`) ou ELF. Dans ces fichiers, on cherche les termes, pas les motifs.
   `BINARY_EXT` gagne `.dylib .icns .dmg .car .nib`.
2. **`extraNeedles`** : le build Mac y passe le dossier personnel de la machine
   de construction.
3. **Masquage en CI** : sous `GITHUB_ACTIONS=true`, terme et extrait passent par
   `mask()`.
4. **`FORBIDDEN_FILES`** gagne `.DS_Store`, `._*`, `*.p12`, `*.p8`,
   `*.keychain-db`, `leak-needles*.txt`.
5. **Points de contrôle** : `app/` (build), le `.app` avant signature (build),
   le volume monté et l'arbre installé (recette). Le DMG compressé n'est pas
   scanné : un scan ne prouverait rien.
6. Excision de la signature Mach-O : reportée au lot qui activera Developer ID.

**Non-régression Windows**, sur un poste Windows, avant tout changement de version :

```powershell
node installer/assemble.mjs --skip-node
node installer/tree-digest.mjs installer/dist/JobScout --exclude JobScout.exe --out "$env:TEMP\avant.txt"
# … modifications …
node installer/assemble.mjs --skip-node
node installer/tree-digest.mjs installer/dist/JobScout --exclude JobScout.exe --out "$env:TEMP\apres.txt"
node installer/tree-digest.mjs --compare "$env:TEMP\avant.txt" "$env:TEMP\apres.txt"   # code 0 : aucune différence, même nombre de fichiers
node installer/check-leaks.mjs    # même nombre de fichiers scannés, 0 occurrence
npm run typecheck
npm test
```

`tree-digest.mjs` sort en code 0 si les deux listes sont identiques, 1 s'il y a
des différences (listées), 2 sur une erreur d'usage. `JobScout.exe` est exclu :
le lanceur C# est recompilé à chaque assemblage. Le `.next` et `version.json`
doivent être les mêmes des deux côtés : la preuve porte sur le code de
l'installeur, à entrées égales.

## Signature (`sign-mac.mjs`)

Sous-commandes : `mode`, `app`, `dmg`, `rehearsal <app> <sortie>`, `cleanup`.
`macSigningMode(env)` renvoie `adhoc` (aucun secret), `developer-id` (les 5
secrets) ou **une erreur** (configuration partielle : jamais de faux succès).

| Secret du dépôt | Contenu |
| --- | --- |
| `JOBSCOUT_MAC_CERT_P12_BASE64` | certificat « Developer ID Application » et sa clé, en `.p12`, encodé en base64 |
| `JOBSCOUT_MAC_CERT_PASSWORD` | mot de passe du `.p12` |
| `JOBSCOUT_MAC_NOTARY_KEY_P8_BASE64` | clé API App Store Connect **de type équipe** (`.p8`), en base64 |
| `JOBSCOUT_MAC_NOTARY_KEY_ID` | identifiant de cette clé |
| `JOBSCOUT_MAC_NOTARY_ISSUER_ID` | identifiant de l'émetteur |

Les secrets ne sont donnés qu'aux étapes de signature du workflow. De
préférence, rangez-les dans un *Environment* GitHub protégé par une validation
manuelle.

**Mode `developer-id`** :

1. Trousseau temporaire `$RUNNER_TEMP/jobscout-signature.keychain-db`, recréé à
   chaque sous-commande (`app` puis `dmg`), mot de passe généré
   (`crypto.randomBytes(24)` en base64, masqué par `::add-mask::`) :
   `create-keychain`, `set-keychain-settings -lut
   21600`, `unlock-keychain`, `import -T /usr/bin/codesign`,
   `set-key-partition-list -S apple-tool:,apple:,codesign: -s`,
   `list-keychains -d user -s`, `find-identity -v -p codesigning`. Le `.p8` est
   écrit avec `umask 077`, puis effacé.
2. Signature de l'intérieur vers l'extérieur, toujours `--force --options runtime
   --timestamp` : node avec `node.entitlements.plist` (`cs.allow-jit` et
   `cs.allow-unsigned-executable-memory`, sans `get-task-allow`, `allow-dyld-…`
   ni `disable-library-validation`), le lanceur sans entitlement, puis le `.app`.
3. `codesign --verify --deep --strict`.
4. Notarisation : `ditto -c -k --keepParent`, `xcrun notarytool submit --wait
   --timeout 30m --output-format json`, **puis toujours** `notarytool log`.
   Statut différent de `Accepted` : échec.
5. `stapler staple`, puis `stapler validate`.
6. DMG construit avec l'app agrafée : `codesign --timestamp`, notarisation,
   agrafage.
7. Contrôles bloquants : `stapler validate` et la ligne Authority
   `Developer ID Application` de `codesign -dvv`. `spctl` et `syspolicy_check`
   sont informatifs (leur réponse dépend de l'état de Gatekeeper sur le runner).
8. `cleanup` lancé avec `if: always()`.

**Répétition du runtime renforcé**, dans la recette et sur chaque runner : node
copié, re-signé ad hoc avec runtime renforcé, en deux variantes
d'entitlements (`allow-jit` seul, puis `allow-jit` +
`allow-unsigned-executable-memory`). Chaque variante lance un JS gourmand en
JIT, puis `server.js` et `/api/update`. Résultat publié par architecture :
avertissement en ad hoc, bloquant en mode Developer ID. Elle fixe le jeu
minimal d'entitlements avant tout achat de certificat.

**Activer Developer ID** : compte Apple Developer Program (99 $ par an ; en
compte individuel, le certificat affiche publiquement le nom légal de son
titulaire ; un compte d'organisation demande une entité légale et un numéro
D-U-N-S) ; certificat « Developer ID Application » (la demande de certificat
peut se faire avec `openssl`, puis le `.cer` téléchargé est fusionné en
`.p12`) ; clé API App Store Connect de type équipe (rôle Admin pour la créer) ;
les 5 secrets ; puis un push sur une branche `verif/` pour le premier essai
notarisé.

## Intégration continue (`.github/workflows/installeur-mac.yml`)

Déclencheurs : push sur `verif/**`, tags `v*`, lancement manuel. Actions
épinglées par SHA. `permissions: contents: read` par défaut.

| Job | Machine | Rôle |
| --- | --- | --- |
| `construire` | `macos-15` | `check-version.mjs`, `npm ci`, `build-mac.mjs` (aucun secret), `sign-mac.mjs app` et `make-dmg.mjs` (secrets de signature seulement ici), artefact `JobScout-Mac` (DMG, SHA256SUMS, rapport), `sign-mac.mjs cleanup` |
| `recette` | `macos-15`, `macos-26`, `macos-15-intel`, `macos-26-intel` | `test-install-mac.mjs` sur **le même** DMG ; en cas d'échec, artefact `recette-<os>` |
| `publication-essai` | `ubuntu-latest`, hors tag | `publier.mjs publier --dir dist-mac --dry-run` : affiche la décision |
| `publier` | `ubuntu-latest`, sur tag | tag sur `main` et à la bonne version, tests `ci.yml` verts sur ce commit, attestation de provenance du DMG, création ou complément du brouillon, constat |

Un push `verif/**` lance environ 11 jobs macOS (ceux de `ci.yml` compris) :
comptez environ deux fois plus d'attente avant les résultats.

**Scripts** :

| Commande | Effet |
| --- | --- |
| `node installer/mac/check-version.mjs [--root <dossier>]` (variables `REF_TYPE`, `REF_NAME`) | `version.json` = `package.json` = `package-lock.json` (racine et `packages[""]`) ; entrée de changelog présente, sans texte provisoire (`TODO`, `A_COMPLETER`, `{{…}}`) ; `CONFIDENTIALITE.md` contient « JobScout <version> » ; `node-darwin.json` aligné sur `node-runtime.json` ; aucune version périmée écrite en dur dans `installer/mac/LISEZ-MOI.txt` ; sur un tag, tag = `v<version>`. Codes : 0 cohérent, 1 écart, 2 usage incorrect |
| `node installer/mac/test-install-mac.mjs --dmg <dmg> --sums <SHA256SUMS.txt> --rapport <rapport-construction.json> [--out recette-mac]` | la recette (groupes A à J ci-dessous), sur un Mac. Journaux et `resultats.json` dans `--out`. Codes : 0 tout vert, 1 un contrôle en échec (`::error` avec la fin du journal utile), 2 recette refusée (usage, poste non vierge, système autre que macOS) |
| `node installer/mac/sign-mac.mjs mode` | affiche `adhoc` ou `developer-id` (et l'écrit dans `$GITHUB_OUTPUT`) ; configuration partielle : code 1, message qui ne cite que les noms des secrets |
| `node installer/mac/ci-status.mjs annoter --fichier <journal> --titre <titre> [--lignes 20] [--niveau error\|warning\|notice]` | publie la fin d'un journal en annotation GitHub (étape « Fin du journal de construction » du workflow) |
| `node installer/mac/publier.mjs attendre-tests --sha <sha> [--minutes 30] [--workflow ci.yml]` | attend que les runs `push` de `ci.yml` sur ce commit soient tous terminés ; tous doivent être verts, sinon `::error` |
| `node installer/mac/publier.mjs publier --dir <dossier> [--dry-run] [--tag vX.Y.Z]` | collection exacte (`JobScout-Mac.dmg`, `SHA256SUMS.txt`, `rapport-construction.json`) et empreinte recalculée ; lecture des releases (la liste, qui montre aussi les brouillons à un jeton qui peut écrire) ; décision : publiée, plusieurs releases pour le tag ou brouillon avec d'autres fichiers → refus, brouillon → `gh release upload --clobber` du DMG et de SHA256SUMS, puis titre et texte réécrits (`gh api -X PATCH` de la release par son identifiant), absente → `gh release create "$TAG" --draft --verify-tag` ; le texte est toujours rendu à partir du DMG local, de `SIGNATURE` et de `GITHUB_SHA` ; constat : brouillon, titre, exactement 2 fichiers, tailles et SHA-256 égaux, et texte qui affiche le SHA-256 local (seul sur sa ligne), la taille, le mode de signature constaté (jamais celui de l'autre mode) et le commit. Variables : `GH_REPO`, `GH_TOKEN`, `TAG`, `SIGNATURE`, `GITHUB_SHA`. Codes : 0 fait, 1 refus ou contrôle en échec, 2 usage incorrect |
| `node installer/mac/ci-status.mjs <branche\|sha> [--workflow <nom>] [--annotations auto\|toutes\|echecs\|aucune] [--json] [--out <fichier>]` | depuis n'importe quel poste : runs, jobs et annotations de la CI, par l'API publique de GitHub sans jeton (60 requêtes par heure). Le dépôt est lu dans `git remote get-url origin`. Tous les runs du commit comptent, quelle que soit leur branche : un échec de `ci.yml` sur `verif/…` n'est pas masqué par sa réussite sur `main` (même règle que `attendre-tests`). Codes : 0 tout vert, 1 un run en échec, 2 usage ou API illisible, 3 runs en cours sans échec, 4 aucun run |

**Ordre imposé pour une version** : le workflow ne crée jamais de tag
(`--verify-tag`). Le tag se pose et se pousse à la main, sur un commit **déjà
dans `main`** : un `GITHUB_TOKEN` ne peut pas créer de référence vers un commit
qui modifie `.github/workflows`.

## Recette automatisée (`test-install-mac.mjs`, `recette-app.mjs`)

Uniquement des modules `node:` (dont `node:sqlite`) et des fichiers
`installer/*.mjs`, sans `npm ci`. Assertions sur des codes et des valeurs
exactes, jamais sur un texte qu'un message d'échec pourrait contenir. Code 1 au
premier échec, avec les 15 dernières lignes de `server.log` ; `::notice` final
« N/N contrôles OK, macOS x.y, architecture, durées ».

**Sécurité** : en CI, `~/Library/Application Support/JobScout` et
`/Applications/JobScout.app` doivent être absents au départ. Hors CI, la
recette refuse de toucher à une installation existante et travaille dans un
dossier temporaire désigné par `JOBSCOUT_DATA_DIR`. **Aucune exécution en
quarantaine, jamais** : un binaire en quarantaine peut ouvrir une boîte de
Gatekeeper qui bloque le runner.

| Groupe | Contrôles |
| --- | --- |
| A. Fichier livré | `shasum -a 256 -c`, `hdiutil verify`, montage en lecture seule au contenu exact, `codesign --verify --deep --strict`, anti-fuite du volume |
| B. Paquet | `plutil -lint`, identifiant, versions, `lipo -archs` des deux exécutables, inventaire Mach-O, liens et noms, fichiers présents et absents, `minos`, architecture de node sur le runner, `--self-test` |
| C. Serveur depuis le volume en lecture seule | pièges `ANTHROPIC_*` et `JOBSCOUT_PROXY_URL`, contrôles repris de `test-install.mjs` (onboarding, réglages IA vides, `/api/update`, base vierge, profil accentué relu intact, pages, « JobScout v<version> »), communes `75056` et `91228`, aucune route en 5xx, aucun `EROFS`, `EACCES` ni `EPERM` dans le journal, arrêt par stdin en moins de 10 s |
| D. Installation | `ditto` vers `/Applications`, anti-fuite de l'arbre installé, instantané de référence |
| E. Lanceur réel sans interface | pièges `HOSTNAME=0.0.0.0` et `NODE_OPTIONS`, `runtime.json` en moins de 120 s sur `http://127.0.0.1:3477`, écoute sur `127.0.0.1` seulement, droits 0700 et 0600, seconde instance en code 2, moteur LinkedIn installé (chemin avec espace, sans quarantaine, exclu de Time Machine, Chromium lancé par le node embarqué), SIGTERM → code 0 et plus aucun processus, relance |
| F. Pannes | SIGKILL du lanceur pendant le téléchargement du moteur, SIGKILL de node (code 70), port 3477 occupé par un faux serveur, relance après SIGKILL |
| G. Interface | `open -n … --args --no-browser` puis SIGTERM ; lancement depuis le volume : code 64 |
| H. Désinstallation et mise à jour | signature intacte après usage, rien d'écrit dans l'app, suppression de l'app sans perte de la base, réinstallation, inventaire des fichiers créés hors du dossier de données |
| I. Gatekeeper (diagnostic) | copie **jamais exécutée** marquée en quarantaine ; `spctl` et `syspolicy_check` en `::notice` ; bloquant seulement en mode Developer ID |
| J. Runtime renforcé | la répétition décrite plus haut |

**Hors de portée des runners** : la vraie boîte « Ouvrir quand même », la
translocation réelle, les libellés français, le pare-feu, l'accès au réseau
local, Quitter pendant un scan LinkedIn, macOS 11 à 14. D'où la recette
manuelle.

## Recette manuelle sur un vrai Mac (12 points)

À faire sur le **brouillon** de Release, avant de le publier. Notez pour chaque
point : la version de macOS, la puce, le résultat, et les libellés exacts quand
il y en a. Tout écart avec `INSTALL-MAC.md` ou `LISEZ-MOI.txt` se corrige dans
les textes avant publication.

1. **Téléchargement par Safari** du `JobScout-Mac.dmg` du brouillon. Le fichier
   arrive dans Téléchargements.
2. **Empreinte** : `shasum -a 256 ~/Downloads/JobScout-Mac.dmg` est égal à la
   ligne de `SHA256SUMS.txt`.
3. **Ouverture du DMG** : la fenêtre montre JobScout, Applications et
   LISEZ-MOI.txt ; le LISEZ-MOI est lisible, accents compris.
4. **Double-clic dans le DMG** : noter l'ordre des fenêtres (blocage de
   Gatekeeper, puis message E1 « Glissez d'abord JobScout dans Applications »),
   et si une autorisation donnée ici vaut ensuite pour la copie de Applications.
5. **Glisser dans Applications** : copie complète, éjection du disque sans
   message d'erreur.
6. **Premier lancement** : relever les libellés exacts de l'alerte, de
   Réglages Système › Confidentialité et sécurité, du bouton « Ouvrir quand
   même », de la confirmation et de la demande de mot de passe. Les comparer à
   la section « Premier lancement » d'`INSTALL-MAC.md`.
7. **Navigateur** : la fenêtre « JobScout démarre… », puis « JobScout est
   prêt », et le navigateur s'ouvre sur `http://127.0.0.1:3477` avec
   l'assistant de premier réglage.
8. **Pare-feu** : aucune alerte « accepter les connexions entrantes » (pare-feu
   de macOS activé pour l'essai).
9. **LinkedIn** : moteur installé depuis Profil › Recherche › Sources, scan
   lancé, Quitter JobScout pendant le scan : plus aucun `chrome-headless-shell`
   (Moniteur d'activité) au bout de 10 s.
10. **⌘Q puis relance** : arrêt complet (plus de `node` de JobScout), relance
    sans nouvelle autorisation, profil présent.
11. **Mise à jour simulée** : remplacer l'app par celle d'un autre build (même
    version ou suivante) : l'autorisation est-elle redemandée ? Les données
    sont-elles intactes ?
12. **Corbeille** : mettre l'app à la Corbeille : `~/Library/Application
    Support/JobScout` reste en place, et une réinstallation retrouve le profil.

## Publier une version

1. Branche `verif/…` : `ci.yml` et `installeur-mac.yml` verts (4 recettes),
   lus avec `node installer/mac/ci-status.mjs <branche>` ; l'essai à blanc
   affiche la décision « créer ».
2. Avance rapide de `main` sur ce commit, puis `ci.yml` vert sur `main`.
3. Tag `v<version>` sur ce commit de `main`, poussé à la main : le job
   `publier` crée la Release **en brouillon** (2 fichiers, SHA-256 relu).
4. Recette manuelle en 12 points sur ce brouillon.
5. Publication du brouillon (« Publish release »), à la main : c'est un geste
   public et irréversible. Le workflow ne remplace jamais une Release publiée.
6. Constat : `releases/latest` désigne la nouvelle version, et
   `https://github.com/latenightsbeats1208-pixel/jobscout/releases/latest/download/JobScout-Mac.dmg`
   répond par une redirection (302).

Entre l'arrivée des liens dans `main` et la publication, le lien fixe du DMG
répond 404 : publiez le jour même.

## À constater au premier run

Taille réelle du DMG et de `bin/node` universel ; état de Gatekeeper sur les
runners (`spctl --status`) ; Rosetta sur les runners arm64 ; gestion des
brouillons par `gh release upload` ; entitlements minimaux (résultat de la
répétition) ; écriture éventuelle de Next dans `.next/cache` (contrôle
`EROFS`) ; arrêt de Chromium à la fermeture de son tube de débogage ; présence
des `.wasm` de tesseract-core (OCR des CV en image dans les paquets, Windows
compris).
