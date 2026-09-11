# Job Scout V3

Trouvez le job de vos rêves grâce au scan multi-plateformes et à la génération de CV / lettres de motivation calibrés par IA (compatibles ATS).

> Site, guide de démarrage et version Pro (installeur Windows, 200 dossiers IA inclus) :
> **https://latenightsbeats1208-pixel.github.io/jobscout/**

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** + **Tailwind**
- **Anthropic Claude** — Opus 4.8 (extraction CV, génération CV/LM), Sonnet 5 (volume : MSG V.I.E)
- **SQLite** intégré (`node:sqlite`, WAL) + filesystem local
- **Scraping** : `fetch` + parsing DOM (`jsdom`) + JSON-LD `JobPosting` ; Playwright uniquement pour LinkedIn
- **@react-pdf/renderer** + **docx** pour les documents générés ; **xlsx** pour l'import/export candidatures

## Installation

```bash
npm install
npx playwright install chromium   # nécessaire uniquement pour la source LinkedIn
cp .env.example .env               # puis collez votre clé ANTHROPIC_API_KEY
npm run dev
```

L'app démarre sur http://localhost:3000. Sous Windows, `scripts/Start-JobScout.ps1` lance le serveur de développement et ouvre le navigateur automatiquement.

Requiert **Node ≥ 22.5** (module `node:sqlite`).

## Paquet Windows

`npm run package` produit `installer/output/JobScout_Setup_<version>.exe` : un
installeur autonome (Node 22 LTS embarqué, aucune dépendance sur la machine
cible), avec launcher natif, données sous `%LOCALAPPDATA%\JobScout` et contrôle
anti-fuite de données personnelles bloquant. Voir [`installer/README.md`](installer/README.md).

## Les 7 sources de scan

| Source | Méthode | Périmètre |
|--------|---------|-----------|
| Welcome to the Jungle | sitemap.xml.gz → fiche détail → JSON-LD | International |
| LinkedIn | Playwright (guest API) | International (tous pays cibles) |
| Civiweb (V.I.E) | API JSON Business France | International |
| APEC | API `rechercheOffre` + détail SEO (bot UA) | France (cadres) |
| HelloWork | HTML SSR + JSON-LD | France |
| France Travail | API officielle (si clés) sinon HTML SSR | France |
| Talent.com | HTML SSR multi-domaines + JSON-LD | France, Belgique, Suisse, Luxembourg, Canada, USA, Maroc, Tunisie, Sénégal |

Chaque source est activable/désactivable par l'utilisateur (onglet Préférences). Une source hors périmètre géographique (ex. APEC quand l'utilisateur ne cible pas la France) est automatiquement sautée.

> Note : la disponibilité des sources dépend des sites tiers (anti-bot, changements d'API). Civiweb requiert désormais une authentification côté Business France — les sources France (APEC/HelloWork/France Travail/Talent) sont les plus fiables à ce jour.

## Scoring des offres (local, déterministe, gratuit)

`lib/scoring/local.ts` — 6 critères exposés dans le détail de l'offre :

- **Secteur** (30 %) — match titre + description vs secteurs cibles
- **Compétences** (50 %) — match skills, avec corrélation : une compétence ancrée dans une expérience pèse davantage qu'une compétence simplement listée
- **Pays** (20 %) — match pays de l'offre vs pays cibles
- **Contrat** (±10) — CDI +10, CDD +7, V.I.E neutre (option conservée), stage/alternance ≈ −8
- **Bonus Langue** (+8) — offre rédigée dans une langue maîtrisée (B2+)
- **Bonus Durée V.I.E** (+5) — mission 12–24 mois (V.I.E uniquement)

Aucun appel API : instantané et sans coût de tokens. Re-scoring global : `POST /api/offres/rescore` (après modification du profil ou du moteur).

## Pipeline d'extraction CV

Cascade selon le type de fichier : PDF (`pdf-parse` vs `pdfjs-dist` multi-colonnes, meilleur retenu), DOCX (`mammoth`), image (`tesseract.js` FR+EN), TXT. Puis extraction sémantique via Claude Opus (tool use forcé), validation Zod, score de confiance et **garde-fou anti-hallucination** (suppression des entreprises/compétences non ancrées dans le profil).

## Génération de documents

`data/documents/…` — CV + LM en PDF **et** DOCX, avec boucle de rétrécissement garantissant 1 page A4 ATS-friendly. MSG (message court) réservé aux offres V.I.E.

## Sécurité (durcissements V3)

- Whitelist de colonnes sur la mise à jour des candidatures (anti mass-assignment / injection de nom de colonne)
- Bornage des chemins d'écriture du dossier documents (répertoire utilisateur / projet uniquement)
- Ouverture de dossier restreinte au dossier documents configuré
- `rel="noopener noreferrer"` forcé sur tous les liens sortants des descriptions (sanitizées via DOMPurify)

## Roadmap commercialisation

Multi-tenant (table `users`, cloisonnement par `user_id`), authentification, facturation Stripe avec quota côté serveur, proxy LLM avec token par utilisateur, conformité RGPD (consentement, chiffrement au repos, droit à l'effacement), migration `node:sqlite` → Postgres pour le SaaS.

## Gratuit ou Pro

| | Gratuit (ce dépôt) | Pro |
|---|---|---|
| Scan 7 sources + scoring local | illimité | illimité |
| CV / lettre / message IA | avec **votre** clé Anthropic (`ANTHROPIC_API_KEY` dans `.env`, ≈ 5 € les 100 dossiers) | 200 dossiers inclus via le proxy JobScout, sans clé |
| Installation | Node ≥ 22.5 + `npm install` | installeur Windows autonome |
| Mises à jour | `git pull` | notification dans l'application |

Le code est identique : la version Pro n'a aucune fonction cachée. Les modes IA (`lib/ai/client.ts`) : `byok`
(votre clé), `pack` (clé de licence → proxy), `unset` (scan et scoring seulement).

## Licence

MIT — voir [`LICENSE`](LICENSE). Les marques des sites scannés appartiennent à leurs propriétaires ; JobScout
n'est affilié à aucun d'eux.
