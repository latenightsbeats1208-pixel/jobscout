# Conditions générales d'utilisation de JobScout

**Version du 21 octobre 2026 · JobScout 3.4.17**

Ces conditions expliquent ce qu'est JobScout, ce que vous pouvez en faire et qui est responsable de quoi. Elles complètent la licence du code ([LICENSE](LICENSE)) et la politique de confidentialité ([CONFIDENTIALITE.md](CONFIDENTIALITE.md)).

Elles ne constituent pas un conseil juridique. L'éditeur ne peut pas vous dire si un usage précis est permis dans votre situation.

## L'essentiel

- JobScout est un logiciel libre et gratuit qui tourne sur votre ordinateur. Pas de compte, pas d'abonnement, pas de serveur de l'éditeur.
- JobScout n'envoie aucune de vos données à l'éditeur. L'éditeur ne collecte, ne stocke et ne revend aucune offre.
- C'est vous qui lancez les recherches, depuis votre ordinateur et votre connexion. Vous choisissez les sites interrogés et vous devez respecter leurs conditions.
- Par défaut, seule France Travail est cochée. Sans identifiants d'API, elle charge les pages du site comme un navigateur (section 6). Les conditions de Welcome to the Jungle, HelloWork, Talent.com et LinkedIn interdisent l'extraction automatisée : ces sources restent décochées, et c'est à vous de décider de les activer. Lisez les sections 5 et 6 avant de le faire.
- Les offres récupérées ne doivent servir qu'à votre propre recherche d'emploi, sans but commercial.
- Les documents rédigés par l'IA peuvent contenir des erreurs. Relisez-les avant de les envoyer.
- JobScout est fourni « en l'état », sans garantie.

## 1. Éditeur, hébergeur et contact

