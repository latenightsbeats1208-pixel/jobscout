import type { ProfileFull } from "@/lib/cv/types";

/**
 * Profils FICTIFS du banc « marché » : chacun lance une vraie collecte (base
 * séparée, data/eval/market/<clé>.db) puis ses offres sont jugées à la main,
 * sans voir les notes. Douze profils aussi éloignés que possible : soin,
 * bâtiment, transport, restauration, comptabilité, droit, design, data,
 * développement, vente, aide à domicile, et un profil anglophone sans un mot de
 * français. Niveaux de 1 à 12 ans, diplômes du CAP au doctorat.
 *
 * Les champs sont ceux qu'une lecture de CV produirait : intitulés, dates,
 * réalisations, compétences tirées des expériences, langues.
 */

export type MarketProfile = { key: string; label: string; profile: ProfileFull };

const sources = ["francetravail", "hellowork", "wttj", "talent"];

const p = (over: Partial<ProfileFull> & Pick<ProfileFull, "target_titles" | "experiences" | "skills" | "languages" | "educations">): ProfileFull =>
  ({
    full_name: null, email: null, phone: null, location: null, linkedin_url: null, portfolio_url: null,
    summary: null, raw_cv_text: null, sectors: [], target_countries: ["France"], search_area: "",
    sources_enabled: sources, preferred_contracts: ["cdi", "cdd"], extraction_confidence: 90,
    ...over,
  }) as ProfileFull;

const skills = (names: string[]) => names.map((name) => ({ name, category: "technical" as const, evidence_experience_ids: [] as number[] }));
const fr = { name: "Français", level: "Natif" };

