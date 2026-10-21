# Politique de confidentialité de JobScout

**En vigueur le 21 octobre 2026** · JobScout 3.4.18

Cette politique explique ce que JobScout enregistre sur votre ordinateur, ce qui en sort, vers qui, et comment tout effacer. Les règles d'usage du logiciel sont dans les [conditions d'utilisation](CGU.md).

Elle décrit, au mieux de la connaissance de l'éditeur, le code de JobScout 3.4.18 tel qu'il est publié dans ce dépôt, y compris l'application JobScout pour Mac (`JobScout-Mac.dmg`) publiée sur sa page des versions. Elle ne couvre pas les copies modifiées ou redistribuées par d'autres personnes (voir les [conditions d'utilisation](CGU.md), section 3). Une version antérieure peut fonctionner autrement : jusqu'à la 3.4.12, par exemple, `npm run dev` laissait active la télémétrie de Next.js, et jusqu'à la 3.4.17, les modèles de lecture d'image s'enregistraient dans le dossier de lancement du serveur (section 3.2).

## 1. En bref

- **JobScout n'envoie rien à son éditeur.** Le logiciel tourne sur votre ordinateur. Par lui, l'éditeur ne reçoit, ne collecte et ne conserve aucune donnée vous concernant. Ce que vous publiez vous-même sur GitHub est un autre cas (section 11).
- **Rien ne remonte.** Pas de compte. Pas de serveur de l'éditeur. Pas de télémétrie JobScout, pas de mesure d'audience, pas de rapport de plantage, pas de cookie.
- **La télémétrie de Next.js est coupée.** Next.js est le cadre logiciel sur lequel JobScout est construit. Il envoie par défaut des statistiques d'usage anonymes, en développement et à la compilation. Depuis la 3.4.13, les scripts fournis pour ces deux usages les coupent (section 5).
- **Vos données restent sur votre disque.** Profil, texte du CV, offres, candidatures, documents et réglages sont rangés dans un dossier de votre ordinateur. Vos clés API y sont enregistrées **en clair**.
- **Des données sortent seulement quand vous agissez :**
  - à l'import d'un CV et à la génération de documents, elles vont au fournisseur d'IA que vous avez choisi : texte du CV, profil avec votre identité, offre visée. Avec un modèle local (Ollama, LM Studio) à son adresse par défaut, rien ne sort ;
  - pendant un scan, elles vont aux sites d'offres : vos secteurs, vos pays visés et votre adresse IP. Jamais votre nom ni votre CV ;
  - quelques téléchargements techniques, sans donnée personnelle : le moteur LinkedIn et les modèles de lecture d'image, si vous en avez besoin.
- **Une exception, au démarrage en version source.** Avec `npm run dev`, `Start-JobScout.ps1` ou le lanceur Mac `JobScout.command`, Next.js demande au registre npm, à chaque démarrage, s'il existe une version plus récente de lui-même. Le registre voit votre adresse IP, rien d'autre (section 4).
- **Vous gardez la main.** Pour tout effacer sur votre ordinateur, supprimez votre dossier de données. Supprimez ensuite les quelques éléments rangés ailleurs : le fichier `.env`, le dossier `.next/`, le dossier de documents si vous l'avez placé ailleurs, vos exports Excel (section 9). Ce que vous avez déjà envoyé à un fournisseur d'IA ou à un site d'offres reste chez lui.

## 2. Qui publie JobScout

- **Éditeur :** Late Nights Tools, pseudonyme d'un éditeur non professionnel. JobScout est un logiciel libre et gratuit, sous [licence MIT](LICENSE).
- **Hébergeur :** GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis (https://github.com).
- **Contact :** les [issues du dépôt](https://github.com/latenightsbeats1208-pixel/jobscout/issues). Elles sont publiques (voir la section 11).

## 3. Ce que JobScout enregistre sur votre ordinateur

### 3.1 Où

| Vous utilisez | Dossier de données |
|---|---|
| Le code source (clone Git ou ZIP), lancé avec `npm run dev`, `npm run start`, `scripts/Start-JobScout.ps1` ou le lanceur Mac `JobScout.command` (`npm run shortcut:mac`) | `data/` dans le dossier du projet, sauf si vous avez défini un autre emplacement (variables `JOBSCOUT_DATA_DIR`, `JOBSCOUT_DB_PATH` ou `JOBSCOUT_DOCS_PATH`, par exemple dans `.env`) |
| L'installeur Windows, si vous l'avez construit vous-même (`npm run package`) | `%LOCALAPPDATA%\JobScout`. Le menu « Dossier de données » de l'icône JobScout, près de l'horloge, l'ouvre directement |
| L'application JobScout pour Mac (`JobScout.app`, installée depuis `JobScout-Mac.dmg`) | `~/Library/Application Support/JobScout`, dans la Bibliothèque de votre dossier personnel, masquée par défaut dans le Finder. La commande « Dossier de données » du menu JobScout l'ouvre directement. Ce dossier n'est accessible qu'à votre compte macOS |

La base de données est le fichier `jobscout.db`, accompagné de `jobscout.db-wal` et `jobscout.db-shm`.

Avec l'installeur Windows et l'application Mac, ce dossier est séparé du programme : remplacer le programme n'y touche pas. Le supprimer non plus, sauf si, sous Windows, vous répondez Oui à la question posée à la fin de la désinstallation (section 9.2).

En version source, `npm run build` (nécessaire avant `npm run start`) recopie dans `.next/standalone/` le contenu de `data/` et le fichier `.env`, tels qu'ils sont au moment de la compilation. Cette copie peut donc contenir votre base, vos clés API comprises, et vos documents.

### 3.2 Quoi

- **Votre profil :** nom, e-mail, téléphone, ville, adresses LinkedIn et portfolio, résumé, expériences, formations, compétences, langues, secteurs et pays visés, sources et types de contrat choisis.
- **Le texte de votre CV.** JobScout garde le texte extrait, pas le fichier d'origine (PDF, Word, image…). Le fichier est lu, puis il n'est ni copié ni conservé. Chaque CV ajouté complète ce texte.
- **Les profils enregistrés :** les copies complètes de profil que vous sauvegardez dans « Profils enregistrés ».
- **Les offres collectées :** titre, entreprise, lieu, contrat, salaire, description, données brutes renvoyées par le site, score. Une offre peut contenir le nom ou les coordonnées d'un recruteur (voir la section 7).
- **Vos candidatures :** statut, notes, contact, échéance, et les lignes importées depuis un fichier Excel.
- **Les documents générés :** CV et lettres en PDF et DOCX, messages en texte. Le nom des fichiers contient votre prénom et votre nom. Ils sont rangés dans le sous-dossier `documents`, ou dans le dossier que vous avez choisi. Ce dossier doit se trouver dans votre dossier personnel ou dans le dossier de données.
- **Les réglages :** fournisseur d'IA, modèles, adresse du serveur pour un modèle local, dossier des documents. Et **vos clés API, en clair**, sans chiffrement.
- **La ville de référence du filtre par distance**, si vous en choisissez une dans la page Offres : seulement le code de la commune, pas d'adresse. La ville de votre profil vous est proposée, mais elle n'est enregistrée qu'après votre clic.
- **L'historique des scans :** date, statut et journal de chaque scan.
- **Le journal du serveur**, avec l'installeur Windows et l'application Mac : `logs/server.log`, dans le dossier de données. Sous Windows, il est réécrit à chaque démarrage. Sur Mac, le journal du démarrage précédent est gardé sous le nom `logs/server.previous.log`, puis remplacé au démarrage suivant : les deux derniers lancements restent donc sur le disque. Sur Mac, ces journaux ne sont lisibles que par votre compte. Ils peuvent contenir des extraits de vos documents (corrections de la relecture), des noms d'entreprises et de compétences, la quantité de texte traitée par l'IA (en « jetons ») et les erreurs. En version source, ces messages s'affichent dans le terminal : JobScout ne les enregistre pas dans un fichier.
- **Le moteur LinkedIn**, si vous l'installez : environ 100 Mo à télécharger, 265 Mo sur le disque. Le bouton « Installer le moteur LinkedIn » le range dans le sous-dossier `browsers`. `npm run playwright:install` le range dans le dossier commun de Playwright (`ms-playwright`). JobScout réutilise aussi ce dossier commun s'il y trouve déjà Chromium. L'application Mac exclut le sous-dossier `browsers` des sauvegardes Time Machine.
- **Les modèles de lecture d'image (OCR)**, si vous importez un CV au format image : `fra.traineddata` et `eng.traineddata`, dans le sous-dossier `ocr` du dossier de données, quelle que soit la façon dont vous utilisez JobScout. Jusqu'à la 3.4.17, ils étaient enregistrés dans le dossier depuis lequel le serveur était lancé : la racine du projet en version source, le dossier du programme avec l'installeur Windows.
- **L'état de l'application Mac pendant qu'elle tourne** : `runtime.json` (adresse locale, numéros de processus, version, heure de démarrage), effacé à l'arrêt, et `launcher.lock`, qui empêche d'ouvrir JobScout deux fois. Ils sont dans le dossier de données et ne contiennent aucune donnée sur vous. macOS peut aussi créer de lui-même un fichier de réglages de l'application, `~/Library/Preferences/fr.jobscout.app.plist`.
- **Le fichier `.env`**, si vous le créez en version source. Il peut contenir des identifiants France Travail ou une clé API de développement, en clair.
- **Dans votre navigateur :** le thème choisi, clair ou sombre. Pendant l'inscription, le profil extrait est gardé dans la session de l'onglet, puis effacé à la fin de l'étape « Préférences ».
- **Les exports Excel** de vos candidatures, si vous en téléchargez. Ils sont enregistrés là où votre navigateur range les téléchargements, en général le dossier Téléchargements.

JobScout ne crée ni compte ni cookie.

## 4. Ce qui sort de votre ordinateur, et vers qui

JobScout n'envoie rien de lui-même : chaque échange décrit ci-dessous suit une action de votre part. Il n'y a aucun scan automatique. Quand JobScout est fermé, il ne fait rien.

Il y a une exception. Si vous lancez JobScout depuis le code source avec `npm run dev`, ou avec le raccourci `scripts/Start-JobScout.ps1` ou le lanceur Mac `JobScout.command`, qui utilisent cette commande (c'est la méthode des guides d'installation), Next.js vérifie à chaque démarrage s'il existe une version plus récente de lui-même. Pour cela, il interroge le registre npm (`registry.npmjs.org`). Cette requête ne contient aucune donnée de JobScout ni aucune donnée sur vous, mais le registre voit votre adresse IP. `npm run start`, l'installeur Windows et l'application Mac ne font pas cette vérification.

**Le filtre par distance ne fait rien sortir.** La base des communes françaises et des villes du monde est incluse dans le logiciel. Les distances sont calculées sur votre ordinateur : ni votre ville de référence ni le lieu des offres ne sont envoyés à qui que ce soit. Ce filtre n'affiche aucune carte et ne charge aucune ressource extérieure.

### 4.1 Le fournisseur d'IA que vous choisissez

Vous choisissez un seul fournisseur à la fois parmi Anthropic (Claude), OpenAI, Google Gemini, Mistral AI, DeepSeek, Groq et OpenRouter. Vous pouvez aussi choisir un serveur compatible de votre choix (« Autre ») ou un modèle local (Ollama, LM Studio).

| Quand | Ce qui est envoyé |
|---|---|
| Import d'un CV (inscription ou « Ajouter un CV ») | Le texte complet extrait du CV, avec tout ce qu'il contient |
| Génération d'un CV | Votre profil complet, **identité comprise** (nom, e-mail, téléphone, ville, adresses LinkedIn et portfolio), et l'offre visée : titre, entreprise, pays, description (6 000 caractères au plus) |
| Génération d'une lettre | Nom, ville, résumé, expériences, formations, compétences, langues, et l'offre |
| Message V.I.E | Nom, formations, expériences, compétences, langues, et l'offre |
| Relecture et traduction | Les textes générés, avec le résumé factuel de votre profil (nom, ville, résumé, expériences, formations, compétences, langues). Pour une lettre, aussi le lieu de l'offre et votre ville. Pour un CV en anglais, la liste de vos compétences à traduire |
| Boutons « Vérifier » et « Charger la liste » | Votre clé seulement, pour obtenir la liste des modèles disponibles |

Chaque requête transmet aussi votre clé API, votre adresse IP et des en-têtes techniques. Avec Anthropic, la bibliothèque officielle ajoute le système d'exploitation, l'architecture de l'ordinateur et la version de Node.js. Avec OpenRouter, JobScout se présente sous le nom « JobScout », avec l'adresse de ce dépôt.

Le classement des offres est calculé sur votre ordinateur. Un scan n'envoie donc rien au fournisseur d'IA.

**Avec un modèle local** (Ollama ou LM Studio à leur adresse par défaut, `127.0.0.1`), rien ne sort de votre ordinateur. Si vous remplacez cette adresse par celle d'un autre ordinateur, vos données partent vers lui.

**Une fois reçues, vos données relèvent du fournisseur seul :** durée de conservation, usage éventuel pour entraîner ses modèles, pays de traitement (parfois hors de l'Union européenne). Lisez sa politique de confidentialité avant de lui confier votre CV. OpenRouter, de son côté, transmet votre requête au fournisseur du modèle que vous choisissez chez lui.

### 4.2 Les sites d'offres, pendant un scan

Un scan démarre seulement à votre demande, dans la page Offres :

- « Lancer un scan » interroge les sources cochées dans votre profil (ou, si votre profil n'en indique aucune, France Travail seule, le réglage par défaut) ;
- la flèche à côté ouvre le menu « Scanner une source ». Il interroge la seule source choisie, qu'elle soit cochée ou non.

Les sources suspendues (APEC, Civiweb) ne sont jamais interrogées, même si elles sont restées cochées dans un ancien profil.

**Ce qui est envoyé :**

- vos secteurs, utilisés comme mots-clés de recherche ;
- le pays visé, selon le site ;
- votre adresse IP ;
- des en-têtes techniques. Le plus souvent, JobScout se présente comme un navigateur Chrome ordinaire sous Windows, en français. Les exceptions : l'index de Welcome to the Jungle et l'API de France Travail, pour lesquels JobScout n'imite pas de navigateur.

**Rien d'autre :** ni votre nom, ni votre CV, ni votre e-mail, ni les cookies de votre propre navigateur. Aucun compte n'est utilisé, sauf vos identifiants d'API France Travail si vous les avez fournis (voir 4.3).

| Source | Serveur contacté | Cochée par défaut |
|---|---|---|
| Welcome to the Jungle | `csekhvms53-dsn.algolia.net` : l'index de recherche du site, hébergé chez Algolia | non : à activer vous-même |
| HelloWork | Si vous visez la France ou aucun pays précis : `www.hellowork.com` | non : à activer vous-même |
| France Travail | Si vous visez la France ou aucun pays précis : `candidat.francetravail.fr`, ou l'API officielle si vous avez fourni des identifiants (voir 4.3) | oui |
| Talent.com | Le site de chaque pays visé : `fr.talent.com`, `be.talent.com`, `ch.talent.com`, `lu.talent.com`, `ca.talent.com`, `www.talent.com` (États-Unis), `ma.talent.com`, `tn.talent.com` ou `sn.talent.com`. `fr.talent.com` si vous n'indiquez aucun pays. Aucun site Talent.com n'est contacté si aucun de vos pays n'est dans cette liste | non : à activer vous-même |
| LinkedIn | `www.linkedin.com`, pages publiques, sans compte | non : à cocher vous-même, puis le moteur doit être installé |
| APEC | aucun : source suspendue depuis la 3.4.13, le site bloquant les requêtes automatiques | non : suspendue |
| Civiweb (V.I.E) | aucun : source suspendue, Business France exigeant désormais une authentification | non : suspendue |

Une méthode mérite d'être connue : pour **Welcome to the Jungle**, si vous l'activez, JobScout interroge directement l'index de recherche du site. Il utilise la clé de recherche que le site emploie dans ses propres pages et indique `welcometothejungle.com` comme origine.

Ces en-têtes ne contiennent aucune donnée sur vous. Leur portée au regard des conditions des sites est traitée dans les [conditions d'utilisation](CGU.md), section 6.

**LinkedIn** est interrogé par un navigateur Chromium sans fenêtre, sans compte et sans profil enregistré. Les cookies que LinkedIn dépose pendant le scan restent en mémoire. Ils sont effacés à la fin du scan.

Chaque site voit votre adresse IP et vos requêtes, et les traite selon sa propre politique. Il peut aussi limiter ou bloquer l'accès.

### 4.3 France Travail : vos identifiants d'API

Ce cas se présente seulement si vous inscrivez `FT_CLIENT_ID` et `FT_CLIENT_SECRET` dans le fichier `.env`. JobScout envoie alors ces identifiants au serveur d'authentification de France Travail (`entreprise.francetravail.fr`) pour obtenir un jeton. Ce jeton est gardé en mémoire et sert à interroger `api.francetravail.io`. Les identifiants ne partent nulle part ailleurs. Si l'API ne renvoie aucune offre (identifiants refusés, erreur ou aucun résultat), JobScout charge alors les pages de `candidat.francetravail.fr`, comme sans identifiants.

### 4.4 Téléchargements techniques ponctuels

Ces téléchargements ne contiennent aucune donnée personnelle, mais le serveur contacté voit votre adresse IP.

- **Moteur LinkedIn :** quand vous cliquez sur « Installer le moteur LinkedIn » ou lancez `npm run playwright:install`. Le téléchargement fait environ 100 Mo (environ 265 Mo une fois installé) et vient des serveurs de Playwright (`cdn.playwright.dev`, `playwright.download.prss.microsoft.com`). Il n'a lieu qu'une fois.
- **Modèles OCR :** au premier import d'un CV au format image. Les modèles français et anglais viennent de `cdn.jsdelivr.net`. Ils sont ensuite gardés dans le sous-dossier `ocr` du dossier de données, et ne sont plus téléchargés tant que ce dossier existe. L'image de votre CV, elle, reste sur votre ordinateur.
- **Installation, en version source :** le code vient de GitHub. `npm ci` télécharge les dépendances depuis `registry.npmjs.org`, plus une archive depuis `cdn.sheetjs.com`.
- **Application Mac :** `JobScout-Mac.dmg` se télécharge depuis la page des versions du dépôt, chez GitHub. Le menu « Page des versions » de JobScout ouvre cette page dans votre navigateur, seulement quand vous le choisissez. L'application ne vérifie jamais d'elle-même s'il existe une nouvelle version.

Les outils qui servent à installer et lancer JobScout (Node.js, npm, Git) peuvent contacter leurs propres serveurs. Ils suivent alors leurs propres règles. De même, au premier lancement d'une application téléchargée, macOS peut la vérifier auprès d'Apple, selon les règles d'Apple.

### 4.5 Les liens que vous ouvrez

Quand vous ouvrez une annonce ou cliquez sur « Postuler », c'est votre navigateur habituel qui va sur le site, avec ses cookies, comme pour toute navigation. JobScout ne transmet pas l'adresse de la page d'où vous venez : les liens sont ouverts en `noopener noreferrer`. L'affichage d'une offre dans JobScout ne charge ni image ni ressource extérieure.

## 5. Ce que l'éditeur ne fait pas

- **Aucun serveur de l'éditeur.** Rien de ce que vous faites dans JobScout ne lui parvient.
- **Aucun suivi.** Ni télémétrie, ni mesure d'audience, ni rapport de plantage, ni publicité. L'interface ne charge aucune ressource extérieure : même les polices de caractères et la base géographique du filtre par distance sont incluses dans le logiciel.
- **Télémétrie de Next.js désactivée.** Next.js envoie par défaut des statistiques d'usage anonymes à son éditeur, Vercel. Depuis la 3.4.13, `npm run dev` et `npm run build` lancent Next.js avec `NEXT_TELEMETRY_DISABLED=1`, et `scripts/Start-JobScout.ps1` comme le lanceur Mac `JobScout.command` passent par `npm run dev`. `npm run start`, l'installeur Windows et l'application Mac n'ont pas besoin de ce réglage : Next.js n'envoie ces statistiques qu'en développement et à la compilation. L'application Mac lance quand même son serveur avec `NEXT_TELEMETRY_DISABLED=1`. Si vous lancez Next.js autrement, coupez-la vous-même : définissez la variable `NEXT_TELEMETRY_DISABLED=1`, ou lancez une fois `npx next telemetry disable`.
- **Aucun relais actif.** Le code contient deux fonctions réseau en sommeil : un relais d'IA et une vérification de mise à jour. Elles ne s'activent que si une adresse est fournie dans la variable `JOBSCOUT_PROXY_URL` ou `JOBSCOUT_UPDATE_URL`. La version publiée sur GitHub n'en fournit aucune : ces fonctions n'envoient donc rien. Si vous définissez ces variables vous-même, vos données partent vers l'adresse que vous avez choisie.
- **Aucune mise à jour automatique.** Vous mettez JobScout à jour vous-même, avec `git pull` ou un nouveau téléchargement. L'application Mac ne vérifie pas non plus l'existence d'une nouvelle version.
- **Aucune vente ni aucun partage.** Par le logiciel, l'éditeur ne détient aucune donnée : il n'a rien à vendre ni à partager.

## 6. JobScout et le RGPD

Le RGPD (règlement général sur la protection des données) est la loi européenne sur les données personnelles. Ce qui suit est la lecture de l'éditeur, pas un avis juridique.

- **Vous.** Le RGPD ne s'applique pas aux traitements faits par une personne pour une activité strictement personnelle ou domestique (article 2, paragraphe 2, point c). Une recherche d'emploi menée pour vous-même en relève très probablement, y compris pour les noms de recruteurs présents dans les offres que vous enregistrez. Si vous utilisez JobScout pour d'autres personnes ou dans un cadre professionnel, le RGPD peut s'appliquer à vous. Les [conditions d'utilisation](CGU.md) limitent d'ailleurs l'usage des offres collectées à votre propre recherche d'emploi (section 4).
- **L'éditeur, pour le logiciel.** Il fournit un logiciel, mais ne reçoit par lui aucune donnée et ne décide pas de ce qui en est fait. À son sens, il n'est donc, pour ce que fait JobScout, ni « responsable de traitement » (celui qui décide pourquoi et comment des données sont utilisées) ni « sous-traitant » (celui qui les traite pour le compte d'un autre).
- **L'éditeur, sur GitHub.** Ce que vous publiez sur le dépôt (issues, pull requests, commits) est un autre cas : l'éditeur le voit et peut le modérer. Voir les sections 10 et 11.
- **Les fournisseurs d'IA et les sites d'offres.** Ils traitent ce que vous leur envoyez (contenu des requêtes, adresse IP) sous leur propre responsabilité, selon leurs propres règles.

## 7. Les données des recruteurs

Une offre peut contenir le nom, l'e-mail ou le téléphone d'un recruteur. Vous pouvez aussi noter un contact dans une candidature.

- Utilisez ces informations **uniquement pour votre propre candidature**.
- N'en faites pas un fichier de contacts. Ne vous en servez pas pour de la prospection. Ne les publiez pas et ne les revendez pas.
- Quand vous générez des documents, le texte de l'offre part chez votre fournisseur d'IA (section 4.1), avec ces informations si l'offre en contient.
- JobScout ne supprime pas tout seul les offres anciennes, et cette version n'a pas de bouton pour effacer une offre. Quand votre recherche est terminée, effacez vos données (section 9). Une candidature, elle, peut être supprimée à tout moment.

## 8. Sécurité

**Vos clés API sont enregistrées en clair** dans la base locale. Toute personne ou tout programme capable de lire votre dossier de données peut les lire.

Ce que vous pouvez faire :

- Protégez votre session par un mot de passe et ne la prêtez pas.
- Chiffrez votre disque : BitLocker sous Windows, FileVault sous macOS, LUKS sous Linux.
- Ne partagez pas votre dossier de données. Évitez de placer le projet dans un dossier synchronisé avec un service de stockage en ligne (celui de Microsoft, Dropbox, iCloud Drive, Google Drive…), sinon votre base et vos clés y seraient copiées.
- Vos sauvegardes (Time Machine sur Mac, par exemple) copient aussi votre dossier de données, clés API comprises : chiffrez-les.
- Sur un ordinateur partagé entre plusieurs comptes, quittez JobScout quand vous ne vous en servez pas. Pendant qu'il tourne, un programme d'un autre compte ouvert en même temps peut joindre son adresse locale, qui ne demande pas de mot de passe.
- Ne publiez jamais vos clés. `data/`, `.next/` et `.env` sont exclus de Git par le fichier `.gitignore` : vérifiez-le avant de publier une copie du projet. Si vous la partagez autrement (archive ZIP, clé USB), retirez d'abord ces dossiers et ce fichier. Ne collez jamais de clé, de CV, de base de données ou d'extrait de journal dans une issue.
- Si votre fournisseur d'IA le permet, fixez un plafond de dépenses. Si une clé fuit, révoquez-la chez lui, puis cliquez sur « Réinitialiser » dans Profil › Paramètres et données › Génération IA.

Ce que fait JobScout pour limiter les risques :

- Le serveur n'écoute que sur votre ordinateur (`127.0.0.1`). Son API refuse les requêtes qui viennent d'un autre site ou d'un autre hôte.
- Une clé enregistrée n'est jamais renvoyée au navigateur : seuls ses 4 derniers caractères s'affichent.
- La clé ne part que vers l'adresse du fournisseur choisi. Le chiffrement `https` est obligatoire, sauf pour un serveur installé sur votre propre ordinateur.
- Les descriptions d'offres sont nettoyées avant affichage : ni script, ni image.

Ces protections réduisent les risques sans les supprimer. JobScout est fourni sans garantie (voir les [conditions d'utilisation](CGU.md), section 10).

## 9. Conservation et suppression

Vos données restent sur votre ordinateur tant que vous ne les supprimez pas. JobScout n'efface rien de lui-même, sauf quatre choses :

- le profil gardé dans l'onglet pendant l'inscription ;
- les cookies LinkedIn, à la fin de chaque scan ;
- le journal du serveur, réécrit à chaque démarrage (sur Mac, celui du démarrage précédent est gardé une fois, sous le nom `server.previous.log`) ;
- l'ancienne version d'un document, quand vous le régénérez pour la même offre, dans le même format.

### 9.1 Dans JobScout

| Pour effacer | Faites ceci |
|---|---|
| Une candidature | Page Candidatures : « Modifier » (« Modifier le suivi » sur petit écran), puis « Supprimer », et confirmez |
| Un profil enregistré | Profil › Profils enregistrés : l'icône de suppression à droite du profil, puis « Confirmer » |
| Votre ville de référence (filtre par distance) | Page Offres : bouton « Autour de … », puis « Retirer ma ville » |
| Vos clés API | Profil › Paramètres et données › Génération IA : « Réinitialiser ». Toutes les clés enregistrées sont vidées et la génération IA est désactivée. En version source, une `ANTHROPIC_API_KEY` inscrite dans `.env` reste utilisée avec `npm run dev` : retirez-la aussi du fichier |
| Votre profil actuel | Profil : « Remplacer le profil », puis importez un autre CV. L'ancien profil est remplacé, mais ses copies dans « Profils enregistrés » restent |
| Vos documents | Pas de bouton dédié : cliquez sur « Ouvrir le dossier » (Profil › Paramètres et données › Dossier des documents), puis supprimez les fichiers |
| Les offres | Pas de bouton dans cette version : effacez tout (voir 9.2) |

Une valeur effacée peut laisser une trace technique dans le fichier de la base jusqu'à ce que cet espace soit réécrit. Pour un effacement sûr, supprimez la base.

### 9.2 Tout effacer

**Version source**

1. Arrêtez JobScout : Ctrl+C dans la fenêtre du terminal où il tourne (sur Mac : touche control + C, pas ⌘). Avec `Start-JobScout.ps1`, cette fenêtre est réduite dans la barre des tâches. Sur Mac, supprimez aussi le lanceur `JobScout.command` du Bureau si vous l'avez créé.
2. Supprimez le dossier `data/` du projet. Il contient la base, les documents, les modèles OCR et, si vous l'avez installé avec le bouton de JobScout, le moteur LinkedIn.
3. Supprimez aussi, s'ils existent :
   - le dossier `.next/` du projet, si vous avez lancé `npm run build`. Il peut contenir une copie de votre base, de vos documents et de votre fichier `.env` ;
   - le fichier `.env` ;
   - `fra.traineddata` et `eng.traineddata`, à la racine du projet, si vous avez importé un CV au format image avec une version antérieure à la 3.4.18 ;
   - le dossier de documents, si vous en aviez choisi un autre ;
   - vos exports Excel.
4. Vous pouvez aussi supprimer tout le dossier du projet.

Si le moteur LinkedIn se trouve dans le dossier commun `ms-playwright`, ce dossier peut servir à d'autres logiciels. Ne le supprimez que si vous êtes sûr qu'il ne sert plus.

**Installeur Windows (si vous l'avez construit)**

1. Quittez JobScout : icône près de l'horloge › « Quitter JobScout ».
2. Désinstallez JobScout dans Paramètres › Applications. À la fin, l'assistant demande s'il faut aussi supprimer vos données : répondez **Oui**.
3. Si vous avez répondu Non, le choix proposé par défaut, vos données restent sur le disque, **clés API en clair comprises**. Supprimez vous-même le dossier `%LOCALAPPDATA%\JobScout` dès que vous n'en avez plus besoin.
4. Supprimez aussi :
   - le dossier de documents, si vous en aviez choisi un autre ;
   - vos exports Excel ;
   - le dossier du programme, s'il subsiste : par défaut `%LOCALAPPDATA%\Programs\JobScout`, ou le dossier choisi à l'installation. Si vous avez importé un CV au format image avec une version antérieure à la 3.4.18, les modèles OCR peuvent y être restés.

**Application Mac**

1. Quittez JobScout : menu JobScout › « Quitter JobScout » (⌘Q). Fermer sa fenêtre ou l'onglet du navigateur ne suffit pas.
2. Dans le Finder, menu Aller › « Aller au dossier » (Maj + ⌘ + G), tapez `~/Library/Application Support`, puis mettez le dossier `JobScout` à la Corbeille. Il contient la base (**clés API en clair comprises**), les documents, le moteur LinkedIn, les modèles OCR, les journaux et l'état de l'application.
3. Mettez l'application JobScout, dans le dossier Applications, à la Corbeille. La supprimer seule laisse vos données sur le disque.
4. Supprimez aussi, s'ils existent :
   - le dossier de documents, si vous en aviez choisi un autre ;
   - vos exports Excel ;
   - le fichier `~/Library/Preferences/fr.jobscout.app.plist`.
5. Videz la Corbeille. Les sauvegardes Time Machine faites avant gardent une copie de ces fichiers, sauf du moteur LinkedIn.

**Navigateur :** effacez les données du site `127.0.0.1` pour retirer le thème mémorisé.

**Chez les tiers :** supprimer JobScout n'efface pas ce que vous avez envoyé à votre fournisseur d'IA ou aux sites d'offres. Adressez-vous directement à eux (section 10).

## 10. Vos droits

- **Vos données locales** sont entre vos mains : vous les consultez, les corrigez (page Profil) et les supprimez vous-même.
- **Par le logiciel, l'éditeur ne reçoit aucune donnée sur vous.** À ce titre, il n'a rien à vous communiquer, à corriger ni à effacer.
- **Sur GitHub, c'est différent.** L'éditeur voit ce que vous publiez sur le dépôt et peut le masquer ou le supprimer. Pour faire retirer un message ou une donnée, voir la section 11.
- **Auprès des fournisseurs d'IA et des sites d'offres**, vous pouvez exercer les droits que vous donne le RGPD quand il s'applique à eux : accès, rectification, effacement, opposition, limitation, portabilité. Leur politique de confidentialité indique comment les contacter.
- **Réclamation :** vous pouvez saisir la CNIL, la Commission nationale de l'informatique et des libertés ([www.cnil.fr](https://www.cnil.fr)), ou l'autorité de protection des données de votre pays.
- **Questions sur cette politique :** utilisez les issues du dépôt (section 11).

## 11. GitHub et vos échanges avec l'éditeur

Le dépôt est hébergé par GitHub. Quand vous le consultez, le clonez, le téléchargez ou y écrivez, GitHub traite vos données selon sa propre [déclaration de confidentialité](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

- **Les issues et les pull requests sont publiques.** N'y mettez jamais de CV, de clé API, de base de données, de journal ou de capture d'écran de votre profil. Décrivez le problème sans données personnelles.
- Si vous proposez des modifications, vos commits rendent publics le nom et l'e-mail configurés dans Git. Une contribution intégrée les garde dans l'historique du dépôt.
- Si vous ajoutez une étoile au dépôt, le suivez ou le copiez (fork), votre nom d'utilisateur GitHub devient visible.
- GitHub fournit à l'éditeur des statistiques globales de fréquentation du dépôt : visites, clonages, sites d'origine. Elles ne lui disent pas qui vous êtes.

**Faire retirer une donnée.** Vous pouvez modifier vos messages et supprimer vos propres commentaires sur GitHub. Pour faire retirer un message ou une donnée publiés par erreur, ouvrez une issue sans répéter cette donnée, ou signalez le contenu à GitHub. L'éditeur fera ce qui est techniquement possible. Il ne peut pas toujours réécrire l'historique Git, et des copies (forks) peuvent exister hors de son contrôle.

**Le [site de présentation](https://latenightsbeats1208-pixel.github.io/jobscout/)** de JobScout est hébergé par GitHub Pages. Il ne dépose aucun cookie, ne mesure pas l'audience et ne charge aucune ressource extérieure. Il garde seulement dans votre navigateur le thème choisi, clair ou sombre. GitHub, qui l'héberge, voit votre adresse IP et la traite selon sa déclaration de confidentialité.

## 12. Modifications

Cette politique est versionnée avec le code : chaque modification apparaît dans l'historique Git du dépôt. Elle sera mise à jour si le fonctionnement de JobScout change, par exemple si une nouvelle destination de données apparaît. La date indiquée en tête est celle de la version en vigueur.

**Entrée en vigueur :** 21 octobre 2026 (JobScout 3.4.18). Dernière modification : application JobScout pour Mac, et modèles OCR rangés dans le dossier de données (3.4.18).