- **Éditeur** : Late Nights Tools. L'éditeur agit à titre non professionnel, sous pseudonyme. Comme le permet l'article 1-1, II de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique (LCEN), seuls le nom et l'adresse de l'hébergeur sont indiqués ci-dessous.
- **Hébergeur du dépôt** : GitHub, Inc., 88 Colin P. Kelly Jr. St., San Francisco, CA 94107, États-Unis (https://github.com).
- **Contact** : les [issues du dépôt](https://github.com/latenightsbeats1208-pixel/jobscout/issues), c'est-à-dire ses tickets de discussion publics. Il faut un compte GitHub pour en ouvrir une. Elles sont publiques : n'y mettez aucune donnée personnelle.

Dans ce document, « l'éditeur » désigne Late Nights Tools. « Vous » désigne la personne qui installe ou utilise JobScout.

## 2. Ce qu'est JobScout

JobScout est un logiciel de recherche d'emploi. Il permet de :

- chercher des offres sur plusieurs sites d'emploi (section 6) ;
- les classer avec un score calculé sur votre ordinateur, à partir de votre profil ;
- les filtrer par distance autour d'une ville que vous choisissez, avec un calcul fait sur votre ordinateur (distances à vol d'oiseau, données géographiques incluses dans le logiciel) ;
- créer votre profil à partir de votre CV, puis rédiger un CV, une lettre de motivation ou, pour les offres de V.I.E (volontariat international en entreprise), un message court, avec le fournisseur d'IA de votre choix (section 9) ;
- suivre vos candidatures.

**Ce que JobScout est :**

- un logiciel libre (licence MIT) et gratuit ;
- un programme qui s'exécute sur votre ordinateur, avec une base de données locale (SQLite) et un serveur joignable uniquement depuis votre machine (adresse `127.0.0.1`).

**Ce que JobScout n'est pas :**

- un service en ligne : il n'y a ni compte à créer ni serveur de l'éditeur ;
- un site d'offres ni un agrégateur public : l'éditeur n'héberge, ne collecte, ne stocke et ne revend aucune offre. Votre copie de JobScout récupère les offres et les enregistre sur votre disque ;
- un intermédiaire de recrutement : JobScout n'envoie aucune candidature à votre place. C'est vous qui postulez, sur le site de l'offre.

## 3. Licence MIT et conditions d'utilisation

- Le fichier [LICENSE](LICENSE) (licence MIT) fixe vos droits sur le code. Vous pouvez l'utiliser, le copier, le modifier et le redistribuer, à condition de conserver la mention de copyright et le texte de la licence.
- Ces conditions encadrent l'usage du logiciel : ce que vous faites des offres, la façon dont vous interrogez les sites tiers et votre usage de l'IA. La licence ne traite pas ces questions.
- En cas de conflit sur les droits sur le code, la licence MIT prévaut.
- La clause d'absence de garantie de la licence s'applique aussi. Les sections 10 et 11 la précisent au regard du droit français.
- L'éditeur ne publie pas les versions modifiées ou redistribuées par d'autres personnes. Chacune engage la responsabilité de celui qui la diffuse.

Ces conditions sont publiées dans le dépôt, à côté du code, et accessibles depuis le README. En utilisant JobScout après en avoir pris connaissance, vous les acceptez. Si vous ne les acceptez pas, n'utilisez pas JobScout.

## 4. Usage autorisé et interdits

JobScout est conçu pour votre propre recherche d'emploi. Les offres récupérées et les sites interrogés ne doivent servir qu'à cela, **à titre personnel et non commercial**. Les conditions de plusieurs de ces sites limitent d'ailleurs l'usage de leurs offres à un cadre personnel.

Il est interdit :

- de revendre, louer, publier ou rediffuser les offres récupérées, en tout ou en partie (site web, fichier, flux, base partagée) ;
- de constituer un fichier de recruteurs, d'entreprises ou de contacts. Les noms et coordonnées présents dans une offre servent seulement à votre candidature à cette offre ;
- de faire de la prospection commerciale ou du démarchage ;
- de récupérer ou d'exploiter des offres pour le compte d'autres personnes, à titre professionnel (cabinet de recrutement, agence, accompagnement payant, service de veille, etc.). Dans ce cadre, le RGPD pourrait en outre s'appliquer à vous ;
- de contourner une mesure technique de protection d'un site (CAPTCHA, blocage d'adresse IP, authentification, limite de requêtes), par exemple en modifiant JobScout ;
- de lancer des scans trop fréquents ou trop volumineux, par exemple en les automatisant, en relevant les plafonds dans une version modifiée ou en faisant tourner plusieurs copies en même temps ;
- de produire de faux diplômes, de fausses expériences ou de fausses références, ou de se servir de JobScout pour toute autre activité illégale.

Ces interdits portent sur l'usage des offres et des sites tiers. Ils ne retirent aucun des droits que la licence MIT vous donne sur le code (section 3).

**Attention** : la section 6 décrit les méthodes du code publié qu'un site pourrait considérer comme contraires à ses conditions, en particulier pour Welcome to the Jungle. Cette source est décochée par défaut : ne l'activez qu'après avoir lu ces explications.

## 5. Les sites d'offres : qui fait quoi

**Votre rôle**

- Vous lancez chaque scan vous-même, depuis la page Offres. JobScout ne lance jamais de scan tout seul.
- Les requêtes partent de votre ordinateur, avec votre adresse IP. Les sites voient cette adresse et peuvent la limiter ou la bloquer.
- Elles contiennent vos secteurs, utilisés comme mots-clés, et, selon le site, le pays visé. Elles ne contiennent ni votre nom, ni votre CV, ni les cookies de votre navigateur.
- Vous choisissez les sources à l'étape Préférences de l'inscription, puis dans **Profil › Recherche › Sources**. Le bouton « Lancer un scan » interroge les sources cochées.
- Sur la page Offres, la flèche à côté de « Lancer un scan » ouvre le menu « Scanner une source ». Ce menu permet d'interroger une seule source, **même si elle est décochée** (sauf les sources suspendues).
- Vous devez respecter les conditions d'utilisation de chaque site que vous interrogez. Celles de Welcome to the Jungle, HelloWork, Talent.com et LinkedIn interdisent expressément l'extraction automatisée (section 6). Si vous activez l'une de ces sources, ou si vous la choisissez dans « Scanner une source », vous le faites en connaissance de cause et sous votre responsabilité.

