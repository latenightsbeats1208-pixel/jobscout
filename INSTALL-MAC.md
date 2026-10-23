# Installer JobScout sur Mac, pas à pas

Ce guide est la version Mac du [guide d'installation](INSTALL.md). Il s'adresse à tout le monde, y compris si vous n'avez jamais ouvert le Terminal. Suivez les étapes dans l'ordre : chacune dit ce que vous allez voir et comment savoir que c'est réussi.

> Ce guide a été écrit à partir du code de JobScout et de la documentation officielle d'Apple, de Node.js et de Playwright. Son parcours (installation des dépendances, démarrage, moteur LinkedIn, lanceur) est rejoué automatiquement à chaque modification de JobScout sur des Mac de test de GitHub, à puce Apple et Intel. Les noms des boutons de macOS peuvent varier un peu selon votre version. Les durées marquées « sous Windows » n'ont pas été mesurées sur un Mac.

## En bref

| | |
|---|---|
| **Votre Mac** | puce Apple (M1 et suivantes) ou processeur Intel : les deux fonctionnent, avec les mêmes fichiers. Pour savoir ce que vous avez : menu Pomme (la pomme en haut à gauche de l'écran) › **À propos de ce Mac**. La ligne « Puce » indique une puce Apple, la ligne « Processeur » un Mac Intel. |
| **Versions de macOS** | **macOS 13.5 ou plus récent** : Node.js 24, recommandé · **macOS 11 à 13.4** : Node.js 22 · **LinkedIn** : macOS 12 minimum · **IA locale** (Ollama, LM Studio) : macOS 14 minimum. Détail juste en dessous. |
| **En vidéo** | les trois tutoriels ont été tournés sous Windows. Le [2. Mise en place](https://youtu.be/gOMQkcsD6LA) et le [3. Utilisation](https://youtu.be/45uLxsWXXLQ) valent pour le Mac ; le [1. Installation](https://youtu.be/cIh4PSmPlKE) seulement en partie. Voir « [Les tutoriels vidéo sur Mac](#les-tutoriels-vidéo-sur-mac) ». |
| **Temps total** | comme sous Windows : environ 10 à 20 minutes, dont 10 à 15 devant l'écran. L'installation des dépendances (`npm ci`) prend 17 s sur puce Apple et 34 à 45 s sur Intel sur les Mac de test de GitHub (connexion de centre de données, mesuré le 08/10/2026) ; chez vous, comptez environ 1 minute (mesuré sous Windows sur la fibre), davantage sur une connexion lente. |
| **Ce qu'il faut** | un Mac, une connexion internet, le mot de passe de votre session Mac (pour installer Node.js), votre CV, et une IA : une clé API chez le fournisseur de votre choix, ou un modèle local gratuit. Ni Xcode, ni Homebrew, ni Git ne sont nécessaires. |
| **Coût** | JobScout est gratuit. L'IA en ligne est facturée par votre fournisseur, sur votre clé (avec Claude, environ 0,12 à 0,20 $ par dossier CV + lettre) ; elle est gratuite avec un modèle local. Le scan et le tri des offres sont gratuits. |
| **Où vont vos données** | profil, offres, documents, candidatures et clés API restent sur votre Mac, dans le dossier `jobscout/data`. Pour lire votre CV et rédiger, JobScout envoie le texte du CV, votre profil et l'offre au fournisseur d'IA choisi, ou à aucun avec un modèle local. Pendant un scan, les sites d'offres reçoivent vos mots-clés, vos pays cibles et votre adresse IP. L'éditeur de JobScout ne reçoit rien. Détail : [politique de confidentialité](CONFIDENTIALITE.md). |

### Votre version de macOS

Menu Pomme › **À propos de ce Mac** : le nom et le numéro de macOS s'affichent (par exemple « macOS Sonoma 14.5 »).

| Votre macOS | Node.js à installer | Ce qui fonctionne |
|---|---|---|
| **14 Sonoma ou plus récent** (15 Sequoia, 26 Tahoe…) | Node 24 | tout : JobScout, LinkedIn, IA en ligne ou locale (LM Studio : puce Apple seulement) |
| **13 Ventura, version 13.5 ou plus** | Node 24 | JobScout, LinkedIn, IA en ligne. Pas d'IA locale : Ollama et LM Studio demandent macOS 14. |
| **12 Monterey, ou Ventura avant 13.5** | Node 22 (22.13 ou plus) | JobScout, LinkedIn, IA en ligne |
| **11 Big Sur** | Node 22 (22.13 ou plus) | JobScout et IA en ligne, **sans LinkedIn** : son moteur demande macOS 12 |
| **10.15 Catalina ou plus ancien** | — | JobScout ne s'installe pas : Node 22 demande au moins macOS 11 |

Node 24 demande macOS 13.5 ou plus récent. Node 22 fonctionne dès macOS 11 et reste maintenu jusqu'au 30 avril 2027.

## Combien de temps ça prend ?

Les durées « sous Windows » ont été mesurées le 30/09/2026 sur un PC Windows 11 relié à la fibre. Avec une connexion plus lente, l'étape 3 peut prendre quelques minutes de plus.

| Étape | Durée | Devant l'écran ? |
|---|---|---|
| 1. Installer Node.js | quelques minutes (2 à 5 min sous Windows) | oui (quelques clics, votre mot de passe) |
| 2. Récupérer JobScout | environ 1 minute par le ZIP (sous Windows). Par Git, sur un Mac où Git n'a jamais servi, ajoutez l'installation des outils de développement d'Apple (durée non mesurée). | oui |
| 3. Installer les dépendances (`npm ci`) | 17 s sur puce Apple et 34 à 45 s sur Intel sur les Mac de test de GitHub (connexion de centre de données, mesuré le 08/10/2026) ; chez vous, comptez environ 1 minute (mesuré sous Windows sur la fibre), davantage sur une connexion lente | **non**, laissez tourner |
| 4. Premier démarrage (`npm run dev`) | 14 à 17 s, premières pages comprises, sur les Mac de test de GitHub (connexion de centre de données, mesuré le 08/10/2026) (18 s sous Windows) | non |
| 5. Premier réglage : IA, CV, préférences | 5 à 10 min (sous Windows ; tout se passe dans le navigateur) | oui |
| 6. Premier scan des offres | environ 1 à 3 minutes avec France Travail seule, le réglage par défaut (estimation d'après les plafonds du code : 50 offres au plus) ; **10 à 20 min** si vous activez d'autres sources (mesuré sous Windows en 3.4.10 : 17 min pour environ 790 offres avec 6 sources, dont la moitié pour LinkedIn) | **non**, JobScout travaille seul |
| Moteur LinkedIn (facultatif) | 6 s sur puce Apple et 10 s sur Intel sur les Mac de test de GitHub (connexion de centre de données, mesuré le 08/10/2026) ; chez vous, 1 à 2 minutes (mesuré sous Windows) | non |

### Faut-il laisser le Mac allumé ?

- **Pendant l'installation (étape 3) et pendant un scan (étape 6)** : oui. Le Mac ne doit pas se mettre en veille. Vous pouvez continuer à vous en servir normalement.
- **Le plus simple : `caffeinate`.** Ce guide lance JobScout avec `caffeinate -i npm run dev` (étape 4). Tant que JobScout tourne, le Mac ne se met pas en veille tout seul. Pour l'installation, `caffeinate -i npm ci` fait de même (étape 3). Rien à installer, rien à régler, rien à défaire : l'outil fait partie de macOS. Le [lanceur Mac](#le-lanceur-mac) le fait pour vous.
- **Sur un portable, ne fermez pas le capot** : un MacBook fermé se met en veille, et la veille coupe le scan. Branchez-le sur secteur si possible.
- **Si vous préférez un réglage permanent** : ouvrez les Réglages Système, tapez « suspension » dans le champ de recherche en haut à gauche, puis activez l'option « Empêcher la suspension d'activité automatique… lorsque l'écran est éteint » (sur un portable, elle ne vaut que sur adaptateur secteur). Son emplacement change selon la version de macOS et le type de Mac (Batterie, Énergie, Économiseur d'énergie ou Moniteurs) : la recherche la trouve partout.
- **La fenêtre du Terminal où tourne JobScout doit rester ouverte.** La fermer arrête l'application (vos données sont conservées). La réduire (bouton jaune, ou ⌘M) ne pose aucun problème.
- **Si le Mac se met en veille pendant un scan**, le scan s'interrompt : relancez-le depuis la page Offres.
- **Quand JobScout est fermé, rien ne tourne en arrière-plan** : pas de scan automatique, pas de connexion.

## Ce qu'il vous faut

- **Un Mac** sous macOS 11 ou plus récent (13.5 ou plus recommandé, voir le [tableau des versions](#votre-version-de-macos)), avec 8 Go de mémoire de préférence (4 Go minimum) et **environ 1 Go d'espace disque libre** (plus environ 210 Mo si vous activez LinkedIn : 206 Mo mesurés sur puce Apple, 208 Mo sur Intel).
- **Le mot de passe de votre session Mac**, celui qui déverrouille l'écran. L'installeur de Node.js le demande. Votre compte n'est pas administrateur ? Il faudra le nom et le mot de passe d'un compte administrateur de ce Mac.
- **Node.js** : l'étape 1 explique comment l'installer.
- **Une IA, au choix** ([guide de l'IA, pas à pas](GUIDE-IA.md)) : une clé API chez un fournisseur en ligne (Anthropic, OpenAI, Google Gemini, Mistral, DeepSeek…), ou un modèle local gratuit (Ollama dès macOS 14 ; LM Studio dès macOS 14, sur puce Apple uniquement). Voir « [Une IA locale sur Mac](#une-ia-locale-sur-mac) ».
- **Votre CV** en PDF, Word (`.docx`), texte (`.txt`) ou image PNG ou JPEG. Un CV écrit dans **Pages**, une photo **HEIC** prise avec un iPhone ou un fichier **TextEdit** (`.rtf`) n'est pas accepté : exportez-le d'abord en PDF (voir « [Problèmes fréquents](#problèmes-fréquents) »).
- **Un navigateur** : Safari, Chrome ou Firefox.

### Le Terminal et les touches du Mac

Le **Terminal** est une application de macOS dans laquelle on tape des commandes. Pour l'ouvrir : **⌘ + Espace** (la recherche Spotlight s'ouvre), tapez `Terminal`, puis Entrée. Autre chemin : Finder › Applications › Utilitaires › Terminal.

Une fenêtre s'ouvre avec une ligne de ce genre :

```
marie@MacBook-Air ~ %
```

C'est l'**invite**. `~` veut dire que vous êtes dans votre dossier personnel ; `%` veut dire que le Terminal attend une commande. Pour lancer une commande de ce guide : copiez-la (⌘C), collez-la dans le Terminal (⌘V), puis appuyez sur Entrée. La commande est terminée quand l'invite `%` réapparaît.

| Pour… | Sur Mac |
|---|---|
| Copier, coller | ⌘C, ⌘V (touche commande ⌘) |
| Tout sélectionner | ⌘A |
| Effacer | touche ⌫ (delete) : le clavier du Mac n'a pas de touche « Suppr » |
| **Arrêter JobScout** dans le Terminal | **control + C (⌃C)**, avec la touche control ⌃. Pas ⌘C, qui ne fait que copier. |
| Ouvrir une application | ⌘ + Espace, tapez son nom, Entrée |
| Ouvrir votre dossier personnel dans le Finder | Maj + ⌘ + H (menu Aller › Départ) |
| Aller à un dossier précis, même caché, dans le Finder | Maj + ⌘ + G (menu Aller › Aller au dossier) |

Le [guide de l'IA](GUIDE-IA.md) montre les gestes de Windows, mais signale chaque différence par « Sur Mac » et décrit pas à pas Ollama ([étapes M1 à M7](GUIDE-IA.md#sur-mac--ollama-de-bout-en-bout)) et [LM Studio](GUIDE-IA.md#sur-mac--lm-studio) sur Mac. Ailleurs dans ce guide : « PowerShell » se lit « Terminal », « Ctrl + V » se lit ⌘V, « Ctrl + A » se lit ⌘A, « Suppr » se lit ⌫, et « menu Démarrer » se lit ⌘ + Espace.

## Étape 1 — Installer Node.js

Node.js est le moteur qui fait tourner JobScout. Sur Mac, on l'installe avec l'installeur officiel, un fichier `.pkg`, comme un logiciel ordinaire. Le même fichier sert aux Mac à puce Apple et aux Mac Intel.

1. Dans Safari, ouvrez **https://nodejs.org/dist/latest-v24.x/**. Une liste de fichiers s'affiche. Cliquez sur celui qui se termine par **`.pkg`** (par exemple `node-v24.21.0.pkg`), vers le bas de la liste. Ne prenez pas les fichiers qui se terminent par `.tar.gz` ou `.tar.xz`, même si leur nom contient `darwin-arm64` : ce sont des archives, pas l'installeur. Le fichier `.pkg` arrive dans votre dossier Téléchargements.
   - **macOS 11 à 13.4** : ouvrez plutôt **https://nodejs.org/dist/latest-v22.x/** et prenez le fichier `.pkg` de Node 22.
   - Pourquoi pas le gros bouton de la page d'accueil de nodejs.org ? Node 26 devient la version LTS le 28 octobre 2026 : ce bouton proposera alors probablement Node 26. Les tests automatiques de JobScout passent avec Node 26, mais le parcours de ce guide a été vérifié avec Node 24 : prenez la version 24.
2. Ouvrez le Finder › Téléchargements et double-cliquez sur le fichier `.pkg`. L'installeur de macOS s'ouvre.
3. Cliquez sur **Continuer** sur l'écran de présentation, puis sur l'écran de licence, et acceptez la licence (**Accepter**).
4. Cliquez sur **Installer**. macOS demande le **mot de passe de votre session** (ou votre empreinte Touch ID). C'est normal : Node.js s'installe pour tout le Mac.
5. Attendez la fin, puis cliquez sur **Fermer**. Le dernier écran parle de `/usr/local/bin` : vous n'avez rien à faire.

Ce guide n'utilise pas Homebrew : inutile de l'installer.

**Vérifier** : ouvrez le Terminal (⌘ + Espace, `Terminal`, Entrée) et tapez ces deux commandes, une à la fois, avec Entrée après chacune :

```bash
node -v
npm -v
```

C'est réussi si la première réponse commence par `v24.` (par exemple `v24.21.0`), ou par `v22.` à partir de `v22.13.0` si vous avez pris Node 22, et si la seconde affiche un numéro de version. Si le Terminal répond `zsh: command not found: node`, l'installation n'est pas allée au bout : recommencez l'étape 1.

> **En vidéo** : la vérification est montrée à [0:33 du tutoriel 1](https://youtu.be/cIh4PSmPlKE?t=33), dans une fenêtre Windows ; sur Mac, la commande `node --version` (identique à `node -v`) se tape dans le Terminal. Ignorez le passage juste avant (0:26 à 0:33) : c'est l'installeur Windows.

## Étape 2 — Récupérer JobScout

JobScout doit finir dans un dossier nommé `jobscout`, **directement dans votre dossier personnel** : `/Users/marie/jobscout` pour une utilisatrice « marie ». Le Terminal l'abrège en `~/jobscout`.

> **Pas dans Documents, ni sur le Bureau, ni dans Téléchargements, ni dans iCloud Drive.** macOS protège Documents, le Bureau et Téléchargements : le Terminal doit demander la permission d'y entrer, et un refus bloque l'installation. De plus, si iCloud synchronise votre Bureau et vos Documents (option « Dossiers Bureau et Documents » d'iCloud Drive), ces dossiers sont stockés dans iCloud Drive : votre base JobScout, qui contient vos clés API en clair, et des milliers de fichiers techniques y seraient copiés. Votre dossier personnel n'a aucun de ces problèmes.

**Option B, recommandée : le fichier ZIP (sans Git)**

1. Dans Safari, ouvrez la [page GitHub de JobScout](https://github.com/latenightsbeats1208-pixel/jobscout). Cliquez sur le bouton vert **Code**, puis **Download ZIP**.
2. Ouvrez le Finder › **Téléchargements**. Vous y trouvez :
   - soit un **dossier `jobscout-main`** : Safari a décompressé le fichier tout seul ;
   - soit un **fichier `jobscout-main.zip`** (avec Chrome ou Firefox, ou selon les réglages de Safari) : double-cliquez dessus, un dossier `jobscout-main` apparaît à côté.
3. Ouvrez le dossier `jobscout-main`. Vous devez y voir directement `package.json`, `README.md` et des dossiers comme `app` et `lib`. Vous n'y voyez qu'un autre dossier `jobscout-main` ? C'est ce dossier intérieur qu'il faut utiliser pour la suite.
4. **Renommez-le** : cliquez une fois sur le dossier `jobscout-main`, appuyez sur Entrée, tapez `jobscout`, puis Entrée.
5. **Déplacez-le dans votre dossier personnel** : ouvrez une nouvelle fenêtre du Finder (⌘N), puis menu **Aller › Départ** (Maj + ⌘ + H). Votre dossier personnel s'affiche : il porte le nom de votre compte (par exemple `marie`) et une icône de maison. Glissez le dossier `jobscout` depuis Téléchargements dans cette fenêtre.

C'est réussi si votre dossier personnel contient un dossier `jobscout`, et si Téléchargements ne le contient plus.

> **En vidéo** : le bouton Code › Download ZIP est montré à [0:46 du tutoriel 1](https://youtu.be/cIh4PSmPlKE?t=46). Arrêtez-vous à 0:50 : la suite montre l'Explorateur de Windows et PowerShell, qui n'existent pas sur Mac.

**Option A, avec Git** (si vous en avez l'habitude)

Ouvrez le Terminal : il s'ouvre dans votre dossier personnel. Tapez :

```bash
git clone https://github.com/latenightsbeats1208-pixel/jobscout.git
```

Le dossier `~/jobscout` est créé directement au bon endroit.

Sur un Mac où Git n'a jamais servi, macOS ouvre d'abord une fenêtre qui propose d'installer les **outils de développement en ligne de commande** d'Apple, dont Git fait partie. Cliquez sur **Installer**, acceptez la licence, attendez la fin du téléchargement (durée non mesurée), cliquez sur **Terminé**, puis retapez la commande `git clone`. Inutile d'installer l'application Xcode complète. Si vous annulez cette fenêtre, `git clone` échoue : prenez alors l'option B (ZIP).

> **En vidéo** : les commandes Git sont montrées à [0:39 du tutoriel 1](https://youtu.be/cIh4PSmPlKE?t=39), dans PowerShell ; elles sont identiques sur Mac, mais la vidéo ne montre pas la fenêtre des outils de développement.

## Ouvrir le Terminal dans le dossier jobscout

Les étapes 3 et 4 se font dans le Terminal, **dans le dossier `jobscout`**.

1. Ouvrez le Terminal (⌘ + Espace, `Terminal`, Entrée).
2. Tapez cette commande, puis Entrée :

   ```bash
   cd ~/jobscout
   ```

   Le caractère `~` est difficile à trouver sur votre clavier ? Copiez la commande depuis ce guide (⌘C) et collez-la (⌘V), ou utilisez la méthode du glisser-déposer ci-dessous.
3. Vérifiez : l'invite affiche maintenant `jobscout`, par exemple `marie@MacBook-Air jobscout %`. Tapez `ls` puis Entrée : vous devez voir `package.json` et `README.md` dans la liste.

**Autre méthode, sans rien taper du chemin** : dans le Terminal, tapez `cd` suivi d'une espace, **sans appuyer sur Entrée**. Puis glissez le dossier `jobscout` depuis le Finder jusque dans la fenêtre du Terminal : son chemin complet s'inscrit (par exemple `/Users/marie/jobscout`). Appuyez alors sur Entrée.

Une fenêtre de macOS demande si le Terminal peut accéder à vos fichiers de Documents, du Bureau ou de Téléchargements ? C'est que le dossier `jobscout` n'est pas à sa place : revoyez l'étape 2, point 5. Dans cette fenêtre, cliquez sur le bouton qui accepte l'accès (selon votre version de macOS, il peut s'appeler **OK** ou **Autoriser**) : un refus serait mémorisé. Puis déplacez le dossier et recommencez.

## Étape 3 — Installer les dépendances

Toujours dans le dossier `jobscout` :

```bash
npm ci
```

Si vous comptez vous éloigner du Mac pendant l'installation, tapez plutôt `caffeinate -i npm ci` : le Mac ne se mettra pas en veille tant que l'installation tourne.

npm télécharge environ 330 paquets, dont les versions faites pour Mac (puce Apple ou Intel). Il n'a rien à compiler : ni Xcode ni les outils de développement d'Apple ne sont nécessaires. **Laissez tourner** jusqu'au retour de l'invite `%`. Comptez environ 1 minute chez vous (17 à 45 s sur les Mac de test de GitHub, dont la connexion est très rapide), davantage sur une connexion lente.

C'est réussi si vous voyez une ligne du type `added 329 packages` (le nombre exact peut varier un peu), puis, quelques lignes plus bas, l'invite `%`.

Ces messages sont **normaux** et sans conséquence :

- `npm warn deprecated node-domexception@1.0.0` : une dépendance indirecte obsolète, sans effet.
- `… packages are looking for funding` : de simples appels aux dons.
- Un message indiquant que des scripts d'installation ont été ignorés ou bloqués (npm récent). Il peut citer `tesseract.js` et, sur Mac, `fsevents` : JobScout n'en a pas besoin.
- Un bilan de vulnérabilités, par exemple `5 high severity vulnerabilities`, suivi de `npm audit fix --force` : c'est attendu, elles concernent des outils de développement. Ne lancez pas cette commande (voir ci-dessous).
- `npm notice New major version of npm available` : vous pouvez l'ignorer.

**Ne lancez pas `npm audit fix --force`** : cette commande remplacerait Tailwind CSS 3 par la version 4, incompatible, et casserait l'application. **Ne tapez jamais `sudo` devant une commande `npm`** : ce n'est pas nécessaire, et cela crée ensuite des erreurs de permissions.

> **En vidéo** : cette étape est montrée [à partir de 0:59 du tutoriel 1](https://youtu.be/cIh4PSmPlKE?t=59), avec les messages normaux [à 1:05](https://youtu.be/cIh4PSmPlKE?t=65). Ignorez l'encart orange « npm.cmd » : il ne concerne que Windows.

## Étape 4 — Lancer JobScout

Toujours dans le dossier `jobscout` :

```bash
caffeinate -i npm run dev
```

`caffeinate -i` garde le Mac éveillé tant que JobScout tourne, ce qui protège les scans de la mise en veille. `npm run dev` tout seul, comme dans la vidéo, démarre JobScout de la même façon, mais sans cette protection.

Attendez la ligne `✓ Ready in …`, puis ouvrez **http://127.0.0.1:3000** dans Safari ou Chrome. Tapez l'adresse en entier, avec `http://` au début. C'est réussi si JobScout s'affiche, avec l'assistant de premier réglage.

- **Laissez la fenêtre du Terminal ouverte** tant que vous utilisez JobScout : l'invite `%` ne revient pas, c'est normal, JobScout tourne. Vous pouvez réduire la fenêtre (bouton jaune, ou ⌘M).
- **Pour arrêter JobScout** : cliquez dans la fenêtre du Terminal, puis **control + C (⌃C)**. Pas ⌘C, qui copie sans rien arrêter. Si vous fermez la fenêtre à la place, le Terminal demande en général de confirmer l'arrêt du programme en cours : confirmer arrête JobScout.
- Un message `ExperimentalWarning: SQLite is an experimental feature` peut s'afficher : c'est normal.
- La toute première ouverture d'une page prend quelques secondes (elle se prépare), les suivantes sont instantanées.
- JobScout n'est accessible que depuis votre Mac (adresse `127.0.0.1`), jamais depuis le réseau. Si macOS demande d'autoriser « node » à accepter des connexions entrantes, vous pouvez refuser : JobScout n'en a pas besoin.

Pour ne plus taper ces commandes chaque jour, créez le [lanceur Mac](#le-lanceur-mac) une fois l'installation terminée.

> **En vidéo** : le lancement et l'adresse sont montrés à [1:18 du tutoriel 1](https://youtu.be/cIh4PSmPlKE?t=78), le terminal à garder ouvert à [1:34](https://youtu.be/cIh4PSmPlKE?t=94). Le « Ctrl + C » de la vidéo est, sur Mac, la touche control (⌃), pas ⌘.

## Étape 5 — Premier réglage

Comptez 5 à 10 minutes (durée relevée sous Windows). Tout se passe dans le navigateur, exactement comme sous Windows. L'assistant s'ouvre tout seul, en trois étapes : **Importer**, **Vérifier**, **Préférences**.

> **En vidéo** : cette étape est montrée en entier dans le [tutoriel 2 — Mise en place](https://youtu.be/gOMQkcsD6LA), valable sur Mac ; la carte Génération IA commence [à 0:11](https://youtu.be/gOMQkcsD6LA?t=11). Ignorez la petite note PowerShell du début (vers 0:05 à 0:11).

> **Pas encore de clé, ou envie d'une IA gratuite sur votre Mac ?** Le [guide de l'IA](GUIDE-IA.md) explique comment créer une clé ou installer une IA locale, puis comment la brancher dans JobScout. Pour une IA locale, lisez aussi « [Une IA locale sur Mac](#une-ia-locale-sur-mac) » ci-dessous.

1. **Génération IA** : choisissez votre **fournisseur**, collez votre clé avec **⌘V** (aucune pour Ollama ou LM Studio), puis **Charger la liste** pour choisir le modèle de rédaction et le modèle de relecture (les valeurs proposées conviennent en général). Cliquez sur **Vérifier**, puis **Enregistrer**. La clé est enregistrée dans la base locale, sur votre Mac. Pour un modèle local, lancez d'abord Ollama ou le serveur de LM Studio.
2. **Importer** : glissez votre CV depuis le Finder. L'IA en extrait votre profil (expériences, compétences, langues…). Comptez de quelques secondes à une minute. Un fichier grisé dans la fenêtre de choix n'est pas dans un format accepté : voir « [Problèmes fréquents](#problèmes-fréquents) ».
3. **Vérifier** : relisez le profil extrait et corrigez ce qui doit l'être. JobScout ne rédigera jamais une compétence absente de ce profil : c'est le moment d'être complet.
4. **Préférences** : pays visés, types de contrat, secteurs, et les sources à scanner.

**Dossier des documents** : les CV et lettres générés vont par défaut dans `/Users/marie/jobscout/data/documents` (la vidéo, tournée sous Windows, affiche un chemin en `C:\`). Le plus simple est de garder ce dossier. Pour en choisir un autre, dans **Profil › Dossier des documents**, tapez son chemin complet, qui commence par `/Users/…` ou par `~/` (par exemple `~/JobScout-documents`), puis cliquez sur **Enregistrer**. Le bouton **Vérifier** teste le dossier sans l'enregistrer. Le bouton « Parcourir… » n'apparaît que dans Chrome et Edge : dans Safari et Firefox, il est absent, c'est normal. Un dossier dans Documents ou sur le Bureau fonctionne aussi, mais macOS peut demander si le Terminal y a accès (acceptez), et si iCloud synchronise ces dossiers, vos CV y seront copiés.

**LinkedIn (facultatif)** : c'est la seule source qui a besoin d'un petit navigateur intégré, et il demande **macOS 12 ou plus récent**. Pour l'activer : cochez **LinkedIn** dans **Profil › Recherche › Sources** : un encadré « Moteur LinkedIn requis » apparaît sous les sources, avec le bouton **Installer le moteur LinkedIn**. Environ 100 Mo à télécharger (96,5 Mo pour une puce Apple, 101,3 Mo pour un Mac Intel), environ 210 Mo sur le disque (206 Mo mesurés sur puce Apple, 208 Mo sur Intel) ; comptez 6 s sur puce Apple et 10 s sur Intel sur les Mac de test de GitHub (connexion de centre de données, mesuré le 08/10/2026) ; chez vous, 1 à 2 minutes (mesuré sous Windows). Le moteur se range dans `jobscout/data/browsers`.

### Une IA locale sur Mac

Une IA locale fait tourner le modèle sur votre Mac : gratuit, et votre CV ne sort pas de l'ordinateur. Elle demande **macOS 14 Sonoma ou plus récent**. Pour un Mac plus ancien, prenez une IA en ligne ([guide de l'IA, section 2](GUIDE-IA.md#2-option-a--une-clé-payante-claude-recommandé)).

**Votre Mac suit-il ?** Menu Pomme › **À propos de ce Mac** : lisez les lignes « Puce » (ou « Processeur ») et « Mémoire ». Repères approximatifs, pas des chiffres officiels :

| Votre Mac | Conseil |
|---|---|
| Puce Apple, 32 Go de mémoire ou plus | les modèles par défaut de JobScout |
| Puce Apple, 16 à 24 Go | essayez les modèles par défaut, puis vérifiez la vitesse (guide de l'IA, « [Si c'est lent](GUIDE-IA.md#si-cest-lent--vérifier-où-tourne-le-modèle) ») ; trop lent : `qwen3.5:4b` pour les deux rôles |
| Puce Apple, 8 Go | `qwen3.5:4b` pour les deux rôles, ou une IA en ligne |
| Mac Intel | une IA en ligne : sur un Mac Intel, Ollama tourne sur le processeur seul, c'est lent ; LM Studio n'existe pas pour Intel |

Détail : [étape M1 du guide de l'IA](GUIDE-IA.md#étape-m1--vérifier-votre-mac).

**Ollama** : suivez pas à pas « [Sur Mac : Ollama de bout en bout](GUIDE-IA.md#sur-mac--ollama-de-bout-en-bout) » dans le guide de l'IA (étapes M1 à M7). En résumé :

1. Sur [ollama.com/download/mac](https://ollama.com/download/mac), cliquez sur le petit lien souligné **Download manually**, à droite sous la commande `curl` : le fichier `Ollama.dmg` (environ 207 Mo) se télécharge. Ne copiez pas la commande `curl`.
2. Ouvrez le `.dmg` et glissez **Ollama** dans le dossier **Applications**. Ouvrez-le depuis Applications et confirmez l'ouverture d'une application téléchargée sur Internet.
3. Au premier lancement, acceptez qu'Ollama installe sa commande `ollama` : il demande le mot de passe de votre session.
4. Les écrans sont les mêmes que sous Windows : refusez le compte et les modèles « cloud » ([étape M3](GUIDE-IA.md#étape-m3--le-premier-écran-sur-mac) du guide de l'IA). L'icône d'Ollama est dans la **barre des menus, en haut à droite** de l'écran, et non près de l'horloge en bas.
5. Ouvrez une **nouvelle** fenêtre du Terminal (cliquez dans le Terminal, puis ⌘N), pas celle où tourne JobScout, et téléchargez-y les modèles avec les commandes `ollama pull …` ([étape M5](GUIDE-IA.md#étape-m5--télécharger-les-modèles-dans-terminal)). Tapées dans la fenêtre de JobScout, ces commandes ne feraient rien.
6. Contexte : dans les réglages d'Ollama (**Settings**), placez le curseur **Context length** sur **16k**. Si ce réglage reste inaccessible, méthode de secours : tapez dans une nouvelle fenêtre du Terminal (⌘N) `launchctl setenv OLLAMA_CONTEXT_LENGTH 16384`, puis quittez Ollama et relancez-le depuis Applications (on ne sait pas si ce réglage de secours survit à un redémarrage du Mac). Détail : [étape M6](GUIDE-IA.md#étape-m6--régler-le-contexte-à-16k-sur-mac).
7. Avant d'utiliser JobScout, vérifiez qu'Ollama tourne : l'adresse http://127.0.0.1:11434 doit afficher « Ollama is running » ([étape M4](GUIDE-IA.md#étape-m4--vérifier-quollama-tourne-sur-mac)). Sinon, ouvrez Ollama (⌘ + Espace, `Ollama`, Entrée).

**LM Studio** ([guide de l'IA, « Sur Mac : LM Studio »](GUIDE-IA.md#sur-mac--lm-studio)) : **puce Apple et macOS 14 obligatoires**, 16 Go de mémoire recommandés ; les Mac Intel ne sont pas pris en charge. Sur Mac, l'onglet Discover s'ouvre avec ⌘2 ; prenez la version **GGUF** (Q4_K_M) plutôt que MLX, non testée avec JobScout. Le serveur se démarre comme sous Windows : onglet **Developer** › **Start server**.

## Étape 6 — Premier scan

> **En vidéo** : le scan, les filtres, les documents et le suivi des candidatures sont montrés dans le [tutoriel 3 — Utilisation, à partir de 0:10](https://youtu.be/45uLxsWXXLQ?t=10), valable sur Mac. La scène d'avant (0:05 à 0:11) relance JobScout dans PowerShell : sur Mac, voir « [Au quotidien](#au-quotidien) ».

Avant un long scan, gardez le Mac éveillé. Si vous avez lancé JobScout sans `caffeinate`, arrêtez-le (⌃C) et relancez-le avec :

```bash
caffeinate -i npm run dev
```

(Avec le [lanceur Mac](#le-lanceur-mac), c'est déjà fait.) Sur un portable, laissez le capot ouvert.

Page **Offres** › **Lancer un scan**. JobScout interroge chaque source, puis note chaque offre selon votre profil. Ce tri est fait sur votre Mac, sans IA ni coût.

- Durée : **1 à 3 minutes** avec France Travail seule (réglage par défaut, estimation) ; **10 à 20 minutes** si vous activez d'autres sources, selon le nombre de pays (mesuré sous Windows) ; environ deux fois moins sans LinkedIn.
- Gardez la page du scan ouverte : elle reste bloquée jusqu'à la fin. Vous pouvez utiliser le reste du Mac pendant ce temps ; laissez le Terminal ouvert.
- Une source indisponible (site en panne, protection anti-robot) est signalée dans le journal du scan ; les autres continuent.

Pour ne garder que les offres proches de chez vous, cliquez sur **Définir ma ville** dans les filtres, puis choisissez un rayon dans le menu **Toutes distances** (de « Dans ma ville » à « Jusqu'à 200 km »). Les distances sont calculées sur votre Mac, sans rien envoyer.

Ensuite, sur la fiche d'une offre, **Générer les documents** produit un CV et une lettre d'une page (PDF et Word), en français, ou en anglais si l'annonce est en anglais (une annonce dans une autre langue donne des documents en français). C'est la seule étape (avec l'import du CV) qui utilise l'IA : 0,12 à 0,20 $ par dossier avec Claude, selon les tarifs du fournisseur sinon, rien avec un modèle local. Comptez en général moins de deux minutes avec un modèle en ligne, davantage avec un modèle local.

Sur Mac, le dossier des documents s'ouvre dans le **Finder**. Les PDF s'ouvrent dans Aperçu, les fichiers Word dans Pages ou Word. L'export Excel des candidatures arrive dans Téléchargements et s'ouvre avec Numbers ou Excel.

## Le lanceur Mac

Une fois JobScout installé, vous pouvez créer un **lanceur** : un fichier à double-cliquer qui ouvre le Terminal, démarre JobScout en gardant le Mac éveillé (`caffeinate`), puis ouvre http://127.0.0.1:3000 dans votre navigateur dès que JobScout répond.

**Le créer** (une seule fois) : arrêtez JobScout s'il tourne (⌃C), puis, dans le Terminal, dans le dossier `jobscout` :

```bash
npm run shortcut:mac
```

C'est réussi si le Terminal affiche notamment :

```
Lanceur créé : /Users/marie/jobscout/JobScout.command
Copie sur le Bureau : /Users/marie/Desktop/JobScout.command
Double-cliquez sur « JobScout.command » sur le Bureau (le Finder peut l'afficher « JobScout ») pour démarrer JobScout.
```

- macOS peut demander si le Terminal a le droit d'accéder à votre Bureau : acceptez. Si vous refusez, le Terminal affiche « Le Bureau n'est pas accessible… » : le lanceur existe quand même dans le dossier `jobscout` (fichier `JobScout.command`), glissez-le vous-même sur le Bureau.
- **Dans le Dock** : glissez le fichier **JobScout.command** du Bureau (le Finder peut l'afficher simplement « JobScout ») vers la partie droite du Dock, du côté de la Corbeille.

**L'utiliser** : double-cliquez sur **JobScout.command** (le Finder peut l'afficher simplement « JobScout »). Une fenêtre du Terminal s'ouvre et affiche « JobScout démarre… Gardez cette fenêtre ouverte : la fermer arrête JobScout. ». Le navigateur s'ouvre tout seul sur JobScout au bout de quelques secondes (le lanceur attend jusqu'à 2 minutes). Pour arrêter : ⌃C dans cette fenêtre.

- JobScout tourne déjà ? Inutile de double-cliquer à nouveau : ouvrez simplement http://127.0.0.1:3000.
- Le lanceur retient l'emplacement du dossier. Si vous déplacez ou renommez `jobscout`, il affiche « Dossier JobScout introuvable » : remettez le dossier à sa place, ou recréez le lanceur avec `npm run shortcut:mac`.
- Le lanceur est créé sur votre Mac, pas téléchargé : macOS ne devrait pas le bloquer. Si macOS refuse quand même de l'ouvrir, lancez JobScout par le Terminal (voir « Au quotidien ») ; vous pouvez aussi l'autoriser dans Réglages Système › Confidentialité et sécurité › **Ouvrir quand même**.

## Au quotidien

- **Relancer JobScout** : double-cliquez sur le lanceur. Sans lanceur : ouvrez le Terminal, tapez `cd ~/jobscout` puis `caffeinate -i npm run dev`, et ouvrez http://127.0.0.1:3000.
- **Arrêter JobScout** : dans le Terminal, **⌃C** (control + C), ou fermez la fenêtre et confirmez.
- **Mettre à jour** (vidéo : [1:40 du tutoriel 1](https://youtu.be/cIh4PSmPlKE?t=100)) : arrêtez d'abord JobScout (⌃C).
  - **Installé par ZIP** : dans le Finder, renommez l'ancien dossier `jobscout` en `jobscout-ancien`. Téléchargez le nouveau ZIP et placez le nouveau dossier comme à l'étape 2 (renommé `jobscout`, dans votre dossier personnel). Copiez le dossier `data` de `jobscout-ancien` dans le nouveau `jobscout` : dans le Finder, ouvrez `jobscout-ancien`, cliquez une fois sur le dossier `data`, puis ⌘C. Ouvrez le nouveau dossier `jobscout` et faites ⌘V : le dossier `data` y est copié, l'original reste dans `jobscout-ancien`. Puis, dans le Terminal : `cd ~/jobscout`, `npm ci`, et relancez JobScout. Quand tout fonctionne, vous pouvez mettre `jobscout-ancien` à la Corbeille. Le lanceur continue de marcher : le dossier garde le même nom et la même place.
  - **Installé avec Git** : dans le Terminal, `cd ~/jobscout`, puis `git pull`, puis `npm ci`, et relancez JobScout.
- **Sauvegarder vos données** : JobScout arrêté, copiez le dossier `jobscout/data` (base, documents générés), par exemple sur un disque externe. Il contient votre CV, vos candidatures et vos clés API en clair : gardez cette copie pour vous, hors d'un dossier synchronisé en ligne.
- **Désinstaller** :
  1. Arrêtez JobScout, et gardez une copie de `data` si vous voulez conserver vos candidatures.
  2. Mettez le dossier `jobscout` à la Corbeille. Le moteur LinkedIn, installé depuis l'application, part avec lui (il est dans `data/browsers`).
  3. Si vous aviez choisi un autre **dossier des documents** (Profil › Dossier des documents), mettez-le aussi à la Corbeille, ainsi que vos exports Excel des candidatures (dans Téléchargements). Détail : [politique de confidentialité, 9.2](CONFIDENTIALITE.md#92-tout-effacer).
  4. Mettez le lanceur du Bureau (`JobScout.command`, que le Finder peut afficher simplement « JobScout ») à la Corbeille, et retirez-le du Dock s'il y est.
  5. Si vous avez installé le moteur LinkedIn par la commande `npm run playwright:install`, il est ailleurs : Finder › Aller › **Aller au dossier** (Maj + ⌘ + G), tapez `~/Library/Caches/ms-playwright`, Entrée. Mettez ce dossier à la Corbeille, sauf si un autre logiciel s'en sert.
  6. **Node.js** : vous pouvez le garder, il ne tourne que quand on s'en sert. Il n'a pas de désinstalleur : ne tentez pas de l'effacer à la main avec `sudo`.
  7. **Ollama**, si vous l'aviez installé pour JobScout : suivez la [désinstallation complète du guide de l'IA](GUIDE-IA.md#lenteur-place-mise-à-jour-et-désinstallation-sur-mac). Mettre Ollama à la Corbeille ne suffit pas : ses modèles (plusieurs Go) restent dans le dossier caché `~/.ollama`.

## Problèmes fréquents

| Ce que vous voyez | Solution |
|---|---|
| `zsh: command not found: node` ou `zsh: command not found: npm` | Node.js n'est pas installé, ou l'installation n'est pas allée au bout. Refaites l'[étape 1](#étape-1--installer-nodejs), puis ouvrez une nouvelle fenêtre du Terminal (⌘N). |
| `zsh: command not found: ollama` | Au premier lancement, Ollama n'a pas pu installer sa commande (mot de passe annulé). Quittez Ollama (icône de lama dans la barre des menus › **Quit Ollama**), rouvrez-le depuis Applications et saisissez le mot de passe de votre session quand il le demande. Détail : [guide de l'IA, étape M5](GUIDE-IA.md#étape-m5--télécharger-les-modèles-dans-terminal). |
| `zsh: permission denied: /Users/marie/jobscout` | Le plus souvent, le dossier a été glissé (ou son chemin tapé) sans `cd` devant : le Terminal essaie alors de « lancer » le dossier. Tapez `cd` suivi d'une espace, puis glissez de nouveau le dossier, puis Entrée. |
| `cd: no such file or directory: /Users/marie/jobscout` | Le dossier n'est pas dans votre dossier personnel, ou il s'appelle encore `jobscout-main`. Revoyez l'[étape 2](#étape-2--récupérer-jobscout). |
| Une fenêtre demande si le Terminal peut accéder à vos fichiers de Documents, du Bureau ou de Téléchargements | Le dossier `jobscout` est dans un dossier protégé : déplacez-le dans votre dossier personnel (étape 2). Pour le lanceur ou un dossier de documents choisi exprès, acceptez. |
| Après `npm ci` : `npm error code EUSAGE` et « The `npm ci` command can only install with an existing package-lock.json ». Après `npm run dev` : `npm error enoent Could not read package.json` | Le Terminal n'est pas dans le dossier de JobScout. Tapez `cd ~/jobscout`, puis relancez la commande. |
| `Operation not permitted`, `EPERM`, ou `EACCES` / `permission denied` pendant `npm ci` | macOS ou les droits du dossier empêchent l'écriture. Vérifiez que le projet est bien dans `~/jobscout` (étape 2). Si vous aviez refusé l'accès au Terminal : Réglages Système › Confidentialité et sécurité › **Fichiers et dossiers** › Terminal, et activez le dossier concerné. N'utilisez jamais `sudo` devant `npm`. Si le message cite le dossier `.npm` et propose à la fin une commande `sudo chown …`, c'est le remède indiqué par npm : tapez-la telle quelle, puis relancez `npm ci`. |
| Une fenêtre propose d'installer les « outils de développement en ligne de commande » | Elle vient de Git (option A de l'étape 2). Cliquez sur **Installer**, ou prenez l'option B (ZIP), qui n'en a pas besoin. |
| `EBADENGINE` ou un message sur la version de Node | Votre Node.js est trop ancien : installez Node 24 (ou Node 22.13 ou plus sur macOS 11 à 13.4), [étape 1](#étape-1--installer-nodejs). |
| `Port 3000 is in use …, using available port 3001 instead.` | Un autre programme utilise ce port, souvent un JobScout déjà lancé dans une autre fenêtre du Terminal. JobScout prend alors le port suivant : ouvrez l'adresse indiquée, par exemple http://127.0.0.1:3001. Le lanceur, lui, ouvre toujours http://127.0.0.1:3000 : ouvrez l'adresse à la main. |
| ⌘C n'arrête pas JobScout | Sur Mac, on arrête un programme du Terminal avec **control + C (⌃C)**. ⌘C ne fait que copier. |
| La page ne s'ouvre pas | Vérifiez que le Terminal tourne toujours et affiche `Ready`. Tapez l'adresse complète, `http://127.0.0.1:3000`, avec `http://`. |
| Safari affiche un avertissement sur une connexion non sécurisée, ou refuse la page | Tapez l'adresse complète avec `http://`. Si Safari bloque encore, utilisez Chrome ou Firefox, ou désactivez dans Safari › Réglages › **Sécurité** l'avertissement avant les sites en HTTP. JobScout ne fonctionne qu'en `http://`, sur votre Mac seulement. |
| macOS demande d'autoriser « node » à accepter des connexions entrantes | Vous pouvez refuser : JobScout n'écoute que sur votre Mac. |
| Votre CV est grisé dans la fenêtre de choix, ou refusé | Formats acceptés : PDF, `.docx`, `.txt`, PNG, JPEG. CV **Pages** : dans Pages, Fichier › Exporter vers › PDF (ou Word). Photo **HEIC** (iPhone) : ouvrez-la dans Aperçu, Fichier › Exporter, format JPEG. Fichier **TextEdit** (`.rtf`) : exportez-le en PDF depuis le menu Fichier. |
| Pas de bouton « Parcourir… » dans Profil › Dossier des documents | Normal dans Safari et Firefox. Tapez le chemin complet du dossier (il commence par `/Users/…` ou par `~/`), ou gardez le dossier par défaut. |
| « Indiquez le chemin complet du dossier… » | Le chemin saisi n'est pas complet : il doit commencer par `/` ou par `~/`, par exemple `~/JobScout-documents`. Un chemin Windows (`C:\…`) ne marche pas sur Mac. |
| Vous avez recopié le dossier `data` d'un PC Windows, et les anciens documents affichent « Fichier manquant » | Les chemins enregistrés sous Windows ne valent pas sur Mac : ces anciens documents ne peuvent plus être ouverts depuis JobScout (recopiez-les à la main si vous en avez besoin). Si **Profil › Dossier des documents** affiche un bouton **Réinitialiser**, cliquez dessus : les documents générés ensuite iront dans le dossier par défaut. Sans ce bouton, il n'y a rien à faire. |
| `npm run shortcut:mac` répond « Lancez cette commande dans le dossier de JobScout, après « npm ci » » | Tapez `cd ~/jobscout`, faites l'[étape 3](#étape-3--installer-les-dépendances) si ce n'est pas fait, puis relancez la commande. |
| Le lanceur affiche « Dossier JobScout introuvable » | Le dossier `jobscout` a été déplacé ou renommé. Remettez-le dans votre dossier personnel, ou recréez le lanceur ([Le lanceur Mac](#le-lanceur-mac)). Appuyez sur une touche, puis fermez la fenêtre. |
| Le scan s'est arrêté en cours de route | Le Mac s'est probablement mis en veille (capot fermé, inactivité). Relancez le scan depuis la page Offres, avec `caffeinate -i npm run dev` ou le lanceur, capot ouvert. |
| LinkedIn ne renvoie rien | Installez le moteur LinkedIn (Profil › Recherche › Sources). Il demande macOS 12 ou plus récent. Si LinkedIn bloque temporairement, relancez le scan plus tard : les autres sources ne sont pas concernées. |
| La clé API est refusée, « Modèle introuvable », messages de l'IA locale | Voir le [guide de l'IA, section 6](GUIDE-IA.md#6-problèmes-fréquents). |
| `npm audit` signale des vulnérabilités | C'est attendu : elles concernent des outils de développement (Tailwind CSS), pas l'application (`npm audit --omit=dev` affiche 0). Ne lancez jamais `npm audit fix --force`. |

Une question, un bug ? Ouvrez une *issue* sur le [dépôt GitHub](https://github.com/latenightsbeats1208-pixel/jobscout/issues), en précisant votre version de macOS et votre puce (Apple ou Intel), sans jamais y coller votre CV ni une clé : les issues sont publiques.

## Les tutoriels vidéo sur Mac

Les trois tutoriels ont été **tournés sous Windows**. Tout ce qui se passe dans le navigateur est identique sur Mac. Ce qui se passe dans le système (installer Node.js, décompresser, ouvrir un terminal) ne l'est pas : là, suivez le texte de ce guide.

**[1. Installation](https://youtu.be/cIh4PSmPlKE)** : valable en partie.

| Passage | Sur Mac |
|---|---|
| [0:00 à 0:26](https://youtu.be/cIh4PSmPlKE?t=0) : prérequis, coût, CV | **Valable.** La vidéo ne donne pas de version de macOS : voir le [tableau des versions](#votre-version-de-macos). LM Studio n'existe que pour les Mac à puce Apple. |
| 0:26 à 0:33 : installer Node.js | **À ignorer** : c'est l'installeur Windows (`.msi`). Suivez l'[étape 1](#étape-1--installer-nodejs) (fichier `.pkg`). |
| [0:33 à 0:39](https://youtu.be/cIh4PSmPlKE?t=33) : vérifier Node.js | Même commande, mais dans le Terminal au lieu de PowerShell. |
| [0:39 à 0:46](https://youtu.be/cIh4PSmPlKE?t=39) : récupérer JobScout avec Git | Mêmes commandes. Sur un Mac où Git n'a jamais servi, macOS demande d'abord d'installer ses outils de développement ([étape 2](#étape-2--récupérer-jobscout), option A). |
| [0:46 à 0:50](https://youtu.be/cIh4PSmPlKE?t=46) : bouton Code › Download ZIP | **Valable tel quel.** |
| 0:50 à 0:59 : décompresser, ouvrir PowerShell dans le dossier | **À ignorer** : gestes de l'Explorateur de Windows et de PowerShell. Sur Mac : [étape 2](#étape-2--récupérer-jobscout), puis « [Ouvrir le Terminal dans le dossier jobscout](#ouvrir-le-terminal-dans-le-dossier-jobscout) ». |
| [0:59 à 1:57](https://youtu.be/cIh4PSmPlKE?t=59) : `npm ci`, messages normaux, `npm run dev`, adresse, assistant, terminal à garder ouvert, mise à jour | **Valable.** Ignorez l'encart orange « npm.cmd » (vers 1:00 à 1:12, puis 1:19 à 1:24) : il ne concerne que Windows. « Ctrl + C » se fait avec la touche control (⌃), pas ⌘. Repères : [messages normaux, 1:05](https://youtu.be/cIh4PSmPlKE?t=65) · [lancement, 1:18](https://youtu.be/cIh4PSmPlKE?t=78) · [assistant, 1:26](https://youtu.be/cIh4PSmPlKE?t=86) · [terminal ouvert, 1:34](https://youtu.be/cIh4PSmPlKE?t=94) · [mise à jour, 1:40](https://youtu.be/cIh4PSmPlKE?t=100). |

**[2. Mise en place](https://youtu.be/gOMQkcsD6LA)** : valable en entier, de 0:00 à 1:57, avec quelques réserves :

- ignorez la petite note PowerShell « npm.cmd » du début (vers 0:05 à 0:11) ;
- la clé se colle avec ⌘V ;
- [IA locale, à 0:39](https://youtu.be/gOMQkcsD6LA?t=39) : sur Mac, Ollama demande macOS 14, et LM Studio une puce Apple ;
- [page Profil, à 1:35](https://youtu.be/gOMQkcsD6LA?t=95) : le chemin affiché est un chemin Windows ; sur Mac, ce sera `/Users/<votre nom>/jobscout/data/documents`.

**[3. Utilisation](https://youtu.be/45uLxsWXXLQ?t=10)** : valable à partir de 0:10, jusqu'à la fin.

- La scène de 0:05 à 0:11 relance JobScout dans PowerShell, avec une note « npm.cmd » : sur Mac, voir « [Au quotidien](#au-quotidien) ».
- Pour garder l'ordinateur éveillé pendant le scan : `caffeinate`, et capot ouvert (voir « [Faut-il laisser le Mac allumé ?](#faut-il-laisser-le-mac-allumé-) »).
- À 1:14, le dossier des documents s'ouvre tout seul : sur Mac, c'est le Finder qui s'ouvre.

## Sources

Consultées le 8 octobre 2026.

- **Node.js** : versions de macOS prises en charge, [Node 22](https://github.com/nodejs/node/blob/v22.x/BUILDING.md) et [Node 24](https://github.com/nodejs/node/blob/v24.x/BUILDING.md) · [calendrier des versions](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json) · [installeur macOS (.pkg)](https://raw.githubusercontent.com/nodejs/node/main/tools/macos-installer/productbuild/distribution.xml.tmpl) · [fichiers de la version 24](https://nodejs.org/dist/latest-v24.x/)
- **Apple** : [ouvrir le Terminal](https://support.apple.com/guide/terminal/open-or-quit-terminal-apd5265185d-f365-44cb-8b09-71a064a42125/mac) · [glisser un élément dans le Terminal](https://support.apple.com/guide/terminal/drag-items-into-a-terminal-window-trml106/mac) · [raccourcis du Terminal](https://support.apple.com/guide/terminal/keyboard-shortcuts-trmlshtcts/mac) · [zsh, shell par défaut](https://support.apple.com/en-us/102360) · [outils de développement en ligne de commande](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools) · [accès aux fichiers et dossiers](https://support.apple.com/guide/mac-help/control-access-to-files-and-folders-on-mac-mchld5a35146/mac) · [Bureau et Documents dans iCloud Drive](https://support.apple.com/en-us/109344) · [réglages de suspension d'activité](https://support.apple.com/fr-fr/guide/mac-help/mchle41a6ccd/mac) · [suspension d'activité](https://support.apple.com/guide/mac-help/put-your-mac-to-sleep-or-wake-it-mh10330/mac) · [caffeinate (page de manuel)](https://keith.github.io/xcode-man-pages/caffeinate.8.html) · [téléchargements dans Safari](https://support.apple.com/guide/safari/download-items-from-the-web-sfri40598/mac) · [réglages de sécurité de Safari](https://support.apple.com/guide/safari/ibrw1074/mac) · [pare-feu](https://support.apple.com/guide/mac-help/block-connections-to-your-mac-with-a-firewall-mh34041/mac) · [format HEIF/HEIC](https://support.apple.com/en-us/116944)
- **Git** : [installer Git sur macOS](https://git-scm.com/install/mac)
- **Playwright** (moteur LinkedIn) : [navigateurs et emplacement du cache](https://playwright.dev/docs/browsers)
- **Ollama** : [Ollama sur macOS](https://docs.ollama.com/macos) · [longueur de contexte](https://docs.ollama.com/context-length)
- **LM Studio** : [configuration requise](https://lmstudio.ai/docs/app/system-requirements)
- **Code de JobScout** : `package-lock.json` (versions Mac des modules, puce Apple et Intel), `node_modules/playwright-core/browsers.json` (moteur LinkedIn : Chrome 147), `lib/paths.ts` et `lib/scrapers/browser-engine.ts` (emplacements des données et du moteur), `scripts/shortcut-mac.mjs` (lanceur Mac), `components/app/settings-folder.tsx` (dossier des documents).

En utilisant JobScout, vous acceptez ses [conditions d'utilisation](CGU.md). Vos données : [politique de confidentialité](CONFIDENTIALITE.md).