export const MARKET_PROFILES: MarketProfile[] = [
  {
    key: "infirmiere",
    label: "Infirmière, 8 ans, urgences et médecine, Lyon",
    profile: p({
      summary: "Infirmière diplômée d'État, huit ans en service d'urgences puis de médecine interne.",
      target_titles: ["Infirmier", "Infirmier aux urgences"],
      search_area: "D:69",
      experiences: [
        { title: "Infirmière aux urgences", company: "Hospices Civils de Lyon", start_date: "2018-09", end_date: "present", bullet_points: ["Accueil et tri des patients (IOA)", "Soins techniques, perfusions, prélèvements", "Encadrement des étudiants infirmiers"], skills_used: ["Soins d'urgence", "Tri IOA", "Prélèvements sanguins"] },
        { title: "Infirmière en médecine interne", company: "Clinique du Parc", start_date: "2016-09", end_date: "2018-08", bullet_points: ["Préparation et administration des traitements", "Surveillance clinique"], skills_used: ["Administration des traitements", "Surveillance clinique"] },
      ],
      educations: [{ school: "IFSI de Lyon", degree: "Diplôme d'État d'infirmier", field: "Soins infirmiers", start_date: "2013-09", end_date: "2016-07" }],
      skills: skills(["Soins d'urgence", "Tri IOA", "Prélèvements sanguins", "Administration des traitements", "Surveillance clinique", "Gestion de la douleur", "AFGSU niveau 2"]),
      languages: [fr],
    }),
  },
  {
    key: "dev-java-senior",
    label: "Développeur Java senior, 12 ans, Île-de-France",
    profile: p({
      summary: "Développeur Java / Spring depuis 12 ans, référent technique sur des plateformes bancaires.",
      target_titles: ["Développeur Java senior", "Tech Lead Java", "Architecte logiciel Java"],
      search_area: "R:11",
      preferred_contracts: ["cdi"],
      experiences: [
        { title: "Tech Lead Java", company: "Banque de détail", start_date: "2019-03", end_date: "present", bullet_points: ["Architecture microservices Spring Boot sur Kubernetes", "Encadrement de 6 développeurs", "Migration Java 8 vers 21"], skills_used: ["Java", "Spring Boot", "Kubernetes", "Kafka", "PostgreSQL"] },
        { title: "Développeur Java", company: "ESN", start_date: "2014-09", end_date: "2019-02", bullet_points: ["Développement d'API REST", "Batchs Spring Batch"], skills_used: ["Java", "Spring", "Hibernate", "Oracle"] },
      ],
      educations: [{ school: "École d'ingénieurs", degree: "Diplôme d'ingénieur", field: "Informatique", start_date: "2011-09", end_date: "2014-07" }],
      skills: skills(["Java", "Spring Boot", "Spring Batch", "Microservices", "Kubernetes", "Kafka", "PostgreSQL", "Hibernate", "Docker", "CI/CD"]),
      languages: [fr, { name: "Anglais", level: "C1" }],
    }),
  },
  {
    key: "electricien",
    label: "Électricien bâtiment, 6 ans, BP, Nantes",
    profile: p({
      summary: "Électricien en bâtiment tertiaire et résidentiel, habilité B1V BR, permis B.",
      target_titles: ["Électricien", "Électricien bâtiment"],
      search_area: "D:44",
      preferred_contracts: ["cdi", "cdd"],
      experiences: [
        { title: "Électricien", company: "Entreprise d'électricité générale", start_date: "2020-04", end_date: "present", bullet_points: ["Installation de tableaux électriques et réseaux courants faibles", "Mise en conformité NF C 15-100", "Lecture de plans et schémas"], skills_used: ["Câblage", "Tableaux électriques", "NF C 15-100", "Courants faibles"] },
        { title: "Électricien apprenti", company: "Artisan électricien", start_date: "2018-09", end_date: "2020-03", bullet_points: ["Rénovation électrique de logements"], skills_used: ["Câblage", "Rénovation"] },
      ],
      educations: [{ school: "CFA du bâtiment", degree: "Brevet professionnel", field: "Électricien", start_date: "2018-09", end_date: "2020-06" }],
      skills: skills(["Câblage", "Tableaux électriques", "NF C 15-100", "Courants faibles", "Lecture de plans", "Habilitation électrique B1V BR", "Permis B"]),
      languages: [fr],
    }),
  },
  {
    key: "assistante-comptable",
    label: "Assistante comptable, 2 ans, BTS, Lille",
    profile: p({
      summary: "Assistante comptable en cabinet : saisie, rapprochements, déclarations de TVA.",
      target_titles: ["Assistant comptable", "Comptable fournisseurs"],
      search_area: "D:59",
      experiences: [
        { title: "Assistante comptable", company: "Cabinet d'expertise comptable", start_date: "2024-09", end_date: "present", bullet_points: ["Saisie des pièces comptables", "Rapprochements bancaires", "Préparation des déclarations de TVA"], skills_used: ["Saisie comptable", "Rapprochement bancaire", "TVA", "Sage"] },
        { title: "Alternante comptable", company: "PME industrielle", start_date: "2022-09", end_date: "2024-08", bullet_points: ["Comptabilité fournisseurs", "Relances clients"], skills_used: ["Comptabilité fournisseurs", "Excel"] },
      ],
      educations: [{ school: "Lycée", degree: "BTS", field: "Comptabilité et gestion", start_date: "2022-09", end_date: "2024-07" }],
      skills: skills(["Saisie comptable", "Rapprochement bancaire", "TVA", "Comptabilité fournisseurs", "Sage", "Excel", "Lettrage"]),
      languages: [fr, { name: "Anglais", level: "B1" }],
    }),
  },
  {
    key: "chef-de-partie",
    label: "Cuisinier chef de partie, 7 ans, CAP, Bordeaux",
    profile: p({
      summary: "Cuisinier, sept ans en brasserie puis en restaurant gastronomique, chef de partie chaud.",
      target_titles: ["Chef de partie", "Second de cuisine", "Cuisinier"],
      search_area: "D:33",
      preferred_contracts: ["cdi", "cdd"],
      experiences: [
        { title: "Chef de partie", company: "Restaurant gastronomique", start_date: "2022-03", end_date: "present", bullet_points: ["Responsable du poste chaud", "Mise en place et dressage", "Encadrement d'un commis"], skills_used: ["Cuisine gastronomique", "Mise en place", "Dressage", "HACCP"] },
        { title: "Cuisinier", company: "Brasserie", start_date: "2019-05", end_date: "2022-02", bullet_points: ["Service de 200 couverts", "Préparations froides et chaudes"], skills_used: ["Cuisine traditionnelle", "HACCP"] },
      ],
      educations: [{ school: "Lycée hôtelier", degree: "CAP", field: "Cuisine", start_date: "2017-09", end_date: "2019-06" }],
      skills: skills(["Cuisine gastronomique", "Cuisine traditionnelle", "Mise en place", "Dressage", "HACCP", "Gestion des stocks"]),
      languages: [fr],
    }),
  },
  {
    key: "chauffeur-pl",
    label: "Chauffeur poids lourd SPL, 10 ans, Rouen",
    profile: p({
      summary: "Conducteur poids lourd super lourd, transport régional et national, FIMO, FCO et ADR à jour.",
      target_titles: ["Chauffeur poids lourd", "Conducteur SPL"],
      search_area: "D:76",
      preferred_contracts: ["cdi", "cdd"],
      experiences: [
        { title: "Conducteur SPL", company: "Transporteur régional", start_date: "2016-02", end_date: "present", bullet_points: ["Livraisons en régional et grands déplacements", "Chargement et arrimage", "Transport de matières dangereuses (ADR)"], skills_used: ["Permis CE", "ADR", "Arrimage", "Chronotachygraphe"] },
      ],
      educations: [{ school: "AFTRAL", degree: "FIMO", field: "Transport de marchandises", start_date: "2015-09", end_date: "2015-12" }],
      skills: skills(["Permis C", "Permis CE", "FIMO", "FCO", "ADR", "Arrimage", "Chronotachygraphe", "CACES R489"]),
      languages: [fr],
    }),
  },
  {
    key: "data-scientist-phd",
    label: "Data scientist, docteur en bioinformatique, Paris ou Suisse",
    profile: p({
      summary: "Docteur en bioinformatique, deux ans de data science en pharma : modèles prédictifs, génomique.",
      target_titles: ["Data Scientist", "Bioinformaticien", "Machine Learning Engineer"],
      search_area: "R:11",
      target_countries: ["France", "Suisse"],
      preferred_contracts: ["cdi", "cdd"],
      experiences: [
        { title: "Data Scientist", company: "Laboratoire pharmaceutique", start_date: "2024-01", end_date: "present", bullet_points: ["Modèles de prédiction de réponse aux traitements", "Pipelines d'analyse de données de séquençage"], skills_used: ["Python", "scikit-learn", "PyTorch", "SQL", "NGS"] },
        { title: "Chercheur postdoctoral", company: "Institut de recherche", start_date: "2021-01", end_date: "2023-12", bullet_points: ["Analyse de données single-cell", "Publications"], skills_used: ["R", "Python", "Bioconductor", "Statistiques"] },
      ],
      educations: [{ school: "Université", degree: "Doctorat", field: "Bioinformatique", start_date: "2017-10", end_date: "2020-12" }],
      skills: skills(["Python", "R", "Machine learning", "Deep learning", "PyTorch", "scikit-learn", "SQL", "Statistiques", "NGS", "Bioinformatique"]),
      languages: [fr, { name: "Anglais", level: "C1" }],
    }),
  },
  {
    key: "juriste-social",
    label: "Juriste droit social, 4 ans, Master 2, Paris",
    profile: p({
      summary: "Juriste en droit social en entreprise : contentieux prud'homal, relations sociales, conseil RH.",
      target_titles: ["Juriste droit social", "Juriste en droit du travail"],
      search_area: "R:11",
      preferred_contracts: ["cdi"],
      experiences: [
        { title: "Juriste droit social", company: "Groupe de distribution", start_date: "2022-09", end_date: "present", bullet_points: ["Conseil aux RH sur les contrats et les ruptures", "Suivi du contentieux prud'homal", "Préparation des réunions du CSE"], skills_used: ["Droit du travail", "Contentieux prud'homal", "Relations sociales"] },
        { title: "Juriste stagiaire", company: "Cabinet d'avocats", start_date: "2022-01", end_date: "2022-06", bullet_points: ["Recherches et notes juridiques"], skills_used: ["Recherche juridique"] },
      ],
      educations: [{ school: "Université Paris 1", degree: "Master 2", field: "Droit social", start_date: "2020-09", end_date: "2022-08" }],
      skills: skills(["Droit du travail", "Droit social", "Contentieux prud'homal", "Relations sociales", "Négociation collective", "Rédaction juridique"]),
      languages: [fr, { name: "Anglais", level: "B2" }],
    }),
  },
  {
    key: "ux-designer-junior",
    label: "UX/UI designer junior, 18 mois, Marseille",
    profile: p({
      summary: "Designer UX/UI junior : recherche utilisateur, maquettes Figma, design system.",
      target_titles: ["UX Designer", "UI/UX Designer", "Product Designer"],
      search_area: "D:13",
      preferred_contracts: ["cdi", "cdd"],
      experiences: [
        { title: "UX/UI Designer", company: "Agence digitale", start_date: "2025-04", end_date: "present", bullet_points: ["Maquettes et prototypes Figma", "Tests utilisateurs", "Contribution au design system"], skills_used: ["Figma", "Prototypage", "Tests utilisateurs", "Design system"] },
        { title: "Designer stagiaire", company: "Start-up", start_date: "2024-09", end_date: "2025-02", bullet_points: ["Refonte de l'application mobile"], skills_used: ["Figma", "UI design"] },
      ],
      educations: [{ school: "École de design", degree: "Master", field: "Design d'interaction", start_date: "2022-09", end_date: "2024-08" }],
      skills: skills(["Figma", "UX research", "UI design", "Prototypage", "Tests utilisateurs", "Design system", "Adobe Illustrator"]),
      languages: [fr, { name: "Anglais", level: "B2" }],
    }),
  },
  {
    key: "csm-anglophone",
    label: "Customer Success Manager anglophone, sans français, Paris ou Amsterdam",
    profile: p({
      summary: "Customer success manager with five years in B2B SaaS: onboarding, renewals and expansion.",
      target_titles: ["Customer Success Manager", "Account Manager"],
      search_area: "R:11",
      target_countries: ["France", "Pays-Bas"],
      preferred_contracts: ["cdi"],
      experiences: [
        { title: "Customer Success Manager", company: "B2B SaaS company", start_date: "2021-06", end_date: "present", bullet_points: ["Managed a portfolio of 60 mid-market accounts", "Led onboarding and quarterly business reviews", "Drove renewals and upsell"], skills_used: ["Customer success", "Salesforce", "Gainsight", "Account management"] },
        { title: "Customer Support Specialist", company: "E-commerce platform", start_date: "2019-09", end_date: "2021-05", bullet_points: ["Tier 2 support", "Knowledge base"], skills_used: ["Zendesk", "Customer support"] },
      ],
      educations: [{ school: "University", degree: "Bachelor", field: "Business Administration", start_date: "2015-09", end_date: "2019-06" }],
      skills: skills(["Customer success", "Account management", "Salesforce", "Gainsight", "Zendesk", "Onboarding", "Renewals", "SaaS"]),
      languages: [{ name: "Anglais", level: "Natif" }],
    }),
  },
  {
    key: "auxiliaire-de-vie",
    label: "Auxiliaire de vie, 3 ans, DEAES, Limoges",
    profile: p({
      summary: "Auxiliaire de vie auprès de personnes âgées à domicile : aide à la toilette, repas, accompagnement.",
      target_titles: ["Auxiliaire de vie", "Aide à domicile"],
      search_area: "D:87",
      preferred_contracts: ["cdi", "cdd"],
      experiences: [
        { title: "Auxiliaire de vie sociale", company: "Service d'aide à domicile", start_date: "2023-06", end_date: "present", bullet_points: ["Aide à la toilette et à l'habillage", "Préparation des repas", "Accompagnement aux courses et rendez-vous"], skills_used: ["Aide à la toilette", "Préparation des repas", "Accompagnement"] },
      ],
      educations: [{ school: "Institut de formation", degree: "DEAES", field: "Accompagnement éducatif et social", start_date: "2022-09", end_date: "2023-06" }],
      skills: skills(["Aide à la toilette", "Préparation des repas", "Accompagnement des personnes âgées", "Entretien du logement", "Permis B"]),
      languages: [fr],
    }),
  },
  {
    key: "commercial-junior",
    label: "Commercial junior, 4 ans de vente, master en échanges internationaux, Île-de-France",
    profile: p({
      summary: "Commercial chez un fabricant d'électronique, master en échanges internationaux, anglais, espagnol et italien.",
      target_titles: ["Chargé de développement commercial", "Chargé de marketing opérationnel", "Chargé d'études de marché"],
      search_area: "R:11",
      preferred_contracts: ["cdi", "cdd"],
      experiences: [
        { title: "Sales Representative", company: "Fabricant d'électronique", start_date: "2022-01", end_date: "present", bullet_points: ["Analyzed customer engagement data to refine promotional strategy", "Delivered product presentations to an international clientele"], skills_used: [] },
        { title: "Marketing Assistant Intern", company: "Centre d'appels", start_date: "2023-04", end_date: "2023-06", bullet_points: ["Market research and quantitative analysis of consumer trends"], skills_used: [] },
      ],
      educations: [
        { school: "Université", degree: "Master's Degree", field: "Administration and International Exchanges", start_date: "2025-09", end_date: "present" },
        { school: "Université", degree: "Bachelor's Degree", field: "Foreign Languages Applied to International Trade", start_date: "2020-09", end_date: "2024-07" },
      ],
      // Comme le profil réel qui l'inspire : des compétences universitaires, aucune de vente.
      skills: skills(["Quantitative & Qualitative Research Methods", "Data Analysis (OLS Regression)", "Academic Writing & Synthesis", "Cross-Cultural Communication", "Project Management", "Microsoft Office (Excel, PowerPoint)"]),
      languages: [fr, { name: "Anglais", level: "C1" }, { name: "Espagnol", level: "B2" }, { name: "Italien", level: "B1" }],
    }),
  },
];