**Ce qui est coché par défaut**

Depuis la 3.4.13, sur une installation neuve, seule France Travail est cochée. Welcome to the Jungle, HelloWork, Talent.com et LinkedIn sont décochées : à vous de les activer, après avoir lu leurs conditions. LinkedIn demande en plus l'installation d'un moteur de navigation. L'APEC et Civiweb sont suspendues : JobScout ne les interroge plus, même si elles sont restées cochées dans un ancien profil.

Si votre profil ne contient aucune source (profil restauré, par exemple), « Lancer un scan » interroge France Travail seule.

**Profils créés avant la 3.4.13** : les sources que vous aviez cochées le restent. Le changement de réglage par défaut ne les décoche pas. Vérifiez vos choix dans **Profil › Recherche › Sources**.

**Ce que fait JobScout pour limiter le volume**

- Chaque source a un plafond : un nombre limité de pages de résultats et d'offres par scan.
- La plupart des sources font une pause entre deux requêtes. Welcome to the Jungle n'en fait pas, mais n'envoie que quelques requêtes par secteur.
- La plupart des sources s'arrêtent après une série d'échecs consécutifs.
- Plus vous ciblez de secteurs et de pays, plus il y a de requêtes.
- JobScout ne limite pas le nombre de scans que vous lancez. C'est à vous de garder un rythme raisonnable.

**Ce que JobScout ne fait pas**

- Il ne se connecte à aucun compte d'utilisateur sur ces sites. La seule exception est l'API France Travail, et seulement si vous fournissez vos propres identifiants.
- Il n'utilise pas les cookies de votre navigateur et ne résout pas de CAPTCHA.
- Il ne consulte pas les fichiers `robots.txt` des sites. Certaines adresses qu'il interroge y sont pourtant exclues. Par exemple, le `robots.txt` de HelloWork exclut des pages d'offres, et celui de LinkedIn déclare interdit tout accès automatisé sans autorisation.

## 6. Les sources, une par une

Pour chaque source, vous trouverez son réglage par défaut, ce que fait JobScout et ce que disent les conditions du site, lues le 5 octobre 2026 sauf mention contraire. Ce résumé peut être dépassé, car les sites modifient leurs conditions. Seul le texte publié par chaque site fait foi : lisez-le.

En bref : les conditions de LinkedIn, Welcome to the Jungle, HelloWork et Talent.com interdisent expressément l'extraction automatisée. Celles de l'APEC interdisent l'exploitation de ses contenus sans son accord. Aucune interdiction expresse des robots n'a été relevée dans celles de France Travail, mais France Travail prévoit son API pour l'accès par programme.

### Welcome to the Jungle

