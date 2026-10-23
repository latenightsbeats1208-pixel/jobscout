# Installer JobScout, pas à pas

> **Sur Mac ? Suivez le [guide Mac](INSTALL-MAC.md).** Les mêmes étapes, avec les gestes du Mac : Terminal, installeur de Node.js, lanceur à double-cliquer. Ce guide-ci montre les écrans de Windows. Les vidéos ont été tournées sous Windows : le guide Mac dit ce qui s'y applique.

Ce guide s'adresse à tout le monde, y compris si vous n'avez jamais ouvert un terminal. Suivez les étapes dans l'ordre : chacune dit ce que vous allez voir et comment savoir que c'est réussi.

## En bref

| | |
|---|---|
| **En vidéo** | [1. Installation](https://youtu.be/cIh4PSmPlKE) (étapes 1 à 4, et la mise à jour) · [2. Mise en place](https://youtu.be/gOMQkcsD6LA) (étape 5) · [3. Utilisation](https://youtu.be/45uLxsWXXLQ) (étape 6, et la relance au quotidien) — moins de 2 minutes chacune |
| **Temps total** | environ 10 à 20 minutes avec les réglages par défaut (jusqu'à 35 si vous activez d'autres sources), dont **10 à 15 minutes devant l'écran** |
| **Ce qu'il faut** | un ordinateur (Windows, macOS ou Linux), une connexion internet, votre CV, et une IA : une clé API chez le fournisseur de votre choix (Anthropic, OpenAI, Google Gemini, Mistral, DeepSeek…) ou un modèle local gratuit (Ollama, LM Studio) |
| **Coût** | logiciel gratuit ; l'IA est facturée par votre fournisseur sur votre clé — avec Claude (Anthropic), environ **0,12 à 0,20 $ par dossier** (CV + lettre) ; gratuite avec un modèle local. Le scan et le tri des offres sont gratuits. |
| **Où vont vos données** | profil, offres, documents et candidatures restent sur votre ordinateur (dossier `data/`). Pour lire votre CV et rédiger, JobScout envoie le texte du CV, votre profil et l'offre au fournisseur d'IA choisi, avec votre clé — ou à aucun, avec un modèle local. Pendant un scan, les sites d'offres reçoivent vos mots-clés, vos pays cibles et votre adresse IP. L'éditeur de JobScout ne reçoit rien. Détail : [politique de confidentialité](CONFIDENTIALITE.md). |

## Combien de temps ça prend ?

Durées mesurées le 30/09/2026 sur un PC Windows 11 relié à la fibre. Avec une connexion plus lente, l'étape 3 peut prendre quelques minutes de plus.

| Étape | Durée | Devant l'écran ? |
|---|---|---|
| 1. Installer Node.js | 2 à 5 min | oui (quelques clics) |
| 2. Récupérer JobScout | quelques secondes (Git) à 1 min (ZIP) | oui |
| 3. Installer les dépendances (`npm ci`) | environ 1 min (mesuré : 57 s), jusqu'à 5 min sur une connexion lente | **non**, laissez tourner |
| 4. Premier démarrage (`npm run dev`) | environ 20 s (mesuré : 18 s) | non |
| 5. Premier réglage : clé API, CV, préférences | 5 à 10 min | oui |
| 6. Premier scan des offres | environ 1 à 3 minutes avec France Travail seule, le réglage par défaut (estimation d'après les plafonds du code : 50 offres au plus) ; **10 à 20 min** si vous activez d'autres sources (mesuré en 3.4.10 : 17 min pour environ 790 offres avec 6 sources, dont la moitié pour LinkedIn) | **non**, JobScout travaille seul |

### Faut-il laisser l'ordinateur tourner tout seul ?

- **Pendant l'installation (étape 3) et pendant un scan (étape 6)** : oui, laissez l'ordinateur allumé et **empêchez la mise en veille**. Vous pouvez continuer à l'utiliser normalement pendant ce temps.
- **La fenêtre du terminal où tourne JobScout doit rester ouverte.** La fermer arrête l'application (vos données sont conservées ; il suffit de la relancer, voir « Au quotidien »). Réduire la fenêtre ne pose aucun problème.
- **Si l'ordinateur se met en veille pendant un scan**, le scan s'interrompt : relancez-le simplement depuis la page Offres.
- **Quand JobScout est fermé, rien ne tourne en arrière-plan** : pas de scan automatique, pas de connexion.

## Ce qu'il vous faut

- **Un ordinateur** Windows 10 ou 11, macOS ([guide Mac](INSTALL-MAC.md)) ou Linux, avec 8 Go de mémoire de préférence (4 Go minimum) et **environ 1 Go d'espace disque libre** (plus 265 Mo si vous activez LinkedIn).
- **Node.js 22.13 ou plus récent** : l'étape 1 explique comment l'installer.
- **Une IA, au choix** ([guide de l'IA, pas à pas](GUIDE-IA.md)) :
  - **une clé API** chez un fournisseur. Anthropic (Claude) est la référence de JobScout : compte sur [platform.claude.com](https://platform.claude.com), crédits (paiement à l'usage), puis une clé dans « API Keys » (`sk-ant-…`). Fonctionnent aussi : [OpenAI](https://platform.openai.com/api-keys), [Google Gemini](https://aistudio.google.com/apikey) (offre gratuite limitée), [Mistral](https://console.mistral.ai/api-keys), [DeepSeek](https://platform.deepseek.com/api_keys), [Groq](https://console.groq.com/keys), [OpenRouter](https://openrouter.ai/keys). Gardez la clé pour l'étape 5 ; ne la partagez avec personne ;
  - **ou un modèle local gratuit**, sans clé, et sans que votre CV ni vos documents ne sortent de l'ordinateur (les scans, eux, interrogent toujours les sites d'offres) : installez [Ollama](https://ollama.com/download) (puis par exemple `ollama pull gemma4:12b`) ou [LM Studio](https://lmstudio.ai). Il faut une machine assez puissante (16 Go de mémoire conseillés) et la qualité des documents est en général en dessous des grands modèles en ligne.
- **Votre CV** en PDF, DOCX, TXT ou image.
- **Git** est facultatif : vous pouvez télécharger JobScout en ZIP (étape 2, option B).

> **En vidéo** : les étapes 1 à 4 sont montrées dans le [tutoriel 1 — Installation](https://youtu.be/cIh4PSmPlKE).

## Étape 1 — Installer Node.js

Node.js est le moteur qui fait tourner JobScout.

**Windows**
1. Allez sur [nodejs.org](https://nodejs.org) et téléchargez la version **LTS** (22, 24 ou 26).
2. Lancez l'installeur et acceptez les choix proposés (« Next » / « Suivant » jusqu'au bout). Inutile de cocher l'option d'outils supplémentaires.

**macOS** : l'installeur n'est pas le même (fichier `.pkg`), et la version de Node.js dépend de votre version de macOS. Suivez l'étape 1 du [guide Mac](INSTALL-MAC.md#étape-1--installer-nodejs).

**Linux** : installez Node 22 ou 24 avec le gestionnaire de votre distribution ou avec [nvm](https://github.com/nvm-sh/nvm).

**Vérifier** : ouvrez un **nouveau** terminal (Windows : touche Windows, tapez `PowerShell`, Entrée ; macOS : `⌘ + Espace`, tapez `Terminal`, Entrée) et tapez :

```bash
node --version
```

C'est réussi si la réponse est `v22.13.0` ou un numéro plus grand (par exemple `v24.13.0`).

## Étape 2 — Récupérer JobScout

**Option A, avec Git** (dans le terminal) :

```bash
git clone https://github.com/latenightsbeats1208-pixel/jobscout.git
cd jobscout
```

**Option B, sans Git**
1. Sur la [page GitHub de JobScout](https://github.com/latenightsbeats1208-pixel/jobscout), cliquez sur le bouton vert **Code**, puis **Download ZIP**.
2. Décompressez le fichier, par exemple dans `Documents`, et renommez le dossier `jobscout`. Sur Mac, suivez plutôt l'étape 2 du [guide Mac](INSTALL-MAC.md#étape-2--récupérer-jobscout).
3. Ouvrez un terminal **dans ce dossier**. Windows : ouvrez le dossier dans l'Explorateur, cliquez dans la barre d'adresse, tapez `powershell` puis Entrée. macOS : dans Terminal, tapez `cd` suivi d'une espace, faites glisser le dossier dans la fenêtre, puis appuyez sur Entrée.

Pour vérifier que vous êtes au bon endroit, tapez `ls` (sous Windows, `dir` marche aussi) : vous devez voir `package.json` et `README.md`.

## Étape 3 — Installer les dépendances

Toujours dans le dossier `jobscout` :

```bash
npm ci
```

npm télécharge environ 330 paquets. **Laissez tourner** jusqu'au retour de l'invite de commande (environ 1 minute, parfois plus). C'est réussi si la fin affiche une ligne du type `added 328 packages` (le nombre exact peut varier un peu selon le système).

Ces messages sont **normaux** et sans conséquence :

- `npm warn deprecated node-domexception@1.0.0` : une dépendance indirecte obsolète, sans effet.
- `… packages are looking for funding` : de simples appels aux dons.
- Un message indiquant que le script d'installation de `tesseract.js` a été ignoré ou bloqué (npm récent) : ce script n'affiche qu'un appel aux dons, JobScout n'en a pas besoin.
- `npm notice New major version of npm available` : vous pouvez l'ignorer.

**Ne lancez pas `npm audit fix --force`** : cette commande remplacerait Tailwind CSS 3 par la version 4, incompatible, et casserait l'application.

## Étape 4 — Lancer JobScout

```bash
npm run dev
```

Attendez la ligne `✓ Ready in …` (une vingtaine de secondes la première fois), puis ouvrez **http://127.0.0.1:3000** dans votre navigateur. Laissez ce terminal ouvert tant que vous utilisez JobScout.

- Le message `ExperimentalWarning: SQLite is an experimental feature` est normal.
- La toute première ouverture d'une page prend quelques secondes (elle se prépare), les suivantes sont instantanées.
- JobScout n'est accessible que depuis votre ordinateur (adresse `127.0.0.1`), jamais depuis le réseau.

**Raccourci Windows** : `scripts\Start-JobScout.ps1` lance le serveur et ouvre le navigateur en une fois :

```bash
powershell -ExecutionPolicy Bypass -File scripts\Start-JobScout.ps1
```

**Sur Mac** : `npm run shortcut:mac` crée un lanceur `JobScout.command`, avec une copie sur le Bureau, à ouvrir d'un double-clic. Voir [Le lanceur Mac](INSTALL-MAC.md#le-lanceur-mac).

## Étape 5 — Premier réglage (5 à 10 minutes)

L'assistant s'ouvre tout seul, en trois étapes : **Importer**, **Vérifier**, **Préférences**.

> **En vidéo** : cette étape est montrée dans le [tutoriel 2 — Mise en place](https://youtu.be/gOMQkcsD6LA).

> **Pas encore de clé, ou envie d'une IA gratuite sur votre ordinateur ?** Le [guide de l'IA](GUIDE-IA.md) explique pas à pas comment créer une clé (Claude, OpenAI, Gemini…) ou installer Ollama et LM Studio, puis comment les brancher dans JobScout.

1. **Génération IA** : choisissez votre **fournisseur**, collez votre clé (aucune pour Ollama ou LM Studio), puis **Charger la liste** pour choisir le modèle de rédaction et le modèle de relecture (les valeurs proposées conviennent en général). Cliquez sur **Vérifier**, puis **Enregistrer**. La clé est enregistrée dans la base locale, sur votre ordinateur. Pour un modèle local, lancez d'abord Ollama ou le serveur de LM Studio.
2. **Importer** : déposez votre CV. L'IA en extrait votre profil (expériences, compétences, langues…). Comptez de quelques secondes à une minute.
3. **Vérifier** : relisez le profil extrait et corrigez ce qui doit l'être. JobScout ne rédigera jamais une compétence absente de ce profil : c'est le moment d'être complet.
4. **Préférences** : pays visés, types de contrat, secteurs, et les sources à scanner.

**LinkedIn (facultatif)** : c'est la seule source qui a besoin d'un petit navigateur intégré. Pour l'activer : cochez **LinkedIn** dans **Profil › Recherche › Sources** : un encadré « Moteur LinkedIn requis » apparaît sous les sources, avec le bouton **Installer le moteur LinkedIn** (environ 100 Mo à télécharger, 265 Mo sur le disque, 1 à 2 minutes).

## Étape 6 — Premier scan

> **En vidéo** : le scan, les filtres, les documents et le suivi des candidatures sont montrés dans le [tutoriel 3 — Utilisation](https://youtu.be/45uLxsWXXLQ).

Page **Offres** › **Lancer un scan**. JobScout interroge chaque source, puis note chaque offre selon votre profil. Ce tri est fait sur votre machine, sans IA ni coût.

- Durée : **1 à 3 minutes** avec France Travail seule (réglage par défaut) ; **10 à 20 minutes** si vous activez d'autres sources, selon le nombre de pays ; environ deux fois moins sans LinkedIn.
- Gardez la page du scan ouverte : elle reste bloquée jusqu'à la fin. Vous pouvez utiliser le reste de l'ordinateur pendant ce temps ; laissez le terminal ouvert et évitez la mise en veille.
- Une source indisponible (site en panne, protection anti-robot) est signalée dans le journal du scan ; les autres continuent.

Pour ne garder que les offres proches de chez vous, cliquez sur **Définir ma ville** dans les filtres, puis choisissez un rayon dans le menu **Toutes distances** (de « Dans ma ville » à « Jusqu'à 200 km »). Les distances sont calculées sur votre machine, sans rien envoyer.

Ensuite, sur la fiche d'une offre, **Générer les documents** produit un CV et une lettre d'une page (PDF et Word), en français, ou en anglais si l'annonce est en anglais (une annonce dans une autre langue donne des documents en français). C'est la seule étape (avec l'import du CV) qui utilise l'IA : 0,12 à 0,20 $ par dossier avec Claude, selon les tarifs du fournisseur sinon, rien avec un modèle local. Comptez en général moins de deux minutes avec un modèle en ligne, davantage avec un modèle local.

## Au quotidien

- **Relancer JobScout** : ouvrez un terminal dans le dossier `jobscout`, tapez `npm run dev`, puis ouvrez http://127.0.0.1:3000.
- **Arrêter JobScout** : dans le terminal, `Ctrl + C` (ou fermez la fenêtre). Sur Mac aussi, c'est la touche `control`, pas `⌘` : `⌘ + C` copie sans rien arrêter.
- **Mettre à jour** : arrêtez JobScout (`Ctrl + C`), puis, dans le dossier `jobscout`, tapez `git pull` puis `npm ci`, et relancez `npm run dev`. Si vous avez installé par ZIP : téléchargez le nouveau ZIP, décompressez-le, puis **recopiez votre dossier `data`** de l'ancienne version dans la nouvelle avant de lancer `npm ci`.
- **Sauvegarder vos données** : copiez le dossier `data` (base, documents générés).
- **Désinstaller** : supprimez le dossier `jobscout`. Pensez à garder une copie de `data` si vous voulez conserver vos candidatures.

## Problèmes fréquents

| Ce que vous voyez | Solution |
|---|---|
| `node` ou `npm` « n'est pas reconnu » | Fermez et rouvrez le terminal après l'installation de Node.js. Sinon, réinstallez Node.js (étape 1). |
| `EBADENGINE` ou un message sur la version de Node | Votre Node.js est trop ancien : installez la version LTS actuelle (22.13 ou plus). |
| `Port 3000 is in use` | Un autre programme utilise ce port. JobScout prend alors le port suivant et l'affiche dans le terminal (`using available port 3001`) : ouvrez l'adresse indiquée, par exemple http://127.0.0.1:3001. |
| La page ne s'ouvre pas | Vérifiez que le terminal tourne toujours et affiche `Ready`. Utilisez bien `http://127.0.0.1:3000`. |
| La clé API est refusée | Vérifiez que le bon fournisseur est choisi, que la clé est copiée en entier et qu'il reste des crédits sur votre compte chez ce fournisseur. |
| « Modèle introuvable » | Cliquez sur **Charger la liste** dans Profil › Génération IA et choisissez un modèle proposé. |
| « Rien ne répond à l'adresse http://127.0.0.1:… : Ollama (local) n'est pas lancé… » (ou LM Studio) | Lancez le logiciel (et, pour LM Studio, démarrez son serveur : onglet Developer › Start server), puis réessayez. JobScout et le logiciel d'IA doivent tourner sur le même ordinateur. Autres messages de l'IA locale : [guide de l'IA, section 6](GUIDE-IA.md#6-problèmes-fréquents). |
| Documents incomplets ou réponse « inexploitable » avec un modèle local | Choisissez un modèle plus grand ; pour Ollama, passez le contexte à 16k : **Settings › Context length** dans Ollama ([guide de l'IA, étape B6](GUIDE-IA.md#étape-b6--laisser-ollama-lire-un-cv-entier-16k)), ou la variable `OLLAMA_CONTEXT_LENGTH=16384` avant de le lancer (sur Mac, elle se règle autrement : [étape M6](GUIDE-IA.md#étape-m6--régler-le-contexte-à-16k-sur-mac)). |
| LinkedIn ne renvoie rien | Installez le moteur LinkedIn (Profil › Recherche › Sources). Si LinkedIn bloque temporairement, relancez le scan plus tard : les autres sources ne sont pas concernées. |
| `npm audit` signale des vulnérabilités | C'est attendu : elles concernent des outils de développement (Tailwind CSS), pas l'application (`npm audit --omit=dev` affiche 0). Ne lancez jamais `npm audit fix --force`. |

Une question, un bug ? Ouvrez une *issue* sur le [dépôt GitHub](https://github.com/latenightsbeats1208-pixel/jobscout/issues) — sans jamais y coller votre CV ni une clé : les issues sont publiques.

En utilisant JobScout, vous acceptez ses [conditions d'utilisation](CGU.md). Vos données : [politique de confidentialité](CONFIDENTIALITE.md).