/**
 * Profils de contrôle, créés APRÈS la mise au point des règles sur les douze
 * premiers : leur mesure dit si les règles valent au-delà des cas qui les ont
 * inspirées. On ne règle rien sur eux.
 */
export const HOLDOUT_PROFILES: MarketProfile[] = [
  {
    key: "technicien-maintenance",
    label: "Technicien de maintenance industrielle, 5 ans, BTS, Grenoble",
    profile: p({
      summary: "Technicien de maintenance en industrie agroalimentaire : dépannage électrique et mécanique, maintenance préventive, GMAO.",
      target_titles: ["Technicien de maintenance", "Technicien de maintenance industrielle"],
      search_area: "D:38",
      experiences: [
        { title: "Technicien de maintenance", company: "Usine agroalimentaire", start_date: "2021-03", end_date: "present", bullet_points: ["Dépannage électrique et mécanique des lignes de production", "Maintenance préventive sur GMAO", "Lecture de schémas électriques et pneumatiques"], skills_used: ["Électrotechnique", "Automatisme", "GMAO", "Pneumatique"] },
      ],
      educations: [{ school: "Lycée technique", degree: "BTS", field: "Maintenance des systèmes", start_date: "2019-09", end_date: "2021-06" }],
      skills: skills(["Électrotechnique", "Mécanique", "Automatismes Siemens", "Pneumatique", "Hydraulique", "GMAO", "Habilitation électrique BR"]),
      languages: [fr, { name: "Anglais", level: "A2" }],
    }),
  },
  {
    key: "charge-rh",
    label: "Chargée RH généraliste, 3 ans, Master RH, Toulouse",
    profile: p({
      summary: "Chargée de ressources humaines : recrutement, administration du personnel, paie et relations avec les représentants du personnel.",
      target_titles: ["Chargé de ressources humaines", "Chargé RH", "Chargé de recrutement"],
      search_area: "D:31",
      experiences: [
        { title: "Chargée RH", company: "PME industrielle", start_date: "2023-02", end_date: "present", bullet_points: ["Recrutement des postes ouvriers et techniciens", "Administration du personnel et variables de paie", "Préparation des réunions du CSE"], skills_used: ["Recrutement", "Administration du personnel", "Paie", "Droit du travail"] },
        { title: "Alternante RH", company: "Groupe de services", start_date: "2021-09", end_date: "2023-01", bullet_points: ["Onboarding des nouveaux salariés"], skills_used: ["Onboarding"] },
      ],
      educations: [{ school: "IAE Toulouse", degree: "Master", field: "Gestion des ressources humaines", start_date: "2021-09", end_date: "2023-06" }],
      skills: skills(["Recrutement", "Administration du personnel", "Paie", "Droit du travail", "SIRH", "Gestion des entretiens annuels", "Excel"]),
      languages: [fr, { name: "Anglais", level: "B2" }],
    }),
  },
  {
    key: "preparatrice-pharmacie",
    label: "Préparatrice en pharmacie, 6 ans, BP, Montpellier",
    profile: p({
      summary: "Préparatrice en pharmacie d'officine : délivrance des ordonnances, conseil, gestion des stocks et préparations.",
      target_titles: ["Préparateur en pharmacie"],
      search_area: "D:34",
      experiences: [
        { title: "Préparatrice en pharmacie", company: "Pharmacie d'officine", start_date: "2020-09", end_date: "present", bullet_points: ["Délivrance des ordonnances et conseil", "Gestion des commandes et des stocks", "Préparations magistrales"], skills_used: ["Délivrance d'ordonnances", "Conseil officinal", "Gestion des stocks", "LGO"] },
      ],
      educations: [{ school: "CFA pharmacie", degree: "Brevet professionnel", field: "Préparateur en pharmacie", start_date: "2018-09", end_date: "2020-06" }],
      skills: skills(["Délivrance d'ordonnances", "Conseil officinal", "Préparations magistrales", "Gestion des stocks", "Tiers payant", "Logiciel LGO"]),
      languages: [fr],
    }),
  },
  {
    key: "cariste",
    label: "Cariste préparateur de commandes, 4 ans, CACES, Orléans",
    profile: p({
      summary: "Cariste et préparateur de commandes en entrepôt logistique, CACES R489 catégories 1, 3 et 5.",
      target_titles: ["Cariste", "Préparateur de commandes"],
      search_area: "D:45",
      experiences: [
        { title: "Cariste préparateur de commandes", company: "Entrepôt logistique", start_date: "2022-05", end_date: "present", bullet_points: ["Préparation de commandes au scanner", "Chargement et déchargement des camions", "Réapprovisionnement des allées en hauteur"], skills_used: ["CACES R489", "Préparation de commandes", "Gestion des stocks"] },
      ],
      educations: [{ school: "Centre de formation", degree: "CACES", field: "R489 catégories 1, 3 et 5", start_date: "2022-01", end_date: "2022-02" }],
      skills: skills(["CACES R489 cat. 1", "CACES R489 cat. 3", "CACES R489 cat. 5", "Préparation de commandes", "Gestion des stocks", "Inventaire"]),
      languages: [fr],
    }),
  },
];