- **Par défaut** : décochée, à activer vous-même.
- **Ce que fait JobScout** : il ne charge aucune page du site. Il interroge directement l'index de recherche qui alimente le site (service Algolia), avec la clé de recherche présente dans les pages du site, en indiquant `welcometothejungle.com` comme provenance. Voir « Méthodes à connaître » ci-dessous.
- **Conditions du site** : [conditions générales](https://www.welcometothejungle.com/fr/pages/terms). Elles interdisent l'extraction automatisée par logiciel, script ou robot, sauf pour les moteurs de recherche (art. 10). Elles limitent l'accès à un usage personnel (art. 19.2).

### LinkedIn

- **Par défaut** : décochée. Il faut aussi installer le moteur Chromium (bouton « Installer le moteur LinkedIn »).
- **Ce que fait JobScout** : il ouvre, sans compte, les pages publiques d'offres (« jobs-guest ») dans un navigateur Chromium piloté par le programme, qui se présente comme un navigateur Chrome ordinaire.
- **Conditions du site** : [conditions d'utilisation](https://www.linkedin.com/legal/user-agreement) (section 8.2) et [conditions d'exploration](https://www.linkedin.com/legal/crawling-terms). Elles interdisent les robots, les scripts et l'extraction de données sans autorisation expresse. Elles disent s'appliquer aussi aux simples visiteurs.

### APEC

- **Par défaut** : suspendue depuis la 3.4.13. Elle ne peut plus être cochée.
- **Ce que fait JobScout** : rien. Le site bloque désormais les requêtes automatiques, et JobScout ne l'interroge plus, même si elle est restée cochée dans un ancien profil.
- **Conditions du site** : [informations légales de l'Apec](https://corporate.apec.fr/home/informations-legales-et-conditio.html). Elles interdisent de reproduire ou d'exploiter les contenus sans accord préalable de l'Apec.

### HelloWork

- **Par défaut** : décochée, à activer vous-même. JobScout ne l'interroge que si votre profil cible la France ou ne cible aucun pays.
- **Ce que fait JobScout** : il charge les pages de résultats, puis la page de chaque offre, en se présentant comme un navigateur Chrome.
- **Conditions du site** : [conditions générales](https://www.hellowork-group.com/fr/legal/cgu-hellowork/). Elles interdisent l'extraction automatisée et considèrent tout logiciel qui accède au site comme un utilisateur non légitime (art. 1 et 8.2). Elles limitent l'usage à des fins privées et non commerciales.

### France Travail

- **Par défaut** : cochée. JobScout ne l'interroge que si votre profil cible la France ou ne cible aucun pays.
- **Ce que fait JobScout** :
  - par défaut, sans identifiants : il charge les pages de résultats, puis la page de chaque offre de `candidat.francetravail.fr`, en se présentant comme un navigateur Chrome ;
  - si vous indiquez vos propres identifiants de l'API « Offres d'emploi » (`FT_CLIENT_ID` et `FT_CLIENT_SECRET` dans le fichier `.env`) : il passe d'abord par l'API officielle. Si l'API ne renvoie aucune offre (identifiants refusés, erreur ou aucun résultat), JobScout revient automatiquement, sans vous prévenir, aux pages de `candidat.francetravail.fr`, comme sans identifiants.
- **Conditions du site** : [conditions générales](https://www.francetravail.fr/informations/informations-legales-et-conditio/conditions-generales-dutilisatio.html). Aucune interdiction expresse des robots n'y a été relevée. France Travail prévoit son API pour l'accès par programme : le chargement des pages, utilisé par défaut, sort de ce cadre. L'API dépend des conditions de [francetravail.io](https://francetravail.io), que vous acceptez en créant votre accès. Ces conditions n'ont pas pu être consultées.

### Talent.com

- **Par défaut** : décochée, à activer vous-même.
- **Ce que fait JobScout** : il charge les pages de résultats des sites nationaux qui correspondent à vos pays cibles (France si vous n'en indiquez aucun). Il charge ensuite la page de chaque offre, en se présentant comme un navigateur Chrome.
- **Conditions du site** : [Terms of Service](https://ca.talent.com/en/tos), en anglais, lues sur le site canadien. Elles interdisent le « scraping » et les robots qui envoient plus de requêtes qu'un humain (section C.5). Les conditions des autres sites nationaux, dont `fr.talent.com`, n'ont pas été vérifiées.

### Civiweb (V.I.E, Business France)

- **Par défaut** : suspendue. Elle ne peut plus être cochée.
- **Ce que fait JobScout** : rien. Le service de recherche de Business France exige désormais une authentification, et JobScout ne la gère pas. Depuis la 3.4.13, JobScout ne l'interroge plus, même si elle est restée cochée dans un ancien profil.
- **Conditions du site** : [mentions légales](https://mon-vie-via.businessfrance.fr/FR/mentions-legales.aspx), non consultées.

### Méthodes à connaître

- **Navigateur imité.** Pour LinkedIn, HelloWork, Talent.com et les pages de France Travail, JobScout se présente comme un navigateur Chrome ordinaire. Il ne se signale pas comme un logiciel automatique.
- **Welcome to the Jungle.** JobScout utilise la clé de recherche présente dans les pages du site. Welcome to the Jungle ne propose pas cette clé aux tiers comme une API. D'après les notes du code (`lib/scrapers/wttj.ts`), les pages d'offres du site imposent depuis l'été 2026 un contrôle anti-robot. La clé est écrite dans le code. Si Welcome to the Jungle la change ou la retire, la source cessera de fonctionner. N'en cherchez pas une autre : décochez la source.

Ces sites peuvent considérer ces méthodes, en particulier l'usage de la clé de Welcome to the Jungle, comme contraires à leurs conditions ou comme le contournement d'une restriction, ce que la section 4 vous interdit. Welcome to the Jungle, HelloWork, Talent.com et LinkedIn sont décochées par défaut : si vous ne voulez pas prendre ce risque, laissez-les décochées et ne les choisissez pas dans « Scanner une source ». France Travail, seule source cochée par défaut, charge ses pages en se présentant comme Chrome, sauf si vous fournissez vos identifiants d'API : pour rester dans le cadre prévu par France Travail, utilisez l'API ou décochez la source.

## 7. Demande de retrait par un site

Vous représentez l'un de ces sites et vous voulez que JobScout cesse de l'interroger ? Voici la marche à suivre :

1. Ouvrez une issue sur le dépôt, intitulée « Demande de retrait – nom du site ».
2. Indiquez le site concerné, votre qualité (en quoi vous agissez pour ce site), la mesure demandée (retrait de la source, désactivation par défaut ou autre) et son fondement (conditions d'utilisation, droit invoqué).
3. L'éditeur examine de bonne foi chaque demande et s'efforce d'y répondre dans les 30 jours.

L'issue est publique : inutile d'y indiquer votre nom ou vos coordonnées personnelles. Précisez seulement pour quel site vous agissez (par exemple : service juridique de ce site).

La mesure retenue s'applique aux versions publiées ensuite. Elle ne peut pas modifier les copies déjà installées, ni celles que des tiers ont faites du code. Cette procédure ne remplace pas les recours prévus par GitHub ou par la loi.

## 8. Marques et absence d'affiliation

- JobScout n'est affilié à aucun des sites ni à aucun des fournisseurs cités. Aucun d'eux ne l'approuve ni ne le soutient.
- LinkedIn, Welcome to the Jungle, APEC, HelloWork, France Travail, Talent.com, Civiweb, Business France, Anthropic, Claude, OpenAI, Google, Gemini, Mistral, DeepSeek, Groq, OpenRouter, Ollama, LM Studio, Algolia, Chrome, Chromium, Playwright, Next.js, SQLite et GitHub, ainsi que les autres noms de produits et de services cités, sont des marques ou des noms de leurs titulaires respectifs.
- Ces noms servent seulement à désigner les sites interrogés et les services compatibles.
- JobScout n'utilise pas leurs logos.

## 9. Fournisseurs d'IA

- JobScout ne fournit pas d'IA. Vous choisissez un fournisseur : Anthropic (Claude), OpenAI, Google Gemini, Mistral, DeepSeek, Groq, OpenRouter, un modèle local (Ollama, LM Studio) ou un autre serveur compatible.
- Sauf avec un modèle local, vous utilisez votre propre compte et votre propre clé. Vous acceptez les conditions d'utilisation et la politique de confidentialité de ce fournisseur, et vous payez ses tarifs.
- En version source lancée avec `npm run dev`, si aucun fournisseur n'est réglé dans JobScout, une variable `ANTHROPIC_API_KEY` présente sur votre ordinateur ou dans le fichier `.env` est utilisée automatiquement. Vos données partent alors chez Anthropic, sur cette clé. Supprimez la variable si vous ne le voulez pas.
- Voici ce qui est envoyé au fournisseur : le texte de votre CV quand vous l'importez, puis votre profil (identité comprise : nom, e-mail, téléphone, ville, liens) et l'offre quand vous générez des documents. Le détail figure dans [CONFIDENTIALITE.md](CONFIDENTIALITE.md).
- Avec un modèle local (Ollama, LM Studio) à son adresse par défaut (`127.0.0.1`), ces données restent sur votre ordinateur. Si vous indiquez l'adresse d'un autre ordinateur, elles partent vers lui.
- Votre clé est enregistrée **en clair, sans chiffrement**, dans la base locale (ou dans le fichier `.env`, si vous l'y avez mise). Elle n'est envoyée qu'au fournisseur choisi. Protégez l'accès à votre session et ne partagez pas votre dossier de données.
- Les contenus générés peuvent contenir des erreurs : fautes, oublis, traductions approximatives ou affirmations que votre profil ne justifie pas. JobScout a des garde-fous contre les inventions, mais ils ne suppriment pas ce risque. Relisez et corrigez chaque document avant de l'envoyer. Vous êtes l'auteur de vos candidatures et vous en êtes responsable.
- Le score des offres est calculé sur votre ordinateur par des règles simples, sans IA. Il sert à trier les offres, il ne juge pas vos chances.

## 10. Absence de garantie

JobScout est fourni gratuitement et « en l'état », comme le prévoit la licence MIT. Dans la limite permise par la loi, l'éditeur ne garantit pas :

- que JobScout fonctionne sans erreur ni interruption, ni qu'il répond à votre besoin ;
- qu'une source reste disponible. Un site peut changer, limiter ou bloquer l'accès à tout moment, et une source peut cesser de fonctionner, comme Civiweb ;
- que les offres sont exactes, à jour ou sérieuses : elles viennent de sites tiers. Une offre peut être expirée, erronée ou frauduleuse. Ne payez jamais pour postuler et ne donnez jamais vos coordonnées bancaires ;
- que les documents générés sont exacts ;
- le résultat de vos candidatures.

Pensez à sauvegarder votre dossier de données.

## 11. Responsabilité

- Vous êtes responsable de votre usage de JobScout : sources que vous activez ou que vous interrogez une à une (les réglages par défaut sont décrits à la section 5), rythme des scans, respect des conditions des sites et des fournisseurs d'IA, contenu de vos candidatures, protection de votre ordinateur et de vos clés.
- Dans la limite permise par la loi, l'éditeur n'est pas responsable des dommages qui résultent :
  - de l'utilisation de JobScout, ou de l'impossibilité de l'utiliser ;
  - d'une perte de données ;
  - d'un blocage ou d'une réclamation d'un site tiers, liés à votre usage ;
  - des sommes facturées par votre fournisseur d'IA ;
  - d'une erreur dans une offre ou dans un document généré.
- Cette limitation ne s'applique jamais en cas de faute intentionnelle (dol) ou de faute lourde de l'éditeur. Elle ne s'applique pas non plus aux dommages corporels, ni à aucune responsabilité que la loi interdit d'exclure ou de limiter.

## 12. Données personnelles

Le détail figure dans la politique de confidentialité, [CONFIDENTIALITE.md](CONFIDENTIALITE.md). En bref :

- JobScout n'envoie aucune de vos données à l'éditeur. Il n'y a ni compte, ni serveur de l'éditeur, ni mesure d'audience, ni télémétrie propre à JobScout. L'éditeur ne voit que ce que vous publiez vous-même sur GitHub (issues, pull requests : section 13).
- Vos données sont enregistrées sur votre ordinateur : profil, texte du CV, offres, candidatures, documents et clés d'API.
- Certaines en sortent, quand vous agissez :
  - les recherches envoyées aux sites d'offres pendant un scan (secteurs, pays visé selon le site, adresse IP) ;
  - les données envoyées au fournisseur d'IA choisi (section 9) ;
  - vos identifiants France Travail, si vous en fournissez, envoyés au serveur d'authentification de France Travail (`entreprise.francetravail.fr`) ;
  - des téléchargements techniques : le moteur Chromium pour LinkedIn, depuis les serveurs de Playwright ; les modèles de reconnaissance de texte, depuis `cdn.jsdelivr.net`, si vous importez un CV au format image ; en version source, les dépendances téléchargées à l'installation par `npm ci`.
- Next.js, le cadre logiciel sur lequel repose JobScout, envoie des statistiques d'usage anonymes quand on lance `next dev` ou `next build`. `npm run dev`, `npm run build`, `scripts/Start-JobScout.ps1` et le lanceur Mac `JobScout.command` désactivent cet envoi. `npm run start` n'en envoie pas. Si vous lancez Next.js autrement, désactivez-le vous-même avec `npx next telemetry disable`.
- Avec `npm run dev`, Next.js vérifie aussi à chaque démarrage s'il existe une version plus récente de lui-même, auprès de `registry.npmjs.org`. Cette requête ne contient aucune donnée vous concernant, mais le registre voit votre adresse IP. La désactivation de la télémétrie ne la coupe pas.
- Le code contient aussi un relais d'IA et une vérification de mise à jour. Ils sont inactifs : aucune adresse n'est configurée par défaut. Ils ne s'activent que si vous définissez vous-même une adresse (`JOBSCOUT_PROXY_URL`, `JOBSCOUT_UPDATE_URL`).
- Les offres peuvent contenir le nom ou les coordonnées d'un recruteur. Ne les utilisez que pour votre candidature (section 4).

## 13. Contributions (issues et pull requests)

- Les issues et les pull requests sont publiques. Les conditions d'utilisation et la politique de confidentialité de GitHub s'y appliquent.
- N'y collez jamais votre CV, une lettre, une clé d'API, votre fichier `.env`, votre base `jobscout.db`, ni un journal du serveur que vous n'avez pas relu : il peut contenir des extraits de vos documents. Masquez vos données personnelles sur les captures d'écran.
- En proposant une contribution, vous acceptez qu'elle soit publiée sous la licence MIT du projet. Vous garantissez avoir le droit de la proposer.
- L'éditeur peut refuser une contribution. Il peut masquer ou supprimer un message qui contient des données personnelles ou des propos illicites.

## 14. Évolution des conditions

- Ces conditions sont versionnées dans le dépôt, avec le code. L'historique Git conserve toutes les versions précédentes.
- Chaque version de JobScout publiée dans le dépôt contient les conditions en vigueur au moment de sa publication. Si vous installez une nouvelle version, ses conditions s'appliquent à partir de ce moment.
- Les changements importants sont signalés dans les notes de version du dépôt.

## 15. Droit applicable et litiges

- Ces conditions sont régies par le droit français.
- Elles ne choisissent aucun tribunal : en cas de procès, le tribunal compétent est celui que désigne la loi.
- Si vous résidez hors de France, vous gardez les protections que la loi de votre pays vous accorde et auxquelles un contrat ne peut pas déroger.
- En cas de difficulté, vous pouvez ouvrir une issue pour chercher une solution amiable, sans y mettre de données personnelles. Cette démarche est facultative et ne vous prive d'aucun recours.
- Si une clause est jugée non valable, les autres restent applicables.
- Ces conditions sont rédigées en français.

## 16. Entrée en vigueur

Ces conditions entrent en vigueur le 21 octobre 2026 et sont publiées avec JobScout 3.4.17.
