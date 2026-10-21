# Choisir et brancher l'IA de JobScout, pas à pas

JobScout a besoin d'une IA pour deux choses : lire votre CV, puis rédiger vos CV et vos lettres. C'est vous qui la choisissez. Ce guide vous aide à choisir, à créer une clé si besoin, ou à installer une IA gratuite sur votre ordinateur. Comme le [guide d'installation](INSTALL.md), chaque étape dit ce que vous allez voir et comment savoir que c'est réussi.

Les gestes décrits sont ceux de Windows. Quand un geste change sur Mac, le guide le dit : cherchez les mentions « Sur Mac ».

JobScout n'est pas encore installé ? Suivez d'abord le [guide d'installation](INSTALL.md) (sur Mac : le [guide Mac](INSTALL-MAC.md)), puis revenez ici à son étape 5, « Premier réglage ».

> Informations vérifiées le **5 octobre 2026** sur les sites officiels des fournisseurs (liste à la fin). Les écrans d'Ollama ont été lus dans son code source (version 0.35.1). Ce qui n'a pas pu être confirmé est signalé comme tel. Les prix et les écrans changent souvent : en cas de doute, l'écran du fournisseur fait foi.
>
> Les parties « Sur Mac » ont été vérifiées le **8 octobre 2026** dans les documentations d'Apple, d'Ollama et de LM Studio, et dans le code source de l'application Mac d'Ollama (version 0.40.1). Aucun Mac n'était disponible : les écrans du Mac n'ont pas été vus.

## Sommaire

1. [Quelle IA choisir ?](#1-quelle-ia-choisir-)
2. [Option A — une clé payante (Claude recommandé)](#2-option-a--une-clé-payante-claude-recommandé)
3. [Option B — Ollama, gratuit et local](#3-option-b--ollama-gratuit-et-local)
   - [Sur Mac : Ollama de bout en bout](#sur-mac--ollama-de-bout-en-bout)
4. [Option C — LM Studio](#4-option-c--lm-studio)
   - [Sur Mac : LM Studio](#sur-mac--lm-studio)
5. [Brancher l'IA dans JobScout](#5-brancher-lia-dans-jobscout)
6. [Problèmes fréquents](#6-problèmes-fréquents)
7. [Confidentialité : où va votre CV](#7-confidentialité--où-va-votre-cv)

## 1. Quelle IA choisir ?

Il existe deux familles :

- **Une IA en ligne** (Claude, OpenAI, Gemini…). Vous créez un compte chez le fournisseur. Il vous donne une **clé API** : un long code secret que vous collez dans JobScout. Il facture à l'usage.
- **Une IA locale** (Ollama, LM Studio). Un logiciel gratuit fait tourner l'IA sur votre ordinateur. Pas de compte, pas de clé, rien à payer. Il faut une machine assez puissante.

| | En ligne, payante (Claude) | En ligne, offre gratuite (Gemini, Mistral, Groq) | Locale (Ollama, LM Studio) |
|---|---|---|---|
| **Qualité des documents** | La meilleure : JobScout a été mis au point avec Claude | Variable selon le modèle : relisez vos premiers documents | En dessous des grands modèles en ligne ; dépend du modèle et de la machine |
| **Coût réel** | Environ **0,12 à 0,20 $ par dossier** (CV + lettre, relecture comprise) | 0 € dans la limite des quotas, qu'un dossier complet peut dépasser | **0 €, sans limite.** Seuls coûts : l'espace disque et l'électricité |
| **Votre CV** | Part chez Anthropic, qui ne s'en sert pas pour entraîner ses modèles | Part chez le fournisseur ; ses règles varient (voir [section 7](#7-confidentialité--où-va-votre-cv)) | **Ne quitte pas l'ordinateur** |
| **Matériel** | N'importe quel ordinateur relié à internet | N'importe quel ordinateur relié à internet | 16 Go de mémoire conseillés, idéalement une bonne carte graphique ; environ 20 Go de disque. Sur Mac : macOS 14 ou plus récent, idéalement une puce Apple avec 16 Go de mémoire ou plus ([détail](#étape-m1--vérifier-votre-mac)) |
| **Difficulté** | Facile : un compte, une carte bancaire, une clé à copier | Facile : un compte, une clé à copier, pas de carte | Moyenne : gros téléchargements et quelques commandes à copier-coller |

### Notre conseil

- **Vous voulez de bons documents tout de suite** : prenez **Claude** ([option A](#2-option-a--une-clé-payante-claude-recommandé)). À 0,12–0,20 $ par dossier, 10 $ de crédit couvrent environ 50 à 80 dossiers (calcul d'après l'estimation de JobScout).
- **Vous ne voulez rien payer et votre ordinateur est puissant** (bonne carte graphique, ou beaucoup de mémoire ; sur Mac, une puce Apple avec 16 Go de mémoire ou plus) : prenez **Ollama** ([option B](#3-option-b--ollama-gratuit-et-local)). Votre CV reste chez vous.
- **Vous ne voulez rien payer mais votre ordinateur est modeste** : essayez l'offre gratuite de **Google Gemini** (fiche dans l'option A). Pas de carte bancaire. Les quotas sont limités : si JobScout affiche « Limite atteinte », patientez quelques minutes.
- **Vous hésitez** : commencez par Claude. Vous pourrez changer à tout moment dans **Profil › Génération IA**, sans perdre vos réglages.

## 2. Option A — une clé payante (Claude recommandé)

### Deux choses à savoir avant de commencer

> **Un abonnement de chat n'est pas une clé API.** Payer Claude Pro ou Max, ChatGPT Plus ou Google AI Pro ne finance pas JobScout. JobScout passe par l'**API** du fournisseur : un espace « développeur » à part, avec sa propre facturation. C'est le piège n° 1. Deux nuances : l'abonnement Pro de Mistral inclut un petit crédit API, et Google peut accorder des crédits à qui a souscrit un de ses abonnements, sous conditions (voir leurs fiches).

> **Votre clé est un mot de passe.** Quiconque la possède peut dépenser votre crédit.
> - Ne la donnez à personne. Ne l'envoyez pas par e-mail. Ne la montrez pas sur une capture d'écran.
> - Ne la collez **jamais** dans une *issue* GitHub : les issues sont publiques.
> - JobScout la garde sur votre ordinateur, dans sa base locale, **en clair** (non chiffrée). Protégez l'accès à votre session.
> - Vous pensez qu'elle a fuité ? Supprimez-la dans la console du fournisseur et créez-en une nouvelle.

### La marche à suivre, chez tous les fournisseurs

1. **Créez un compte sur la console développeur** du fournisseur (lien dans sa fiche ci-dessous). Ce n'est pas l'application de chat, même si le même e-mail peut servir.
2. **Ajoutez du crédit** par carte bancaire, sauf si vous restez sur une offre gratuite. Chez la plupart des fournisseurs, c'est **prépayé** : vous chargez un montant, puis il diminue à chaque dossier.
3. **Fixez un plafond de dépenses** mensuel quand c'est possible. Et **laissez désactivée la recharge automatique** (« auto-reload ») : vous éviterez toute surprise.
4. **Créez la clé et copiez-la aussitôt.** Chez la plupart des fournisseurs, elle ne s'affiche **qu'une seule fois**. Perdue ? Pas grave : créez-en une nouvelle.
5. **Collez-la dans JobScout** : voir la [section 5](#5-brancher-lia-dans-jobscout).

### Les fournisseurs en un coup d'œil

| Fournisseur | Offre gratuite | Premier paiement | Plafond réglable | La clé commence par |
|---|---|---|---|---|
| Anthropic (Claude) | non | minimum non indiqué par la documentation officielle | oui | `sk-ant-` |
| OpenAI (GPT) | non (voir sa fiche) | 5 $ minimum | oui | `sk-proj-` (ou `sk-` pour les anciennes)\* |
| Google Gemini | **oui**, sans carte, avec quotas | 5 $ minimum, seulement si vous passez en payant | oui (fonction expérimentale) | `AIza` pour les anciennes ; les récentes peuvent commencer autrement |
| Mistral AI | **oui**, sans carte, avec quotas | aucun pour l'offre gratuite | oui | pas de début fixe |
| DeepSeek | non | minimum non publié | non : seul votre solde vous limite | `sk-`\* |
| Groq | **oui**, très limitée | rien à avancer : facturé après usage | oui (plans payants) | `gsk_`\* |
| OpenRouter | seulement les modèles en `:free` | minimum non documenté ; frais de 5,5 % par carte | oui, par clé | `sk-or-v1-` |

\* Début de clé rapporté par des sources non officielles. Si la vôtre commence autrement, collez-la quand même.

### Anthropic (Claude) — recommandé

- **Où** : [platform.claude.com](https://platform.claude.com), la « Claude Console ». C'est un compte distinct de claude.ai, même avec le même e-mail.
- **Se connecter** : il n'y a pas de mot de passe. Saisissez votre e-mail, puis cliquez sur « Continue with email ». Vous recevez un e-mail intitulé « Secure link to log in to Claude Console » : cliquez sur le lien qu'il contient. Autre possibilité : « Continue with Google ».
- **Payer** : Settings > Billing, bouton « Buy credits ». Payez par carte : les crédits sont disponibles tout de suite. Ils expirent 1 an après l'achat et ne sont pas remboursables. Les requêtes en échec ne sont pas facturées. En revanche, une requête interrompue de votre côté (fenêtre fermée, délai dépassé) alors qu'elle allait aboutir est facturée quand même.
- **Plafond** : même page, section « Spend limits », bouton « Set limit » (« Adjust limit » si un plafond existe déjà). Saisissez un montant mensuel en dollars. Laissez l'auto-reload désactivé.
- **Clé** : [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys), bouton « Create key ». Remplissez la fenêtre ainsi :
  - **Nom** : par exemple « JobScout ».
  - **Expiration** : choisissez **Never** (jamais), ou une longue durée, au moins 30 jours. Évitez 3 heures, 1 jour ou 7 jours : JobScout cesserait de marcher du jour au lendemain, sans e-mail d'alerte. Pour une clé d'au moins 14 jours, Anthropic vous prévient par e-mail 7 jours avant. Une clé expirée ne se réactive pas : créez-en une nouvelle et collez-la dans **Profil › Génération IA**.
  - **Linked account** (compte lié) : laissez **votre propre compte**. C'est une clé personnelle.
  - **Workspace** (espace de travail) : rattachez la clé à **un seul** espace, le « Default Workspace ». Une clé valable pour plusieurs espaces ne marche pas avec JobScout : chaque appel est refusé avec « Erreur du service de génération (HTTP 400) ».
  - Copiez la clé. Elle commence par `sk-ant-` et ne s'affiche qu'une fois.

  *Ces champs viennent de la documentation d'Anthropic : l'écran n'a pas été vu. Le choix proposé par défaut pour l'espace de travail n'est pas confirmé : vérifiez-le.*
- **Gratuit ?** Non. La documentation officielle ne mentionne aucun crédit offert.
- **Compte neuf** : au début, Anthropic peut appliquer des limites réduites, qui augmentent ensuite toutes seules. Si JobScout affiche « Erreur du service de génération (HTTP 429) », patientez une minute, puis relancez.
- **Piège** : Claude Pro ou Max (l'abonnement du chat) n'inclut pas l'API. Sans crédit dans la Console, la clé est valide mais les appels sont refusés.
- **Bouton « Create key » grisé ?** Votre rôle dans l'organisation ne permet pas de créer des clés (cas des comptes d'entreprise). Sur un compte personnel, vous êtes administrateur.

### OpenAI (GPT)

- **Où** : [platform.openai.com](https://platform.openai.com). Votre compte ChatGPT peut servir, mais la facturation de l'API est séparée.
- **Payer** : dans la facturation de l'API (Billing), « Add payment details », puis choisissez un montant : 5 $ minimum, 10 $ proposés par défaut. Le solde peut mettre quelques minutes à apparaître. Les crédits expirent après 1 an et ne sont pas remboursables.
- **Attention** : pendant ce premier paiement, « Use auto-reload » est **activé par défaut**. Désactivez-le si vous ne voulez pas de recharge automatique.
- **Plafond** : Organization limits > Spend > « Edit spend limit ». Indiquez le « Monthly spend limit », activez « Enforce a hard limit », puis « Save ». Le solde prépayé ne coupe pas net : un petit solde négatif reste possible, déduit de l'achat suivant.
- **Clé** : [platform.openai.com/api-keys](https://platform.openai.com/api-keys), bouton « + Create new secret key ». Copiez-la tout de suite : elle ne s'affiche qu'une fois.
- **Gratuit ?** Comptez payer : la documentation ne décrit pas d'offre gratuite utilisable ici. OpenAI offre bien des jetons gratuits si vous partagez vos échanges avec lui pour entraîner ses modèles, avec un solde positif quand même. **Ne l'activez pas** : vos CV en feraient partie.
- **Piège** : ChatGPT Plus ou Pro n'inclut pas l'API.
- Pour certains modèles, OpenAI peut demander de vérifier votre organisation (pièce d'identité, selfie).

### Google Gemini — l'offre gratuite la plus simple

- **Où** : [aistudio.google.com/apikey](https://aistudio.google.com/apikey), avec votre compte Google. Acceptez les conditions. Pour un nouvel utilisateur, Google AI Studio crée tout seul un projet et une clé.
- **Une autre clé** : page API Keys, bouton « Create API key ».
- **Gratuit ?** **Oui**, sans carte bancaire, dans la limite de quotas par minute et par jour. Selon la page de prix de Google, les modèles proposés par JobScout (`gemini-3.8-flash` et `gemini-3.5-flash-lite`) font partie des modèles gratuits. Vos quotas réels : [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit).
- **Passer en payant** (facultatif) : bouton « Set up billing », puis prépaiement de 5 $ minimum. Attention : une fois la facturation activée, **tout s'arrête quand le solde tombe à 0 $**, même ce qui était gratuit avant.
- **Plafond** : page Spend, « Monthly spend cap » > « Edit spend cap ». La fonction est expérimentale : un léger dépassement reste possible.
- **Clé** : les anciennes commencent par `AIza`. Depuis fin mai 2026, Google crée un nouveau type de clé, qui peut commencer autrement. JobScout affiche encore `AIza…` en exemple : ne vous en inquiétez pas, collez votre clé telle quelle.
- **Abonnement Google AI Pro ou Ultra** : il ne finance pas directement JobScout. Il peut donner droit à des crédits Google Cloud mensuels, utilisables pour l'API Gemini, mais seulement si la facturation est activée, avec un solde prépayé supérieur à 0 $. Pour JobScout, l'offre gratuite suffit pour commencer.
- **Vos données** : la carte de JobScout prévient que, sur l'offre gratuite, vos données peuvent servir à améliorer les produits Google. C'est la règle hors d'Europe. En France, ailleurs dans l'Espace économique européen, en Suisse et au Royaume-Uni, Google applique à tous les services les règles de son offre payante, qui excluent cet usage.

### Mistral AI — européen, avec offre gratuite

- **Où** : [console.mistral.ai](https://console.mistral.ai). L'espace s'appelle désormais « Studio » : les anciens tutoriels parlent de « La Plateforme ».
- **Gratuit ?** **Oui** : le « Free mode » est actif dès l'inscription, sans carte bancaire, avec des limites d'usage.
- **À faire avant d'envoyer votre CV** : Admin panel > menu « Privacy » > section « Anonymous improvement data » : **désactivez** l'interrupteur. Sinon, en Free mode, Mistral peut utiliser vos échanges pour entraîner ses modèles. Ce réglage est distinct de celui de l'assistant de chat de Mistral : si vous utilisez aussi le chat, désactivez les deux.
- **Clé** : menu de gauche « API Keys » > « Create new key ». Remplissez « Name » et la date d'expiration. Pour « Connector access scope », « Shared connectors only » suffit. Cliquez sur « Create new key » et copiez la clé : elle n'apparaît qu'une seule fois.
- **Payer au-delà du gratuit** : Admin Panel › Subscription pour activer le paiement à l'usage (pay-as-you-go), puis Admin Panel › Subscriptions › Billing › « Add payment method ».
- **Plafond** : Admin Panel › Subscriptions › Billing, « Monthly spending limit (API and Vibe) ».
- **Une exception au piège** : chez Mistral, l'abonnement Pro (14,99 $ par mois hors taxes) inclut un petit crédit API mensuel. L'offre gratuite suffit pour commencer.

### DeepSeek — très économique, mais lisez la confidentialité

- **Où** : [platform.deepseek.com](https://platform.deepseek.com).
- **Payer** : page « Top Up », par PayPal, carte bancaire, Alipay ou WeChat Pay. Vérifiez le résultat sur la page « Billing ». Le solde n'expire pas. La partie non utilisée est remboursable (« Billing » > « Refunds »).
- **Plafond** : aucun réglage. Votre solde est votre plafond : ne chargez que ce que vous acceptez de dépenser.
- **Clé** : page « API Keys » ([platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)). Créez une clé et copiez-la aussitôt. En cas de fuite : icône corbeille, « Revoke », puis créez-en une nouvelle.
- **Gratuit ?** Non. Le chat de DeepSeek est gratuit, son API ne l'est pas.
- **Tarif doublé aux heures de pointe** : en semaine, de 01:00 à 04:00 et de 06:00 à 10:00 UTC. En France, cela tombe le matin : 3 h–6 h et 8 h–12 h en heure d'été, une heure plus tôt en hiver.
- **Confidentialité** : vos données sont stockées en Chine et, par défaut, utilisées pour entraîner les modèles. Le retrait se fait par e-mail à privacy@deepseek.com, sans bouton. Réfléchissez-y avant d'y envoyer votre CV.

### Groq — gratuit, mais très limité

- **Où** : [console.groq.com](https://console.groq.com). Clé sur [console.groq.com/keys](https://console.groq.com/keys) : créez-la et copiez-la aussitôt.
- **Gratuit ?** Oui, sans carte. Mais pour les modèles proposés par JobScout, le plan gratuit plafonne à 8 000 jetons par minute et 200 000 par jour. Un seul dossier (CV + lettre) peut dépasser la limite par minute. JobScout affiche alors « Limite atteinte chez Groq », ou parfois « Document ou offre trop volumineux pour Groq ». *(Ce second cas est rapporté par des utilisateurs ; Groq ne le documente pas.)*
- **Payer** (plan Developer) : dans les paramètres du compte, ajoutez un moyen de paiement (carte ou prélèvement SEPA). Vous êtes facturé après usage, rien à avancer.
- **Plafond** (plans payants seulement) : Settings → Billing → Limits, « Add Limit ». Ajoutez des alertes à 50, 75 et 90 %, puis « Save ». La dépense est mise à jour toutes les 10 à 15 minutes : un léger dépassement est possible.
- Pas d'abonnement de chat payant à confondre avec l'API.

### OpenRouter — une clé, des centaines de modèles

- **Où** : [openrouter.ai](https://openrouter.ai).
- **Confidentialité d'abord** : dans les réglages de confidentialité du compte, refusez les fournisseurs qui entraînent leurs modèles sur vos données ou qui publient les requêtes. Il y a un réglage pour les modèles gratuits et un pour les payants.
- **Crédits** (obligatoires pour les modèles payants) : [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits), « Add Credits ». OpenRouter prend 5,5 % de frais par carte (0,80 $ minimum), non remboursables. Évitez la recharge automatique (auto top-up).
- **Clé** : [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys), « Create API Key ». Donnez-lui un nom et **une limite de crédit** (credit limit) : c'est fortement conseillé. La clé commence par `sk-or-v1-`.
- **Gratuit ?** Seulement les modèles dont le nom finit par `:free` : 50 requêtes par jour tant que vous avez acheté moins de 10 $ de crédits au total, 1 000 par jour au-delà. **Les modèles proposés par défaut dans JobScout sont payants.** Pour rester gratuit : cliquez sur « Charger la liste », puis, dans chaque champ de modèle, effacez le contenu (`Ctrl + A` puis `Suppr` ; sur Mac, `⌘ + A` puis la touche `⌫`) et tapez `free`. La liste se réduit en principe aux modèles gratuits : choisissez-en un.
- Un solde négatif bloque tout, même les modèles gratuits.

## 3. Option B — Ollama, gratuit et local

Ollama est un logiciel gratuit (licence MIT) qui fait tourner une IA sur votre ordinateur. Pas de compte, pas de clé, pas de carte bancaire. Sa page de prix le dit : « Running models on your own hardware is always unlimited. » Autrement dit, faire tourner les modèles sur votre propre machine est illimité. Et votre CV ne quitte pas votre ordinateur.

Il y a quatre choses à faire : installer Ollama, ignorer ses offres payantes, télécharger deux modèles, puis régler la longueur de texte qu'il peut lire.

> **Sur Mac ?** Les étapes B1 à B7 ci-dessous montrent Windows. Suivez plutôt « [Sur Mac : Ollama de bout en bout](#sur-mac--ollama-de-bout-en-bout) », à la fin de cette section : mêmes modèles, mêmes commandes, avec les gestes du Mac.

### En bref

| | |
|---|---|
| **Coût** | 0 €, sans limite. Aucun compte, aucune carte bancaire |
| **À télécharger** | environ 16 Go : l'installeur (≈ 1,6 Go) et deux modèles (≈ 8,0 Go + 6,6 Go). Sur Mac, l'installeur `Ollama.dmg` pèse environ 207 Mo |
| **Espace disque** | environ 20 Go libres sur `C:` (Ollama demande au moins 4 Go, plus les modèles). Sur Mac : environ 20 Go libres sur le disque du Mac |
| **Durée du téléchargement** | estimation, pas une mesure : quelques minutes avec la fibre, environ 20 minutes à 100 Mbit/s, plus d'une heure à 30 Mbit/s |
| **Système** | Windows 10 22H2 ou plus récent, Windows 11, macOS 14 Sonoma ou plus récent (Mac à puce Apple ou Mac Intel ; sur un Mac Intel, Ollama n'utilise que le processeur : c'est lent), Linux |
| **Pendant l'usage** | Ollama doit tourner : une icône de lama près de l'horloge (sur Mac : dans la barre des menus, en haut à droite de l'écran) |

**Version express**, si Ollama est déjà installé et votre ordinateur bien équipé (sinon, voyez d'abord l'étape B1, ou l'[étape M1](#étape-m1--vérifier-votre-mac) sur Mac) : ouvrez un **nouveau** PowerShell (sur Mac : l'application Terminal), tapez ces trois lignes une par une (Entrée après chacune, en attendant la ligne `success` qui termine chaque téléchargement), puis passez à l'[étape B6](#étape-b6--laisser-ollama-lire-un-cv-entier-16k) (sur Mac : [étape M6](#étape-m6--régler-le-contexte-à-16k-sur-mac)). C'est réussi si la dernière commande, `ollama list`, affiche `gemma4:12b` et `qwen3.5:9b`.

```powershell
ollama pull gemma4:12b
ollama pull qwen3.5:9b
ollama list
```

### Étape B1 — Vérifier que votre ordinateur suit

*Sur Mac, la vérification se fait autrement : voir l'[étape M1](#étape-m1--vérifier-votre-mac).*

1. Ouvrez le Gestionnaire des tâches : `Ctrl + Maj + Échap`.
2. La fenêtre est petite, sans onglets ? Cliquez sur **Plus de détails**, en bas. Puis ouvrez **Performances** : un onglet en haut sous Windows 10, une icône en forme de courbe dans la colonne de gauche sous Windows 11.
3. Cliquez sur **Mémoire** (la mémoire vive) : le total s'affiche en haut à droite, par exemple « 16,0 Go ».
4. Cliquez sur la ligne **GPU**, s'il y en a une. Vous en voyez deux (GPU 0 et GPU 1) ? Prenez celle dont le nom contient **NVIDIA** ou **AMD Radeon RX** : l'autre est la puce graphique intégrée, sans mémoire propre. Lisez la ligne « Mémoire GPU dédiée » : le second nombre est la taille de la carte (« 0,3/8,0 Go » = 8 Go).
5. Choisissez vos modèles avec ce tableau :

| Votre ordinateur | Modèles à installer | Ce que ça donne |
|---|---|---|
| Carte graphique avec 12 Go de mémoire dédiée ou plus | `gemma4:12b` (rédaction) et `qwen3.5:9b` (relecture), les modèles par défaut de JobScout | Le meilleur résultat en local |
| Carte graphique avec 6 à 8 Go de mémoire dédiée | essayez d'abord les modèles par défaut, puis vérifiez la vitesse (voir « [Si c'est lent](#si-cest-lent--vérifier-où-tourne-le-modèle) ») ; trop lent, passez à `qwen3.5:4b` pour les deux rôles | Les modèles par défaut risquent de déborder sur le processeur : ça marche, mais plus lentement |
| Pas de bonne carte graphique, mais 32 Go de mémoire | les mêmes que la première ligne | Fonctionne, mais nettement plus lent |
| Pas de bonne carte graphique, 8 à 16 Go de mémoire | `qwen3.5:4b` (3,3 Go) pour les deux rôles, ou `ministral-3:8b` (6,0 Go) pour la rédaction | Plus léger, mais qualité plus faible |
| Moins de 8 Go de mémoire | une IA en ligne ([option A](#2-option-a--une-clé-payante-claude-recommandé) ; Gemini a une offre gratuite) | Un modèle local serait trop lent |

> Ces seuils sont des **repères approximatifs**, pas des chiffres officiels. Le plus simple : essayez, puis vérifiez la vitesse (voir « [Si c'est lent](#si-cest-lent--vérifier-où-tourne-le-modèle) »).
>
> La carte de JobScout conseille « au moins 14 milliards de paramètres » : c'est l'idéal pour la qualité. Les modèles proposés (12 et 9 milliards) sont le bon point de départ si votre machine les fait tourner.

### Étape B2 — Installer Ollama (Windows)

*Sur Mac : voir l'[étape M2](#étape-m2--installer-ollama-sur-mac).*

1. Allez sur [ollama.com/download/windows](https://ollama.com/download/windows).
2. Cliquez sur **Download manually**. Le fichier `OllamaSetup.exe` se télécharge. Il pèse environ 1,6 Go : c'est long, c'est normal.
   La page propose aussi une commande à coller dans PowerShell. Ne la prenez pas : elle exécute un script téléchargé. L'installeur officiel est plus sûr et plus simple.
3. Double-cliquez sur `OllamaSetup.exe` et suivez l'installation. Inutile d'être administrateur.
4. À la fin, Ollama démarre et une fenêtre **« Welcome to Ollama! »** s'ouvre : passez à l'étape B3. Ensuite, Ollama se lancera tout seul, en arrière-plan, à chaque ouverture de session Windows.

**C'est réussi si** une petite **icône de lama** apparaît près de l'horloge, en bas à droite. Vous ne la voyez pas ? Cliquez sur la petite flèche **^** à côté de l'horloge : elle s'y cache souvent.

### Étape B3 — Le premier écran d'Ollama : ne payez rien

> **Attention : ignorez les modèles cloud et les offres payantes d'Ollama**
>
> **Ce que vous avez peut-être vu.** L'application Ollama vous propose de **créer un compte**, avec un gros bouton « Sign up ». Puis elle vous demande de taper `ollama` dans un terminal. Si vous le faites, le terminal vous propose à son tour de vous connecter, puis affiche des modèles marqués « Sign in required » (connexion requise) ou « Upgrade required » (abonnement requis), voire la question « Upgrade to use … ? ». Dans la fenêtre de chat, la liste des modèles commence par des modèles dont le nom finit par `cloud`. Et le site d'Ollama parle d'abonnements (Pro à 20 $ par mois, et plus). On a l'impression qu'il faut payer.
>
> **Ce n'est pas le cas.** Le compte et les abonnements servent **uniquement** aux modèles « cloud », qui tournent sur les serveurs d'Ollama. JobScout utilise des modèles **locaux** : gratuits, illimités, sans compte.
>
> **Quoi faire :**
> 1. Écran « Welcome to Ollama! » : cliquez sur **Continue**.
> 2. Écran « Create an account » : **ne cliquez pas sur « Sign up »**. Cliquez sur le lien en dessous : **No thanks, I'll use Ollama locally**.
> 3. Écran « Run Ollama » : il affiche la commande `ollama` et vous invite à la lancer dans un terminal. **Ne le faites pas.** Cet écran n'a pas de bouton pour continuer : fermez simplement la fenêtre (croix en haut à droite). Ollama continue de tourner en arrière-plan. Les modèles se téléchargent à l'[étape B5](#étape-b5--télécharger-les-deux-modèles), avec une autre commande.
> 4. Faites disparaître le cloud : clic sur l'icône de lama près de l'horloge › **Settings** › désactivez l'interrupteur **Cloud**. Il n'y a pas de bouton Enregistrer : le réglage s'applique tout de suite, et un petit badge « Saved » s'affiche quelques secondes.
> 5. Toujours dans **Settings**, laissez « Ollama account — Not connected » tel quel, et laissez **Expose Ollama to the network** désactivé. JobScout n'a besoin ni de l'un ni de l'autre.
> 6. Si vous ouvrez un jour la fenêtre de chat d'Ollama : **ne choisissez aucun modèle dans sa liste** (« Select a model »), même local. On les télécharge à l'étape B5, avec les bons noms. Les modèles dont le nom finit par `cloud` (`:cloud` ou `-cloud`, avec une petite icône de nuage) tournent chez Ollama et demandent un compte. Méfiez-vous des noms jumeaux : le 5 octobre 2026, cette liste proposait `gemma4:31b-cloud`, qui tourne chez Ollama, alors que `gemma4:12b`, conseillé ici, tourne chez vous. Le seul modèle local de la liste était `gemma4:26b` : un téléchargement d'environ 19 Go, trop lourd pour la plupart des ordinateurs. Ollama modifie cette liste à distance : elle peut avoir changé.
>
> **Vous avez déjà tapé `ollama` dans un terminal ?** Rien n'a été payé ni installé. Fermez cette fenêtre PowerShell (croix en haut à droite), sans rien choisir dans ses menus. Pour l'étape B5, vous ouvrirez une nouvelle fenêtre.
>
> **Bonne nouvelle : la fenêtre de chat d'Ollama est facultative.** JobScout parle à Ollama en arrière-plan. Il lui faut seulement qu'Ollama tourne et que les modèles soient téléchargés.
>
> *Ces écrans ont été lus dans le code source d'Ollama 0.35.1, pas vus à l'écran. Ils peuvent légèrement différer selon votre version.*
>
> **Sur Mac**, les écrans sont les mêmes ; seuls les gestes changent (bouton rouge pour fermer, icône dans la barre des menus, Terminal) : voir l'[étape M3](#étape-m3--le-premier-écran-sur-mac).

### Étape B4 — Vérifier qu'Ollama tourne

1. Ouvrez votre navigateur à l'adresse **http://127.0.0.1:11434**.
2. **C'est réussi si** la page affiche « Ollama is running ».

Sinon : lancez Ollama depuis le menu Démarrer (tapez `Ollama`), attendez quelques secondes, puis rechargez la page. Sur Mac : ouvrez Ollama depuis le dossier **Applications** (voir l'[étape M4](#étape-m4--vérifier-quollama-tourne-sur-mac)).

### Étape B5 — Télécharger les deux modèles

C'est l'étape qu'on oublie le plus souvent : **Ollama s'installe vide, sans aucun modèle.** Tant qu'aucun modèle n'est téléchargé, JobScout ne peut rien faire.

1. Ouvrez un **nouveau** PowerShell : touche Windows, tapez `PowerShell`, Entrée.
   *Nouveau*, car une fenêtre ouverte avant l'installation ne connaît pas encore la commande `ollama`.
   *Sur Mac*, on utilise l'application **Terminal** : voir l'[étape M5](#étape-m5--télécharger-les-modèles-dans-terminal).
2. Vérifiez que la commande est reconnue :

   ```powershell
   ollama -v
   ```

   C'est réussi si un numéro de version s'affiche. Si Windows répond que le terme « ollama » n'est pas reconnu, fermez la fenêtre et ouvrez-en une nouvelle. Toujours pas reconnu ? Fermez votre session Windows (ou redémarrez l'ordinateur), puis réessayez. Si rien ne change, relancez l'installeur ([étape B2](#étape-b2--installer-ollama-windows)).

   **Ne tapez pas `ollama` tout seul**, même si l'écran « Run Ollama » vous le propose : cela ouvre un assistant de compte et un menu de modèles cloud, inutiles ici. Déjà fait ? Voyez la fin de l'[étape B3](#étape-b3--le-premier-écran-dollama--ne-payez-rien).

3. Téléchargez le modèle de rédaction (environ 8 Go). Copiez cette ligne, collez-la dans la fenêtre (`Ctrl + V` ; sur Mac, `⌘ + V`), puis appuyez sur Entrée :

   ```powershell
   ollama pull gemma4:12b
   ```

   Des barres de progression défilent. **Laissez tourner** jusqu'au retour de l'invite de commande (la ligne `PS C:\Users\…>` ; sur Mac, une ligne qui se termine par `%`). Vous pouvez utiliser l'ordinateur pendant ce temps.

   **C'est réussi si** la dernière ligne avant l'invite est `success`. Une ligne commence par `Error:` (coupure internet, disque plein, faute de frappe) ? Vérifiez la commande, puis relancez-la telle quelle : le téléchargement reprend là où il s'était arrêté.

4. Téléchargez le modèle de relecture (environ 6,6 Go), avec le même critère de réussite (`success`) :

   ```powershell
   ollama pull qwen3.5:9b
   ```

5. Vérifiez :

   ```powershell
   ollama list
   ```

   Un petit tableau s'affiche, avec les colonnes `NAME`, `ID`, `SIZE` et `MODIFIED`. **C'est réussi si** la colonne `NAME` contient exactement `gemma4:12b` et `qwen3.5:9b`.

6. Facultatif, un petit test :

   ```powershell
   ollama run qwen3.5:9b --hidethinking "Dis bonjour en une phrase"
   ```

   **C'est réussi si** une phrase en français s'affiche. La première fois, cela peut prendre une minute : le modèle se charge en mémoire. Si l'invite `>>>` apparaît, tapez `/bye` pour en sortir.

> **Tapez toujours le nom complet, avec ce qui suit les deux-points.** `gemma4` tout court n'est **pas** `gemma4:12b` : c'est un autre modèle, plus petit (`gemma4:e4b`, 6,6 Go), qui n'est pas celui que JobScout attend.
>
> **Vous avez déjà téléchargé un modèle depuis l'application Ollama ?** Tapez `ollama list` pour voir son nom exact :
> - `qwen3.5:latest` : c'est le même modèle que `qwen3.5:9b`. Tapez `ollama pull qwen3.5:9b` : ce devrait être presque instantané, les fichiers étant les mêmes.
> - `gemma4:latest` : c'est `gemma4:e4b`, pas le modèle conseillé. Tapez `ollama pull gemma4:12b` (8 Go, un vrai téléchargement), puis libérez la place avec `ollama rm gemma4:latest`.
> - `gemma4:26b` : environ 19 Go, et il demande environ 19 Go de mémoire graphique. Sauf carte graphique exceptionnelle, supprimez-le avec `ollama rm gemma4:26b`.

**Ordinateur modeste** : à la place des deux téléchargements ci-dessus, un seul suffit (3,3 Go) :

```powershell
ollama pull qwen3.5:4b
```

Vous l'utiliserez pour la rédaction et pour la relecture. Autres modèles légers et gratuits : `ministral-3:8b` (6,0 Go) et `gemma4:e2b` (4,6 Go). Plus le modèle est petit, plus le risque d'une réponse « inexploitable » augmente.

### Étape B6 — Laisser Ollama lire un CV entier (16k)

Sur un ordinateur ordinaire, Ollama ne lit par défaut qu'environ 4 000 « jetons » (des morceaux de mots) à la fois. Un long CV est alors coupé, et les documents sortent incomplets. JobScout conseille 16 384 jetons, soit « 16k ». Ce réglage se fait dans Ollama : JobScout ne peut pas le faire à sa place.

*Sur Mac : voir l'[étape M6](#étape-m6--régler-le-contexte-à-16k-sur-mac). La méthode de secours ci-dessous n'y fonctionne pas.*

**Méthode simple**

1. Clic sur l'icône de lama près de l'horloge › **Settings**.
2. Réglage **Context length** : placez le curseur sur **16k**. Pas de bouton Enregistrer : un badge « Saved » s'affiche quelques secondes et Ollama redémarre tout seul. Il n'y a rien d'autre à faire.

**Si le curseur est grisé** (méthode de secours)

1. Dans une fenêtre PowerShell (pas celle où tourne JobScout, si vous l'avez lancé depuis un terminal), collez cette ligne puis appuyez sur Entrée :

   ```powershell
   [Environment]::SetEnvironmentVariable('OLLAMA_CONTEXT_LENGTH','16384','User')
   ```

2. Clic sur l'icône de lama › **Quit Ollama**. Fermer la fenêtre ne suffit pas : il faut vraiment quitter.
3. Relancez Ollama depuis le menu Démarrer.

> Choisissez **une seule** méthode. Si vous avez déjà touché le curseur, c'est lui qui l'emporte sur la ligne de commande.

**Vérifier, plus tard** : une fois JobScout branché ([section 5](#5-brancher-lia-dans-jobscout)), importez votre CV. Dans les 5 minutes qui suivent, tapez `ollama ps` dans la fenêtre PowerShell de l'étape B5 (pas dans celle où tourne JobScout). La colonne `CONTEXT` doit afficher `16384`. Le tableau est vide ? Le modèle a déjà quitté la mémoire : relancez une génération, puis retapez la commande.

Un contexte plus long consomme plus de mémoire. Si tout devient très lent, passez à un modèle plus léger.

### Étape B7 — Laisser Ollama ouvert

- Ollama doit tourner **pendant que vous utilisez JobScout** : l'icône de lama doit être près de l'horloge (sur Mac : dans la barre des menus, voir l'[étape M7](#étape-m7--laisser-ollama-ouvert-sur-mac)).
- Fermer la fenêtre de chat d'Ollama ne l'arrête pas : il continue en arrière-plan. C'est parfait.
- En revanche, **Quit Ollama** (dans le menu de l'icône) l'arrête. JobScout affiche alors « Rien ne répond à l'adresse http://127.0.0.1:11434/v1 : Ollama (local) n'est pas lancé, ou son serveur écoute sur une autre adresse ou un autre port (variable OLLAMA_HOST). … »
- Ollama démarre tout seul avec Windows. Si vous avez désactivé ce démarrage (Gestionnaire des tâches › « Applications de démarrage »), lancez-le depuis le menu Démarrer avant JobScout.
- JobScout alterne entre deux modèles. Si les deux ne tiennent pas ensemble en mémoire, Ollama les recharge à chaque bascule : quelques secondes de plus, c'est normal. Après usage, un modèle reste 5 minutes en mémoire.

### Si c'est lent : vérifier où tourne le modèle

Pendant ou juste après une génération, tapez dans une fenêtre PowerShell (sur Mac : Terminal), pas celle où tourne JobScout :

```powershell
ollama ps
```

Regardez la colonne `PROCESSOR` :

- `100% GPU` : idéal, le modèle tourne sur la carte graphique.
- `100% CPU` : il tourne sur le processeur. Ça marche, mais lentement.
- un partage, par exemple `48%/52% CPU/GPU` : le modèle déborde de la carte graphique. Prenez un modèle plus léger.

**Sur Mac** : avec une puce Apple, `GPU` désigne la partie graphique de la puce, et `100% GPU` reste l'idéal. Sur un Mac Intel, Ollama n'utilise que le processeur : `100% CPU` y est normal, et les réponses sont lentes.

Un modèle trop gros fonctionne quand même, mais très lentement. JobScout l'attend jusqu'à 15 minutes par requête, puis affiche « Ollama (local) n'a pas fini de répondre en 15 minutes… ». Avant la version 3.4.14, la connexion était coupée au bout de 5 minutes et JobScout affichait à tort « Impossible de joindre Ollama ». Les modèles `gemma4` et `qwen3.5` « réfléchissent » avant de répondre, ce qui allonge aussi l'attente.

### Espace disque, mises à jour, désinstallation

- Les modèles sont rangés dans `C:\Users\<votre nom>\.ollama\models` (sur Mac : `~/.ollama/models`, voir [plus bas](#lenteur-place-mise-à-jour-et-désinstallation-sur-mac)). Pour les mettre ailleurs : icône › **Settings** › « Model location » › « Browse ».
- Supprimer un modèle : `ollama rm` suivi de son nom, par exemple `ollama rm gemma4:12b`.
- Mise à jour : quand le menu de l'icône affiche « Restart to update », cliquez dessus.
- Désinstaller : Paramètres Windows › Applications › « Ajouter ou supprimer des programmes » › Ollama. Sur Mac, mettre Ollama à la Corbeille ne suffit pas : voir [plus bas](#lenteur-place-mise-à-jour-et-désinstallation-sur-mac).

> **Sur macOS** : tout est décrit pas à pas juste après, dans « [Sur Mac : Ollama de bout en bout](#sur-mac--ollama-de-bout-en-bout) ».
>
> **Sur Linux** : installez avec `curl -fsSL https://ollama.com/install.sh | sh`. Il n'y a pas d'application de bureau : Ollama tourne en service. S'il ne répond pas, lancez `sudo systemctl start ollama`. Pour le contexte : `sudo systemctl edit ollama`, ajoutez sous `[Service]` la ligne `Environment="OLLAMA_CONTEXT_LENGTH=16384"`, puis lancez `sudo systemctl daemon-reload` et `sudo systemctl restart ollama`.

### Sur Mac : Ollama de bout en bout

Les étapes B1 à B7 montrent Windows. Sur Mac, suivez les étapes M1 à M7 ci-dessous. Les modèles, les commandes et les pièges sont les mêmes ; seuls les gestes changent. La suite, dans JobScout ([section 5](#5-brancher-lia-dans-jobscout)), est identique.

Les vidéos de JobScout sont tournées sous Windows. Pour Ollama sur Mac, suivez ce texte.

| | |
|---|---|
| **Système** | macOS 14 Sonoma ou plus récent. Sur un Mac à puce Apple (M1 et suivantes), Ollama utilise le processeur et la partie graphique de la puce. Sur un Mac Intel, il n'utilise que le processeur : c'est lent |
| **À télécharger** | `Ollama.dmg`, environ 207 Mo (version 0.40.1, le 8 octobre 2026), puis deux modèles, environ 15 Go en tout |
| **Espace disque** | environ 20 Go libres sur le disque du Mac |
| **Pendant l'usage** | Ollama doit tourner : une icône de lama dans la barre des menus, en haut à droite de l'écran |
| **Terminal** | l'application **Terminal** remplace PowerShell |

> **Le clavier du Mac, pour ce guide**
> - Coller : `⌘ + V` (la touche Commande), et non `Ctrl + V`.
> - Tout sélectionner : `⌘ + A`. Effacer : la touche `⌫` (delete), à la place de « Suppr ».
> - Arrêter un programme dans Terminal : `control + C` (la touche control, ⌃). **Pas** `⌘ + C` : sur Mac, ce raccourci copie, il n'arrête rien.

#### Étape M1 — Vérifier votre Mac

1. Cliquez sur le menu Pomme (le logo Apple, en haut à gauche de l'écran), puis sur **À propos de ce Mac**.
2. La fenêtre indique le nom et le numéro de version de macOS. **Il faut la version 14 (Sonoma) ou plus récente.**
3. Elle indique aussi le type de Mac :
   - une ligne **Puce**, suivie du nom de la puce (par exemple « Apple M2 ») : c'est un Mac à puce Apple ;
   - une ligne **Processeur**, suivie d'un nom Intel : c'est un Mac Intel.
4. Notez la quantité de **mémoire**, par exemple « 16 Go ».
5. Choisissez vos modèles avec ce tableau :

| Votre Mac | Modèles à installer | Ce que ça donne |
|---|---|---|
| Puce Apple, 32 Go de mémoire ou plus | `gemma4:12b` (rédaction) et `qwen3.5:9b` (relecture), les modèles par défaut de JobScout | Le meilleur résultat en local |
| Puce Apple, 16 à 24 Go | essayez d'abord les modèles par défaut, puis vérifiez la vitesse (voir « [Si c'est lent](#si-cest-lent--vérifier-où-tourne-le-modèle) ») ; trop lent, passez à `qwen3.5:4b` pour les deux rôles | Ça marche ; la vitesse dépend de la machine |
| Puce Apple, 8 Go | `qwen3.5:4b` pour les deux rôles, ou une IA en ligne ([option A](#2-option-a--une-clé-payante-claude-recommandé)) | Plus léger, mais qualité plus faible |
| Mac Intel | une IA en ligne est conseillée ([option A](#2-option-a--une-clé-payante-claude-recommandé) ; Gemini a une offre gratuite). Ollama fonctionne, mais sur le processeur seul | Lent |
| macOS plus ancien que la version 14 | une IA en ligne ([option A](#2-option-a--une-clé-payante-claude-recommandé)) | Ollama demande macOS 14 ou plus récent |

> Sur un Mac à puce Apple, la mémoire est partagée entre le processeur et la partie graphique : c'est elle qui compte, pas une carte graphique. Ces seuils sont des **repères approximatifs**, pas des mesures faites sur un Mac. Le plus simple : essayez, puis vérifiez la vitesse.

#### Étape M2 — Installer Ollama sur Mac

1. Allez sur [ollama.com/download/mac](https://ollama.com/download/mac).
2. Cliquez sur **Download manually**. Le fichier `Ollama.dmg` se télécharge (environ 207 Mo).
   La page propose aussi une commande `curl … | sh` à coller dans Terminal. Ne la prenez pas : elle exécute un script téléchargé. Le fichier `.dmg` est plus sûr et plus simple.
3. Ouvrez `Ollama.dmg`, dans votre dossier **Téléchargements**. Glissez l'icône d'**Ollama** dans le dossier **Applications**.
4. Ouvrez le dossier **Applications** dans le Finder et double-cliquez sur **Ollama**. macOS vous demande de confirmer l'ouverture d'une app téléchargée sur Internet : confirmez.
5. Des fenêtres en anglais peuvent ensuite s'afficher, dans cet ordre :
   - **« Move to Applications? »** : cliquez sur **Move to Applications**. Cette fenêtre n'apparaît que si Ollama a été ouvert ailleurs que dans Applications, par exemple directement depuis le `.dmg`.
   - **« Ollama is trying to install its command line interface (CLI) tool. »** : saisissez le mot de passe de votre session Mac (celui d'un compte administrateur), puis validez. Cela installe la commande `ollama`, utile à l'étape M5. **N'annulez pas.**
   - **« Welcome to Ollama! »** : passez à l'étape M3.

**C'est réussi si** une petite **icône de lama** apparaît dans la barre des menus, en haut à droite de l'écran. D'après son code source, Ollama se lancera ensuite tout seul à chaque ouverture de session.

Vous ne voyez pas l'icône ? Sur un MacBook dont la caméra est intégrée à l'écran (une encoche noire en haut, au centre), des icônes de la barre des menus peuvent être cachées derrière cette encoche. Vérifiez plutôt qu'Ollama tourne avec l'[étape M4](#étape-m4--vérifier-quollama-tourne-sur-mac).

#### Étape M3 — Le premier écran sur Mac

Les écrans d'Ollama sont les mêmes que sous Windows, avec les mêmes pièges : l'encadré de l'[étape B3](#étape-b3--le-premier-écran-dollama--ne-payez-rien) explique pourquoi **il n'y a rien à payer**. En résumé, avec les gestes du Mac :

1. Écran « Welcome to Ollama! » : cliquez sur **Continue**.
2. Écran « Create an account » : **ne cliquez pas sur « Sign up »**. Cliquez sur le lien en dessous : **No thanks, I'll use Ollama locally**.
3. Écran « Run Ollama » : **ne lancez pas** la commande `ollama` qu'il affiche. Fermez la fenêtre avec le **bouton rouge**, en haut à gauche (ou `⌘ + W`). Ollama continue de tourner : son icône reste dans la barre des menus.
4. Clic sur l'icône de lama dans la barre des menus › **Settings** › désactivez l'interrupteur **Cloud**. Pas de bouton Enregistrer : un petit badge « Saved » s'affiche quelques secondes.
5. Toujours dans **Settings**, laissez « Ollama account — Not connected » tel quel, et laissez **Expose Ollama to the network** désactivé.
6. Propre au Mac : Ollama propose aussi de se relier à d'autres applications, **Claude** et **ChatGPT** (rubrique **Apps** et réglage **Show apps in menu** des Settings ; elles peuvent aussi apparaître en haut du menu de l'icône). JobScout n'en a pas besoin : n'y touchez pas.

**Vous avez déjà tapé `ollama` dans Terminal ?** Rien n'a été payé ni installé. Fermez la fenêtre Terminal (bouton rouge), sans rien choisir dans ses menus. Si Terminal demande une confirmation parce qu'un programme tourne encore, confirmez la fermeture. Pour l'étape M5, vous ouvrirez une nouvelle fenêtre.

*Écrans lus dans le code source d'Ollama 0.40.1, pas vus à l'écran.*

#### Étape M4 — Vérifier qu'Ollama tourne sur Mac

1. Ouvrez votre navigateur (Safari, Chrome…) et tapez l'adresse complète, avec `http://` : **http://127.0.0.1:11434**.
2. **C'est réussi si** la page affiche « Ollama is running ».

Sinon : ouvrez Ollama depuis le dossier **Applications** (ou `⌘ + Espace`, tapez `Ollama`, Entrée), attendez quelques secondes, puis rechargez la page.

#### Étape M5 — Télécharger les modèles dans Terminal

1. Ouvrez une **nouvelle** fenêtre de Terminal. Si Terminal est déjà ouvert (par exemple parce que JobScout y tourne), cliquez dans sa fenêtre puis tapez `⌘ + N` : une fenêtre neuve s'ouvre, avec l'invite `%`. Sinon : `⌘ + Espace`, tapez `Terminal`, Entrée (autre chemin : Finder › dossier **Applications** › **Utilitaires** › **Terminal**). Ne tapez jamais ces commandes dans la fenêtre où tourne JobScout : elles n'y feraient rien.
   Une ligne qui se termine par `%` s'affiche, par exemple `marie@MacBook-Air ~ %` : c'est l'invite de commande. Vous tapez vos commandes juste après.
2. Vérifiez que la commande est reconnue :

   ```bash
   ollama -v
   ```

   C'est réussi si un numéro de version s'affiche. Si Terminal répond `zsh: command not found: ollama`, la commande n'a pas été installée à l'étape M2 (mot de passe annulé). Cliquez sur l'icône de lama › **Quit Ollama**, rouvrez Ollama depuis Applications, saisissez votre mot de passe quand il le demande, puis réessayez.

   **Ne tapez pas `ollama` tout seul**, même si l'écran « Run Ollama » vous le propose (voir l'[étape M3](#étape-m3--le-premier-écran-sur-mac)).

3. Téléchargez le modèle de rédaction. Copiez cette ligne, collez-la dans Terminal (`⌘ + V`), puis appuyez sur Entrée :

   ```bash
   ollama pull gemma4:12b
   ```

   Des barres de progression défilent. **Laissez tourner** jusqu'au retour de l'invite (la ligne qui se termine par `%`). Vous pouvez utiliser le Mac pendant ce temps.

   **C'est réussi si** la dernière ligne avant l'invite est `success`. Une ligne commence par `Error:` (coupure internet, disque plein, faute de frappe) ? Vérifiez la commande, puis relancez-la telle quelle : le téléchargement reprend là où il s'était arrêté.

4. Téléchargez le modèle de relecture, avec le même critère de réussite (`success`) :

   ```bash
   ollama pull qwen3.5:9b
   ```

5. Vérifiez :

   ```bash
   ollama list
   ```

   **C'est réussi si** la colonne `NAME` contient exactement `gemma4:12b` et `qwen3.5:9b`.

**Tailles** : la page d'Ollama donne une fourchette pour chaque modèle. Le 8 octobre 2026 : `gemma4:12b` de 7,7 à 8,0 Go, `qwen3.5:9b` de 6,6 à 7,6 Go, `qwen3.5:4b` de 3,3 à 4,0 Go. La taille téléchargée dépend de votre Mac : elle peut différer un peu des chiffres donnés pour Windows.

Les remarques de l'[étape B5](#étape-b5--télécharger-les-deux-modèles) valent aussi sur Mac : le petit test facultatif, les noms complets (`gemma4` tout court n'est **pas** `gemma4:12b`), les modèles déjà pris dans l'application Ollama, et le modèle unique `qwen3.5:4b` pour un Mac modeste.

#### Étape M6 — Régler le contexte à 16k sur Mac

Pourquoi ce réglage : voir l'[étape B6](#étape-b6--laisser-ollama-lire-un-cv-entier-16k). Sur Mac aussi, JobScout conseille 16 384 jetons, soit « 16k ».

**Méthode simple**

1. Clic sur l'icône de lama dans la barre des menus › **Settings**.
2. Réglage **Context length** : placez le curseur sur **16k**. Pas de bouton Enregistrer : un badge « Saved » s'affiche quelques secondes et Ollama redémarre tout seul.

**Si le curseur est grisé** (méthode de secours)

Le curseur reste grisé tant qu'Ollama n'a pas calculé sa valeur par défaut. La ligne PowerShell de l'étape B6 ne fonctionne pas sur Mac. Voici la méthode que la documentation d'Ollama donne pour son application Mac :

1. Dans une **nouvelle** fenêtre de Terminal (`⌘ + N`), pas dans la fenêtre où tourne JobScout, collez cette ligne puis appuyez sur Entrée :

   ```bash
   launchctl setenv OLLAMA_CONTEXT_LENGTH 16384
   ```

2. Clic sur l'icône de lama › **Quit Ollama**. Fermer la fenêtre ne suffit pas : il faut vraiment quitter.
3. Rouvrez Ollama depuis le dossier **Applications**.

> Choisissez **une seule** méthode. Si vous avez déjà touché le curseur, c'est lui qui l'emporte sur la ligne de commande.
>
> Le réglage fait par `launchctl` pourrait ne pas survivre à un redémarrage du Mac (non vérifié). Après un redémarrage, contrôlez-le comme ci-dessous ; s'il a disparu, refaites les étapes 1 à 3.

**Vérifier, plus tard** : une fois JobScout branché ([section 5](#5-brancher-lia-dans-jobscout)), importez votre CV. Dans les 5 minutes qui suivent, tapez `ollama ps` dans une **nouvelle** fenêtre de Terminal (`⌘ + N`), pas dans celle où tourne JobScout. La colonne `CONTEXT` doit afficher `16384`. Le tableau est vide ? Le modèle a déjà quitté la mémoire : relancez une génération, puis retapez la commande.

#### Étape M7 — Laisser Ollama ouvert sur Mac

- Ollama doit tourner **pendant que vous utilisez JobScout** : l'icône de lama doit être dans la barre des menus.
- Fermer la fenêtre d'Ollama ne l'arrête pas : il continue en arrière-plan. C'est parfait.
- En revanche, **Quit Ollama** (dans le menu de l'icône) l'arrête. JobScout affiche alors « Rien ne répond à l'adresse http://127.0.0.1:11434/v1 : Ollama (local) n'est pas lancé… ».
- Ollama se lance tout seul à l'ouverture de session (d'après son code source). Si ce n'est pas le cas chez vous, ouvrez-le depuis le dossier **Applications** avant JobScout.
- Comme sous Windows, JobScout alterne entre deux modèles : s'ils ne tiennent pas ensemble en mémoire, Ollama les recharge à chaque bascule. Quelques secondes de plus, c'est normal.

#### Lenteur, place, mise à jour et désinstallation sur Mac

- **Lenteur** : tapez `ollama ps` dans Terminal et lisez la colonne `PROCESSOR` (voir « [Si c'est lent](#si-cest-lent--vérifier-où-tourne-le-modèle) »).
- **Où sont les modèles** : dans `~/.ollama/models`. Le signe `~` désigne votre dossier personnel, par exemple `/Users/marie`. Ce dossier est masqué : dans le Finder, menu **Aller** › **Aller au dossier** (`Maj + ⌘ + G`), tapez `~/.ollama`, puis Entrée. Pour ranger les modèles ailleurs : **Settings** › « Model location » › « Browse ».
- **Supprimer un modèle** : `ollama rm` suivi de son nom, par exemple `ollama rm gemma4:12b`.
- **Mise à jour** : quand le menu de l'icône affiche « Restart to update », cliquez dessus.
- **Journaux** : dans `~/.ollama/logs`, fichiers `app.log` (l'application) et `server.log` (le serveur).
- **Désinstaller** : mettre Ollama à la Corbeille **ne supprime pas les modèles**, rangés dans `~/.ollama` (environ 15 Go avec les deux modèles conseillés). Pour tout enlever :
  1. Clic sur l'icône de lama › **Quit Ollama**.
  2. Dans le Finder, glissez **Ollama** du dossier **Applications** vers la Corbeille.
  3. Dans Terminal, collez ces lignes **une par une**, avec Entrée après chacune. Copiez-les plutôt que de les retaper : une espace de trop dans une commande `rm -rf` peut effacer autre chose.

     ```bash
     sudo rm /usr/local/bin/ollama
     rm -rf ~/.ollama
     rm -rf ~/Library/"Application Support"/Ollama
     rm -rf ~/Library/"Saved Application State"/com.electron.ollama.savedState
     rm -rf ~/Library/Caches/com.electron.ollama
     rm -rf ~/Library/Caches/ollama
     rm -rf ~/Library/WebKit/com.electron.ollama
     ```

     La première ligne demande le mot de passe de votre session : les caractères ne s'affichent pas pendant la frappe, c'est normal. La deuxième efface vos modèles. Ces lignes reprennent la procédure officielle d'Ollama, avec une correction : sur sa page, deux lignes placent le `~` entre guillemets, et elles n'effacent alors rien.

## 4. Option C — LM Studio

LM Studio est une autre application gratuite pour faire tourner une IA en local, y compris pour un usage professionnel. Elle a plus de réglages qu'Ollama. Pour JobScout : ni compte, ni clé, ni abonnement.

**Il faut** : Windows 64 bits avec un processeur qui gère les instructions AVX2, 16 Go de mémoire recommandés, 4 Go de mémoire vidéo dédiée recommandés.

**Sur Mac**, il faut une puce Apple et macOS 14 ou plus récent ; les Mac Intel ne sont pas pris en charge. Voir « [Sur Mac : LM Studio](#sur-mac--lm-studio) », à la fin de cette section.

> **Attention au mauvais téléchargement.** Sur [lmstudio.ai/download](https://lmstudio.ai/download), le premier bouton est « Download Bionic for Windows ». Bionic est une **autre** application du même éditeur : un assistant de type « agent », gratuit, avec une option payante (Bionic+, 20 $ par mois) qui ajoute des modèles hébergés. **Ce n'est pas elle qu'il faut pour JobScout.** Descendez jusqu'au bloc « Download LM Studio » et cliquez sur « Download LM Studio for Windows » (suivi du numéro de version, 0.4.25 au 5 octobre 2026). Le fichier pèse environ 620 Mo.

1. Installez LM Studio, puis ouvrez-le. Ignorez la connexion et la création de compte : inutiles en local.
2. Affichez les réglages avancés : `Ctrl + ,` (sur Mac, voir [plus bas](#sur-mac--lm-studio)) › Settings › Developer › activez **Developer Mode**.
3. Téléchargez le modèle de rédaction : onglet **Discover** (raccourci `Ctrl + 2` ; sur Mac, `⌘ + 2`). Cherchez `gemma-4-12b`, choisissez **google/gemma-4-12b** (7,40 Go) et téléchargez-le. Si plusieurs versions s'affichent, prenez **Q4_K_M**.
4. Faites de même pour la relecture avec **qwen/qwen3.5-9b** (7,00 Go). Votre ordinateur a 16 Go de mémoire ? Ne téléchargez qu'un modèle et utilisez-le pour les deux rôles : par défaut, LM Studio ne garde qu'un modèle chargé à la fois, et alterner entre deux serait lent.
5. Allongez le contexte : onglet **My Models**, roue dentée ⚙️ du modèle, **Context Length** = `16384`, puis enregistrez. Faites-le pour chaque modèle. Par défaut, LM Studio s'arrête à 8k, la moitié de ce que conseille JobScout.
6. Démarrez le serveur : onglet **Developer**, interrupteur **Start server**. Dans **Server Settings**, vérifiez :
   - **Server Port** : `1234` ;
   - **Require Authentication** : désactivé ;
   - **Serve on Local Network** : désactivé (sinon d'autres appareils du réseau pourraient y accéder) ;
   - **Just in Time Model Loading** : activé.
7. Vérifiez : ouvrez **http://127.0.0.1:1234/v1/models** dans le navigateur. **C'est réussi si** une liste de modèles s'affiche (du texte au format JSON).
8. Branchez LM Studio dans JobScout : voir la [section 5](#5-brancher-lia-dans-jobscout).

> **Par sécurité pour le contexte**, chargez le modèle vous-même avant d'utiliser JobScout : `Ctrl + L` (sur Mac, voir [plus bas](#sur-mac--lm-studio)), choisissez le modèle, vérifiez que la longueur de contexte est à 16384, puis chargez-le. Rien ne garantit que le chargement automatique reprenne votre réglage.
>
> *Ces libellés viennent de la documentation de LM Studio. Ils peuvent légèrement différer dans votre version.*

### Sur Mac : LM Studio

**Il faut** :

- une **puce Apple** (M1 ou plus récente) : la ligne **Puce** de « À propos de ce Mac » (voir l'[étape M1](#étape-m1--vérifier-votre-mac)) ;
- **macOS 14** ou plus récent ;
- 16 Go de mémoire recommandés. LM Studio indique qu'un Mac de 8 Go peut suffire avec de petits modèles et un contexte modeste : pour JobScout, qui demande un contexte de 16384, préférez alors une IA en ligne.

**Les Mac Intel ne sont pas pris en charge.** Sur un Mac Intel, prenez une IA en ligne ([option A](#2-option-a--une-clé-payante-claude-recommandé)), ou Ollama, qui y fonctionne lentement ([option B](#sur-mac--ollama-de-bout-en-bout)).

1. Sur [lmstudio.ai/download](https://lmstudio.ai/download), téléchargez **LM Studio** pour macOS. Le 8 octobre 2026, le fichier s'appelait `LM-Studio-0.4.25-1-arm64.dmg` et pesait environ 570 Mo.
   Même prudence que sous Windows : **Bionic** est une autre application du même éditeur, ce n'est pas elle qu'il faut. La page montre aussi une commande `curl` pour « llmster », une version de LM Studio sans fenêtre : ne la prenez pas.
2. Ouvrez le fichier `.dmg` et suivez ses indications pour mettre LM Studio dans le dossier **Applications**. Ouvrez-le ensuite depuis ce dossier. macOS vous demande de confirmer l'ouverture d'une app téléchargée sur Internet : confirmez.
3. Suivez ensuite les étapes 1 à 8 ci-dessus. Seuls les raccourcis changent :
   - onglet **Discover** : `⌘ + 2`, d'après la documentation de LM Studio ;
   - réglages (`Ctrl + ,`) et chargement d'un modèle (`Ctrl + L`) : la documentation ne donne pas leur équivalent sur Mac. En principe, `⌘` remplace `Ctrl` (`⌘ + ,` et `⌘ + L`), mais ce n'est pas vérifié. Pour charger un modèle sans raccourci : onglet **Chat**, puis le sélecteur de modèle (« model loader »).
4. **Modèles** : sur Mac, l'onglet **Discover** peut aussi proposer des versions au format **MLX**. Prenez de préférence la version **GGUF** en **Q4_K_M**, celle que décrit ce guide : JobScout n'a pas été testé avec un modèle MLX.
5. Le reste ne change pas : contexte à `16384` pour chaque modèle, serveur sur le port `1234`, vérification à l'adresse **http://127.0.0.1:1234/v1/models**.

> *Configuration requise tirée de la documentation de LM Studio ; nom et taille du fichier relevés le 8 octobre 2026. Les écrans de LM Studio sur Mac n'ont pas été vus.*

## 5. Brancher l'IA dans JobScout

> **En vidéo** : la carte Génération IA est montrée dans le [tutoriel 2 — Mise en place, à partir de 0:11](https://youtu.be/gOMQkcsD6LA?t=11). La vidéo ne parle pas des offres gratuites en ligne (Gemini, Mistral, Groq) : elles sont décrites en [section 2](#2-option-a--une-clé-payante-claude-recommandé).
>
> **Sur Mac** : la vidéo est tournée sous Windows, mais cette partie se passe entièrement dans le navigateur. Elle vaut donc telle quelle sur Mac ; collez seulement la clé avec `⌘ + V`. Le choix d'une IA locale est montré [à partir de 0:39](https://youtu.be/gOMQkcsD6LA?t=39) : sur Mac, Ollama demande macOS 14, et LM Studio une puce Apple.

### Où se trouve la carte « Génération IA »

**Au premier lancement**, l'assistant s'ouvre sur « Étape 1 sur 3 », **Importer**, avec le titre « Commençons par votre profil. ». Le bloc **Génération IA** se trouve au-dessus de la zone de dépôt du CV. Il est ouvert et affiche « À configurer ». Tant que l'IA n'est pas enregistrée, la zone de dépôt indique « Configurez d'abord la génération IA ci-dessus pour débloquer l'import. »

**Plus tard**, cliquez sur **Profil** dans le menu (à gauche, ou dans la barre en bas de l'écran si la fenêtre est étroite), puis faites défiler jusqu'à la section « Paramètres et données ». La carte **Génération IA** est la première. Raccourci, à l'adresse habituelle : http://127.0.0.1:3000/profile#parametres depuis le code source, http://127.0.0.1:3477/profile#parametres avec l'application JobScout pour Mac.

### Ce que contient la carte

- **Fournisseur** : une liste de 10 choix, d'« Anthropic (Claude) » à « Autre (compatible OpenAI) ».
- Sous la liste : un texte d'aide et un lien, « Créer une clé » pour les fournisseurs en ligne, « Télécharger » pour Ollama et LM Studio.
- **Clé API** : pour les fournisseurs en ligne ; facultative pour « Autre ». Il n'y a pas de champ de clé pour Ollama et LM Studio, c'est normal.
- **Adresse du serveur** : seulement pour Ollama, LM Studio et « Autre ». Pour Ollama et LM Studio, laissez la valeur proposée. Pour « Autre », le champ est vide (l'exemple grisé ne compte pas) : saisissez l'adresse de votre serveur, qui se termine en général par `/v1`.
- **Modèle de rédaction (CV, lettre)** et **Modèle de relecture (plus léger)** : ce sont des champs texte, déjà remplis avec les modèles conseillés (sauf pour LM Studio et « Autre », où ils sont vides). Après « Charger la liste », les modèles disponibles s'affichent en suggestions quand vous cliquez dans un champ **vide** ou commencez à taper (sinon, appuyez sur la flèche Bas du clavier). **Pour changer de modèle, effacez d'abord le contenu du champ** (`Ctrl + A` puis `Suppr` ; sur Mac, `⌘ + A` puis la touche `⌫`) : tant qu'un nom y est inscrit, la liste ne propose que les noms qui lui ressemblent. Si la relecture reste vide, JobScout utilise le modèle de rédaction.
- Les boutons **Enregistrer**, **Vérifier**, **Charger la liste**, et **Réinitialiser** une fois l'IA configurée.

### Cas 1 — avec une clé (Claude, OpenAI, Gemini…)

1. **Fournisseur** : choisissez le vôtre, par exemple « Anthropic (Claude) ».
2. **Clé API** : collez votre clé (`Ctrl + V` ; sur Mac, `⌘ + V`). Les caractères sont masqués, c'est normal. Sous le champ s'affiche « La clé reste sur cette machine. »
3. Cliquez sur **Charger la liste**. C'est réussi si le message indique « … modèle(s) disponible(s) chez Anthropic (Claude). »
4. **Modèles** : gardez ceux qui sont déjà inscrits, ce sont les modèles conseillés. Exception : avec OpenRouter, si vous voulez du gratuit, effacez le contenu de chaque champ et choisissez un modèle dont le nom finit par `:free`.
5. Cliquez sur **Vérifier**. C'est réussi si vous lisez « Connexion à Anthropic (Claude) réussie ✓ — … modèle(s) disponible(s) ». Si le message dit « modèle introuvable », effacez le champ concerné et choisissez un modèle proposé dans la liste.
6. Cliquez sur **Enregistrer**. C'est réussi si vous lisez « Anthropic (Claude) activé ✓ » et qu'un badge « Anthropic (Claude) actif » apparaît en haut de la carte.

Ensuite, JobScout n'affiche plus jamais la clé, seulement ses 4 derniers caractères : « Clé enregistrée : …XXXX — laissez vide pour la garder. »

> **« Vérifier » contrôle la clé, pas votre crédit.** Ce bouton se contente de demander la liste des modèles au fournisseur. Avant d'importer votre CV, vérifiez dans la console du fournisseur que votre solde est supérieur à 0 $ (chez Anthropic : Settings > Billing). Si l'import échoue ensuite, pensez d'abord au crédit.

### Cas 2 — avec Ollama

Avant de commencer : Ollama tourne (icône près de l'horloge ; sur Mac, dans la barre des menus) et `ollama list` montre vos modèles ([section 3](#3-option-b--ollama-gratuit-et-local)).

1. **Fournisseur** : choisissez « Ollama (local) ». Il n'y a pas de champ de clé : c'est normal.
2. **Adresse du serveur** : laissez `http://127.0.0.1:11434/v1`.
3. Cliquez sur **Charger la liste**.
   - C'est réussi si le message indique « 2 modèle(s) disponible(s) chez Ollama (local). » (ou plus).
   - Si vous lisez « Ollama (local) répond, mais aucun modèle n'est installé — dans un terminal, tapez « ollama pull gemma4:12b », attendez la fin du téléchargement, puis réessayez. », c'est qu'**aucun modèle n'est téléchargé**. Ne saisissez rien à la main : retournez à l'[étape B5](#étape-b5--télécharger-les-deux-modèles) (sur Mac : [étape M5](#étape-m5--télécharger-les-modèles-dans-terminal)) et lancez `ollama pull …`.
4. **Modèles** : `gemma4:12b` et `qwen3.5:9b` sont déjà inscrits. Si ce sont vos modèles, ne touchez à rien. Sinon :
   - pour changer un modèle, cliquez dans le champ, **effacez son contenu** (`Ctrl + A` puis `Suppr` ; sur Mac, `⌘ + A` puis `⌫`) : la liste de vos modèles s'affiche. Choisissez le nom **exact**, sans l'abréger, par exemple `qwen3.5:4b`, ou `gemma4:latest` pour un modèle pris dans l'application Ollama ;
   - un seul modèle pour les deux rôles (par exemple `qwen3.5:4b`) : mettez-le en rédaction et **videz complètement** le champ de relecture. Sinon, « Vérifier » répondra « modèle introuvable : qwen3.5:9b ».
5. Cliquez sur **Vérifier** : « Connexion à Ollama (local) réussie ✓ — 2 modèle(s) disponible(s) ».
6. Cliquez sur **Enregistrer** : « Ollama (local) activé ✓ ».

> **Avant la version 3.4.14, « Vérifier » pouvait afficher « réussie ✓ » alors qu'aucun modèle n'était installé.** Depuis, « Vérifier » et « Charger la liste » le signalent tous les deux. Dans tous les cas, ce qui compte, c'est que **« Charger la liste » trouve vos modèles**. Sinon, l'import du CV échouera avec « Modèle introuvable chez Ollama (local)… ».

### Cas 3 — avec LM Studio

Avant de commencer : le serveur de LM Studio est démarré ([section 4](#4-option-c--lm-studio), étape 6).

1. **Fournisseur** : choisissez « LM Studio (local) ». Pas de clé.
2. **Adresse du serveur** : laissez `http://127.0.0.1:1234/v1`. Si vous avez changé le port dans LM Studio, mettez le même ici.
3. Cliquez sur **Charger la liste** : « … modèle(s) disponible(s) chez LM Studio (local). »
4. **Pour LM Studio, les champs de modèles sont vides.** Cliquez dans **Modèle de rédaction** et choisissez votre modèle dans les suggestions (par exemple `google/gemma-4-12b`). Pour **Modèle de relecture**, choisissez le second modèle, ou laissez vide pour réutiliser le même. Si un modèle dont le nom commence par `text-embedding` apparaît, ne le choisissez pas.
5. Cliquez sur **Vérifier**, puis sur **Enregistrer** : « LM Studio (local) activé ✓ ».

### Comment savoir que c'est prêt

- Le badge « … actif » s'affiche en haut de la carte.
- Pendant l'assistant, le bloc **Génération IA** passe à « Prête », et la zone **Glissez votre CV ici** se débloque.
- **La vraie preuve, c'est l'import du CV.** « Enregistrer » ne teste pas la connexion : on peut enregistrer un Ollama éteint ou un modèle absent. Si l'import échoue avec un message qui mentionne la Génération IA, un bouton « Ouvrir les réglages de génération IA » vous ramène à la carte.

### Changer de fournisseur, réinitialiser

- Choisir un autre fournisseur dans la liste ne change rien **tant que vous n'avez pas cliqué sur Enregistrer**. Le badge garde l'ancien.
- Chaque fournisseur garde sa clé, son adresse et ses modèles. Si vous revenez à un ancien fournisseur, vous retrouvez ses réglages.
- **Réinitialiser** efface les clés **de tous les fournisseurs**. L'IA n'est alors plus active : l'import du CV se rebloque et les générations échouent tant que vous n'avez pas tout ré-enregistré.

## 6. Problèmes fréquents

Dans les messages ci-dessous, *[fournisseur]* est remplacé à l'écran par le nom de votre fournisseur.

| Ce que vous voyez | Ce que ça veut dire, et quoi faire |
|---|---|
| L'application Ollama demande un compte, propose des modèles `cloud` ou affiche « Cloud models require an Ollama account » | Ce sont les services payants d'Ollama, inutiles ici. Cliquez sur « No thanks, I'll use Ollama locally » et désactivez **Cloud** dans **Settings** ([étape B3](#étape-b3--le-premier-écran-dollama--ne-payez-rien) ; sur Mac : [étape M3](#étape-m3--le-premier-écran-sur-mac)). |
| Le terminal affiche « Sign up / sign in », des modèles marqués « Sign in required » ou « Upgrade required », ou la question « Upgrade to use … ? » | Vous avez tapé `ollama` tout seul, comme le proposait l'écran « Run Ollama ». Rien n'est payé : fermez la fenêtre PowerShell (sur Mac : la fenêtre Terminal) sans rien choisir, ouvrez-en une nouvelle et passez à l'[étape B5](#étape-b5--télécharger-les-deux-modèles) (`ollama pull …` ; sur Mac, [étape M5](#étape-m5--télécharger-les-modèles-dans-terminal)). |
| PowerShell répond que le terme « ollama » n'est pas reconnu | La fenêtre a été ouverte avant l'installation. Fermez-la et ouvrez un **nouveau** PowerShell. Toujours pas ? Fermez votre session Windows, puis réessayez. |
| Sur Mac, Terminal répond `zsh: command not found: ollama` | La commande `ollama` n'a pas été installée : au premier lancement d'Ollama, la demande de mot de passe a été annulée. Clic sur l'icône de lama › **Quit Ollama**, rouvrez Ollama depuis le dossier **Applications**, saisissez votre mot de passe quand il le demande, puis réessayez. Sans compte administrateur, tapez le chemin complet à la place de `ollama`, par exemple `/Applications/Ollama.app/Contents/Resources/ollama pull gemma4:12b`. |
| Sur Mac, Ollama ou LM Studio refuse de s'installer ou de s'ouvrir | Vérifiez votre Mac (menu Pomme › **À propos de ce Mac**, [étape M1](#étape-m1--vérifier-votre-mac)) : les deux demandent macOS 14 ou plus récent, et LM Studio une puce Apple. Sinon, prenez une IA en ligne ([option A](#2-option-a--une-clé-payante-claude-recommandé)). |
| Sur Mac, le curseur **Context length** d'Ollama est grisé | Ollama n'a pas encore calculé sa valeur par défaut. Utilisez la méthode de secours `launchctl` ([étape M6](#étape-m6--régler-le-contexte-à-16k-sur-mac)). |
| Sur Mac, `ollama ps` n'affiche plus `16384` après un redémarrage | Si vous êtes passé par `launchctl`, le réglage a pu disparaître au redémarrage. Refaites les étapes 1 à 3 de la méthode de secours ([étape M6](#étape-m6--régler-le-contexte-à-16k-sur-mac)), ou utilisez le curseur s'il n'est plus grisé. |
| Sur un Mac Intel, `ollama ps` affiche `100% CPU` et tout est lent | C'est normal : sur un Mac Intel, Ollama n'utilise que le processeur. Prenez `qwen3.5:4b` (et videz le champ de relecture), ou une IA en ligne ([option A](#2-option-a--une-clé-payante-claude-recommandé)). |
| `ollama pull` s'arrête sur une ligne qui commence par `Error:` | Coupure internet, disque plein ou faute de frappe. Vérifiez la commande et l'espace disque, puis relancez-la : le téléchargement reprend où il s'était arrêté. |
| « Ollama (local) répond, mais aucun modèle n'est installé — dans un terminal, tapez « ollama pull gemma4:12b », attendez la fin du téléchargement, puis réessayez. » (avant la 3.4.14 : « Ollama (local) n'a renvoyé aucun modèle — saisissez son nom à la main. ») | Aucun modèle n'est téléchargé. Lancez `ollama pull gemma4:12b` et `ollama pull qwen3.5:9b` ([étape B5](#étape-b5--télécharger-les-deux-modèles) ; sur Mac : [étape M5](#étape-m5--télécharger-les-modèles-dans-terminal)). |
| « Modèle introuvable chez Ollama (local) — vérifiez le nom du modèle dans Profil › Génération IA (« Charger la liste »). (détail : model 'gemma4:12b' not found) » | Le modèle n'est pas téléchargé, ou il porte un autre nom. Tapez `ollama list`, puis téléchargez le modèle manquant, ou effacez le champ et choisissez un nom proposé par « Charger la liste ». |
| « Connexion à *[fournisseur]* réussie, mais modèle introuvable : … — choisissez-en un dans la liste. » | Le nom du modèle ne correspond à aucun modèle disponible. Cliquez dans le champ, effacez son contenu (`Ctrl + A` puis `Suppr` ; sur Mac, `⌘ + A` puis `⌫`), puis choisissez un nom proposé. Un seul modèle local ? Videz le champ de relecture. |
| « Rien ne répond à l'adresse http://127.0.0.1:11434/v1 : Ollama (local) n'est pas lancé, ou son serveur écoute sur une autre adresse ou un autre port (variable OLLAMA_HOST). … » | Ollama est arrêté, ou il écoute ailleurs. Lancez-le depuis le menu Démarrer (sur Mac : depuis le dossier **Applications**), puis ouvrez http://127.0.0.1:11434 dans votre navigateur : la page doit afficher « Ollama is running ». Si elle ne s'affiche pas alors qu'Ollama tourne, une variable `OLLAMA_HOST` a changé son adresse ou son port : supprimez-la, ou reportez le même port dans l'adresse du serveur. JobScout et Ollama doivent tourner sur le **même ordinateur** ; ouvrir un port dans le pare-feu n'y change rien. Pour LM Studio, le message ajoute « ou son serveur n'est pas démarré (onglet Developer › Start server) » : démarrez-le dans l'onglet **Developer**. |
| « Ollama (local) a coupé la connexion pendant sa réponse (logiciel fermé ou redémarré, mémoire insuffisante pour ce modèle, antivirus) … » | Ollama s'est arrêté en pleine génération : vous l'avez quitté, un réglage l'a redémarré, ou le modèle ne tient pas en mémoire. Relancez ; si cela se répète, prenez un modèle plus léger (par exemple `qwen3.5:4b`). |
| « Ollama (local) n'a pas fini de répondre en 15 minutes — le modèle est trop lent pour cette machine … » | Tapez `ollama ps` pendant une génération : si vous voyez `CPU`, ou un partage `CPU/GPU`, prenez un modèle plus léger (par exemple `qwen3.5:4b`) pour la rédaction et videz le champ de relecture. |
| « L'adresse https://… commence par https://, mais Ollama (local) répond en http:// … » | Remettez l'adresse par défaut, en `http://` : `http://127.0.0.1:11434/v1`. |
| « Impossible de joindre Ollama (local) à l'adresse … (code …) » | Cause inhabituelle. Vérifiez http://127.0.0.1:11434 dans le navigateur, mettez l'antivirus en pause pour un essai, puis ouvrez une *issue* en indiquant le code entre parenthèses. |
| « Impossible de joindre *[fournisseur]* — vérifiez votre connexion internet puis réessayez. » (avec Claude : « Impossible de joindre le service de génération… ») | Coupure d'internet, ou fournisseur injoignable. Vérifiez votre connexion, puis relancez. |
| « *[fournisseur]* est momentanément indisponible (HTTP 5xx) — réessayez dans un instant. » | Panne passagère chez le fournisseur. Patientez quelques minutes, puis relancez. |
| « Clé API refusée par *[fournisseur]* — vérifiez-la dans Profil › Génération IA. » | Clé mal copiée, supprimée, expirée, ou collée sous le mauvais fournisseur. Recopiez-la en entier, ou créez-en une nouvelle. |
| « Crédit épuisé chez *[fournisseur]* — rechargez votre compte ou changez de fournisseur. » | Rechargez votre crédit sur la console du fournisseur. |
| « Limite atteinte chez *[fournisseur]* (trop de requêtes ou quota épuisé) — patientez quelques minutes ou vérifiez votre crédit. » | Fréquent avec les offres gratuites (Gemini, Groq, modèles `:free` d'OpenRouter). Patientez, puis relancez. Si cela se répète, passez en payant ou changez de fournisseur. Il peut aussi venir d'un plafond de dépenses atteint. |
| « Document ou offre trop volumineux pour *[fournisseur]* — réduisez la taille du CV ou choisissez un modèle à plus grand contexte. » | Avec l'offre gratuite de Groq, c'est probablement une seule demande qui dépasse la limite par minute (non documenté par Groq) : passez en payant ou changez de fournisseur. Ailleurs : le CV ou l'offre est trop long pour le modèle choisi ; prenez un modèle plus capable. |
| « Accès refusé par *[fournisseur]* — votre clé n'a pas accès à ce modèle ou à ce service. » | Choisissez un autre modèle avec « Charger la liste ». Chez OpenAI, certains modèles exigent une vérification de l'organisation. |
| « Erreur de *[fournisseur]* (HTTP …) — vérifiez votre configuration dans Profil › Génération IA. » | Erreur inhabituelle. Vérifiez la clé, le modèle et l'adresse du serveur. Si cela persiste, essayez un autre modèle. |
| Avec Claude : « Erreur du service de génération (HTTP …) — réessayez ; si le problème persiste, vérifiez votre configuration dans Profil › Génération IA. » | Avec Anthropic, JobScout affiche ce même message pour toutes les erreurs. Le numéro vous oriente. **HTTP 400** : plafond de dépenses atteint, ou clé valable pour plusieurs espaces de travail (recréez-la sur le seul « Default Workspace », voir la fiche Claude). **HTTP 401** : clé mal copiée, supprimée ou **expirée** : créez-en une nouvelle. **HTTP 429** : limite de débit, fréquente sur un compte neuf : patientez une minute. Dans tous les cas, vérifiez aussi votre solde (Settings > Billing). |
| Avec Claude : « La génération a dépassé le délai d'attente — relancez-la ; si cela se reproduit, réessayez plus tard. » | Claude n'a pas répondu à temps. Relancez. Une demande interrompue peut être facturée. |
| « *[fournisseur]* n'a pas répondu à temps — relancez la génération ; si cela se reproduit, réessayez plus tard. » | Fournisseur en ligne surchargé. Relancez un peu plus tard. |
| Documents incomplets, réponse « inexploitable », vide ou « tronquée » | Avec Ollama, réglez le contexte à 16k ([étape B6](#étape-b6--laisser-ollama-lire-un-cv-entier-16k) ; sur Mac : [étape M6](#étape-m6--régler-le-contexte-à-16k-sur-mac)) ; avec LM Studio, **Context Length** = 16384. Sinon, choisissez un modèle plus grand ou plus capable. |
| « *[fournisseur]* a refusé la demande — le modèle choisi ne gère peut-être pas les réponses structurées, ou le document est trop long pour lui. … » | Essayez un autre modèle, de préférence un modèle conseillé dans ce guide. |
| « Génération IA non configurée — choisissez un fournisseur d'IA et renseignez votre clé dans Profil › Génération IA. » | Vous n'avez pas cliqué sur **Enregistrer**, ou vous avez cliqué sur **Réinitialiser**. Refaites la [section 5](#5-brancher-lia-dans-jobscout). |
| Le bouton **Enregistrer** reste grisé | Il manque la clé (fournisseur en ligne), le modèle de rédaction ou l'adresse du serveur. |
| « Pour protéger votre clé et votre CV, seule une adresse en https:// est acceptée … » | L'adresse du serveur a été modifiée. Remettez celle par défaut : `http://127.0.0.1:11434/v1` (Ollama) ou `http://127.0.0.1:1234/v1` (LM Studio). Un Ollama installé sur **un autre ordinateur** du réseau n'est pas pris en charge (votre CV y circulerait en clair) : installez-le sur le même ordinateur que JobScout. |
| Votre clé Gemini ne commence pas par `AIza` | C'est normal pour les clés récentes. Collez-la telle quelle. |

Toujours bloqué ? Ouvrez une *issue* sur le dépôt GitHub de JobScout, **sans jamais y coller votre clé ni votre CV** : les issues sont publiques. Si vous joignez les journaux d'Ollama (icône › « View logs » ; sur Mac, les fichiers `app.log` et `server.log` du dossier `~/.ollama/logs`), relisez-les d'abord : ils contiennent des chemins de fichiers de votre ordinateur.

## 7. Confidentialité : où va votre CV

**Avec Ollama ou LM Studio**, à leur adresse par défaut (`127.0.0.1`), votre CV, votre profil et vos documents **ne quittent pas votre ordinateur**. Ollama contacte son site pour télécharger les modèles et les mises à jour et, tant que **Cloud** est activé, pour récupérer sa liste de modèles conseillés (environ toutes les 4 heures, d'après son code source). Jamais avec votre CV. Désactiver **Cloud** ([étape B3](#étape-b3--le-premier-écran-dollama--ne-payez-rien) ; sur Mac : [étape M3](#étape-m3--le-premier-écran-sur-mac)) coupe ce dernier échange. Selon sa politique de confidentialité, LM Studio n'a pas de télémétrie : il vérifie seulement les mises à jour et cherche les modèles que vous demandez. Les scans d'offres, eux, interrogent toujours les sites d'emploi.

**Avec une IA en ligne**, JobScout envoie au fournisseur choisi le texte de votre CV, votre profil (identité comprise : nom, e-mail, téléphone, ville) et l'offre visée. Ensuite, vos données relèvent des règles du fournisseur :

| Fournisseur | Entraînement sur vos données ? | Conservation | À faire |
|---|---|---|---|
| Anthropic (Claude) | non (conditions commerciales de l'API) | supprimées automatiquement sous 30 jours, sauf exceptions (obligation légale, abus…) | rien |
| OpenAI | non, par défaut | journaux anti-abus jusqu'à 30 jours | n'activez pas le partage de données contre des jetons gratuits |
| Google Gemini, offre gratuite | **en France, dans l'EEE, en Suisse et au Royaume-Uni : non**. Ailleurs : oui, et des humains peuvent relire | — | hors d'Europe, préférez l'offre payante |
| Mistral, Free mode | **oui, par défaut** | — | désactivez « Anonymous improvement data » |
| DeepSeek | **oui, par défaut** ; données stockées en Chine | tant que nécessaire | retrait par e-mail à privacy@deepseek.com |
| Groq | non, sauf votre accord (contrat de services de Groq) | pas de conservation par défaut (jusqu'à 30 jours pour diagnostic ou abus) | facultatif : Zero Data Retention dans Data Controls |
| OpenRouter | dépend du fournisseur du modèle choisi | OpenRouter ne garde pas les requêtes par défaut | refusez l'entraînement et la publication dans les réglages de confidentialité |

Vos clés API restent dans la base locale de JobScout, **en clair**. Elles ne sont envoyées qu'au fournisseur choisi. L'éditeur de JobScout ne reçoit rien.

Tout le détail : la [politique de confidentialité](CONFIDENTIALITE.md) (section 4.1, « Le fournisseur d'IA que vous choisissez ») et les [conditions d'utilisation](CGU.md) (section 9, « Fournisseurs d'IA »).

## Sources (consultées le 5 octobre 2026)

- **Anthropic** : [obtenir une clé](https://platform.claude.com/docs/en/get-api-key) · [types de clés, espaces de travail, expiration](https://platform.claude.com/docs/en/manage-claude/authentication) · [limites de débit et de dépense](https://platform.claude.com/docs/en/api/rate-limits) · [codes d'erreur](https://platform.claude.com/docs/en/api/errors) · [se connecter à la Console](https://support.claude.com/en/articles/13371040) · [payer l'API](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage) · [abonnement et API](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-do-i-have-to-pay-separately-to-use-the-claude-api-and-console) · [conservation des données](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) · [conditions commerciales](https://www.anthropic.com/legal/commercial-terms)
- **OpenAI** : [facturation prépayée](https://help.openai.com/en/articles/8264644-setting-up-and-managing-prepaid-api-billing) · [trouver sa clé](https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key) · [ChatGPT et API](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform) · [partage des données](https://help.openai.com/en/articles/10306912-sharing-feedback-evals-and-api-data-with-openai) · [vérification de l'organisation](https://help.openai.com/en/articles/10910291-api-organization-verification) · [plafonds](https://developers.openai.com/api/docs/guides/spend-limits) · [vos données](https://developers.openai.com/api/docs/guides/your-data)
- **Google Gemini** : [clés](https://ai.google.dev/gemini-api/docs/api-key) · [facturation](https://ai.google.dev/gemini-api/docs/billing) · [prix](https://ai.google.dev/gemini-api/docs/pricing) · [quotas](https://ai.google.dev/gemini-api/docs/rate-limits) · [abonnements Google AI](https://ai.google.dev/gemini-api/docs/google-ai-plans) · [conditions](https://ai.google.dev/gemini-api/terms)
- **Mistral** : [créer une clé](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key) · [abonnements](https://docs.mistral.ai/admin/billing-usage/subscriptions) · [facturation](https://docs.mistral.ai/admin/billing-usage/billing) · [limites](https://docs.mistral.ai/admin/billing-usage/usage-limits) · [prix](https://mistral.ai/pricing) · [entraînement et retrait](https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training)
- **DeepSeek** : [documentation](https://api-docs.deepseek.com/) · [prix](https://api-docs.deepseek.com/quick_start/pricing/) · [FAQ](https://static.deepseek.com/faq/index.html?lang=en#/category/4) · [conditions](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) · [confidentialité](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
- **Groq** : [démarrage](https://console.groq.com/docs/quickstart) · [limites](https://console.groq.com/docs/rate-limits) · [facturation](https://console.groq.com/docs/billing-faqs) · [plafonds](https://console.groq.com/docs/spend-limits) · [vos données](https://console.groq.com/docs/your-data) · [contrat de services, section 4.2](https://console.groq.com/docs/legal/services-agreement)
- **OpenRouter** : [FAQ](https://openrouter.ai/docs/faq) · [limites](https://openrouter.ai/docs/api/reference/limits) · [authentification](https://openrouter.ai/docs/api/reference/authentication) · [journalisation des fournisseurs](https://openrouter.ai/docs/guides/privacy/provider-logging)
- **Ollama** (version 0.35.1) : [téléchargement Windows](https://ollama.com/download/windows) · [Windows](https://docs.ollama.com/windows) · [macOS](https://docs.ollama.com/macos) · [Linux](https://docs.ollama.com/linux) · [FAQ](https://docs.ollama.com/faq) · [longueur de contexte](https://docs.ollama.com/context-length) · [commandes](https://docs.ollama.com/cli) · [prix](https://ollama.com/pricing) · [gemma4:12b](https://ollama.com/library/gemma4:12b) · [versions de gemma4](https://ollama.com/library/gemma4/tags) · [qwen3.5:9b](https://ollama.com/library/qwen3.5:9b) · [versions de qwen3.5](https://ollama.com/library/qwen3.5/tags) · [modèles conseillés par l'application](https://ollama.com/api/experimental/model-recommendations) · [code source de l'application](https://github.com/ollama/ollama/tree/v0.35.1/app)
- **LM Studio** (version 0.4.25) : [téléchargement](https://lmstudio.ai/download) · [configuration requise](https://lmstudio.ai/docs/app/system-requirements) · [télécharger un modèle](https://lmstudio.ai/docs/app/basics/download-model) · [serveur local](https://lmstudio.ai/docs/developer/core/server) · [réglages du serveur](https://lmstudio.ai/docs/developer/core/server/settings) · [réglages par modèle](https://lmstudio.ai/docs/app/advanced/per-model) · [prix (dont Bionic)](https://lmstudio.ai/pricing) · [confidentialité](https://lmstudio.ai/app-privacy)
- **Windows** : [Gestionnaire des tâches, affichage condensé](https://learn.microsoft.com/fr-fr/troubleshoot/windows-server/support-tools/support-tools-task-manager)
- **Mac** (consultées le 8 octobre 2026) :
  - **Apple** : [connaître sa version de macOS](https://support.apple.com/fr-fr/109033) · [Mac à puce Apple : la ligne « Puce »](https://support.apple.com/fr-fr/116943) · [ouvrir Terminal](https://support.apple.com/fr-fr/guide/terminal/apd5265185d-f365-44cb-8b09-71a064a42125/mac) · [raccourcis clavier du Mac](https://support.apple.com/fr-fr/102650) · [barre des menus et caméra intégrée à l'écran](https://support.apple.com/en-us/102125)
  - **Ollama** (version 0.40.1) : [macOS : configuration, fichiers, désinstallation](https://docs.ollama.com/macos) · [téléchargement Mac](https://ollama.com/download/mac) · [FAQ : variables d'environnement avec `launchctl`](https://docs.ollama.com/faq) · [versions de gemma4](https://ollama.com/library/gemma4/tags) · [versions de qwen3.5](https://ollama.com/library/qwen3.5/tags) · [code source de l'application Mac](https://github.com/ollama/ollama/tree/v0.40.1/app)
  - **LM Studio** : [configuration requise](https://lmstudio.ai/docs/app/system-requirements) · [télécharger un modèle (raccourci `⌘ + 2`)](https://lmstudio.ai/docs/app/basics/download-model) · [téléchargement](https://lmstudio.ai/download)

En utilisant JobScout, vous acceptez ses [conditions d'utilisation](CGU.md). Vos données : [politique de confidentialité](CONFIDENTIALITE.md).
