import type { ProfileFull } from "@/lib/cv/types";

/**
 * Profils FICTIFS du banc d'évaluation de la note (tests/scoring-eval.test.ts).
 * Volontairement éloignés les uns des autres : un profil de développeur, un
 * métier fonctionnel junior, un commercial, un profil data senior, et un
 * technicien de maintenance — ce dernier sert de piège au mot « Tech », que
 * l'ancienne note prenait pour un secteur.
 *
 * Les jugements de pertinence associés ont été posés à la main sur les titres
 * AVANT l'écriture de la nouvelle note (data/eval/labels.json, local).
 */

type EvalProfile = { key: string; profile: ProfileFull };

const base = {
  sources_enabled: ["francetravail", "wttj", "hellowork", "talent"],
  extraction_confidence: 90,
};

export const EVAL_PROFILES: EvalProfile[] = [
  {
    key: "dev-dotnet",
    profile: {
      ...base,
      educations: [{ school: "École d'ingénieurs", degree: "Diplôme d'ingénieur", field: "Informatique", start_date: "2016-09", end_date: "2021-06" }],
      summary: "Développeur .NET / C# full stack, cinq ans sur des applications web métier.",
      sectors: ["tech", "services", "start-up"],
      target_countries: ["France"],
      preferred_contracts: ["cdi"],
      target_titles: ["Développeur .NET", "Développeur Full Stack .NET", "Tech Lead .NET"],
      experiences: [
        {
          title: "Développeur .NET Full Stack",
          company: "Éditeur SaaS",
          start_date: "2021-10",
          end_date: "present",
          bullet_points: ["API ASP.NET Core et front Angular", "Migration vers Azure"],
          skills_used: ["C#", ".NET", "ASP.NET Core", "Azure", "Angular", "SQL Server"],
        },
      ],
      skills: [
        { name: "C#", category: "technical", evidence_experience_ids: [1] },
        { name: ".NET", category: "technical", evidence_experience_ids: [1] },
        { name: "ASP.NET Core", category: "technical", evidence_experience_ids: [1] },
        { name: "Azure", category: "tool", evidence_experience_ids: [1] },
        { name: "Angular", category: "technical", evidence_experience_ids: [1] },
        { name: "SQL Server", category: "tool", evidence_experience_ids: [1] },
        { name: "Entity Framework", category: "technical", evidence_experience_ids: [] },
        { name: "Git", category: "tool", evidence_experience_ids: [] },
      ],
      languages: [{ name: "Français", level: "Natif" }, { name: "Anglais", level: "B2" }],
    },
  },
  {
    key: "ba-junior",
    profile: {
      ...base,
      educations: [{ school: "Université", degree: "Master", field: "MIAGE", start_date: "2022-09", end_date: "2024-08" }],
      summary: "Business analyst junior en assurance : recueil des besoins, spécifications, recette.",
      sectors: ["tech", "services", "start-up"],
      target_countries: ["France"],
      preferred_contracts: ["cdi", "cdd"],
      target_titles: ["Business Analyst", "Consultant AMOA", "Business Analyst Assurance"],
      experiences: [
        {
          title: "Business Analyst",
          company: "Mutuelle d'assurance",
          start_date: "2025-01",
          end_date: "present",
          bullet_points: ["Recueil des besoins métier", "Rédaction des spécifications fonctionnelles", "Recette"],
          skills_used: ["Analyse fonctionnelle", "Spécifications", "Recette", "SQL"],
        },
        {
          title: "Stagiaire AMOA",
          company: "Banque",
          start_date: "2024-03",
          end_date: "2024-08",
          bullet_points: ["Cartographie des processus de crédit"],
          skills_used: ["UML", "Excel"],
        },
      ],
      skills: [
        { name: "Analyse fonctionnelle", category: "technical", evidence_experience_ids: [1] },
        { name: "Recueil des besoins", category: "technical", evidence_experience_ids: [1] },
        { name: "Spécifications fonctionnelles", category: "technical", evidence_experience_ids: [1] },
        { name: "Recette", category: "technical", evidence_experience_ids: [1] },
        { name: "SQL", category: "tool", evidence_experience_ids: [1] },
        { name: "UML", category: "technical", evidence_experience_ids: [2] },
        { name: "Excel", category: "tool", evidence_experience_ids: [2] },
        { name: "Assurance vie", category: "technical", evidence_experience_ids: [] },
      ],
      languages: [{ name: "Français", level: "Natif" }, { name: "Anglais", level: "B2" }],
    },
  },
  {
    key: "bizdev",
    profile: {
      ...base,
      educations: [{ school: "École de commerce", degree: "Bachelor", field: "Commerce et vente", start_date: "2020-09", end_date: "2023-08" }],
      summary: "Business developer B2B SaaS : prospection, cycle de vente complet, closing.",
      sectors: ["tech", "services", "start-up"],
      target_countries: ["France", "Belgique"],
      preferred_contracts: ["cdi"],
      target_titles: ["Business Developer", "Account Executive", "Account Manager"],
      experiences: [
        {
          title: "Business Developer",
          company: "Start-up SaaS RH",
          start_date: "2023-09",
          end_date: "present",
          bullet_points: ["Prospection outbound", "Négociation et closing de contrats annuels"],
          skills_used: ["Prospection", "Négociation", "HubSpot", "Closing"],
        },
        {
          title: "Commercial en alternance",
          company: "ESN",
          start_date: "2021-09",
          end_date: "2023-08",
          bullet_points: ["Qualification de leads"],
          skills_used: ["Prospection", "Salesforce"],
        },
      ],
      skills: [
        { name: "Prospection", category: "technical", evidence_experience_ids: [1, 2] },
        { name: "Négociation", category: "soft", evidence_experience_ids: [1] },
        { name: "HubSpot", category: "tool", evidence_experience_ids: [1] },
        { name: "Salesforce", category: "tool", evidence_experience_ids: [2] },
        { name: "Cycle de vente", category: "technical", evidence_experience_ids: [] },
        { name: "SaaS", category: "technical", evidence_experience_ids: [] },
        { name: "Account management", category: "technical", evidence_experience_ids: [] },
      ],
      languages: [{ name: "Français", level: "Natif" }, { name: "Anglais", level: "C1" }],
    },
  },
  {
    key: "data-eng-senior",
    profile: {
      ...base,
      educations: [{ school: "École d'ingénieurs", degree: "Diplôme d'ingénieur", field: "Informatique et données", start_date: "2015-09", end_date: "2018-08" }],
      summary: "Data engineer senior : pipelines Spark et Databricks, orchestration, cloud.",
      sectors: ["tech", "services", "start-up"],
      target_countries: ["France", "Luxembourg", "Suisse", "Belgique"],
      preferred_contracts: ["cdi"],
      target_titles: ["Data Engineer", "Tech Lead Data", "Data Architect"],
      experiences: [
        {
          title: "Senior Data Engineer",
          company: "Banque en ligne",
          start_date: "2022-01",
          end_date: "present",
          bullet_points: ["Plateforme Databricks", "Pipelines Spark et Airflow"],
          skills_used: ["Python", "Spark", "Databricks", "Airflow", "AWS"],
        },
        {
          title: "Data Engineer",
          company: "Cabinet de conseil",
          start_date: "2018-09",
          end_date: "2021-12",
          bullet_points: ["Entrepôts de données sur GCP"],
          skills_used: ["SQL", "GCP", "dbt"],
        },
      ],
      skills: [
        { name: "Python", category: "technical", evidence_experience_ids: [1] },
        { name: "SQL", category: "technical", evidence_experience_ids: [2] },
        { name: "Spark", category: "technical", evidence_experience_ids: [1] },
        { name: "Databricks", category: "tool", evidence_experience_ids: [1] },
        { name: "Airflow", category: "tool", evidence_experience_ids: [1] },
        { name: "dbt", category: "tool", evidence_experience_ids: [2] },
        { name: "GCP", category: "tool", evidence_experience_ids: [2] },
        { name: "AWS", category: "tool", evidence_experience_ids: [1] },
        { name: "Kafka", category: "tool", evidence_experience_ids: [] },
      ],
      languages: [{ name: "Français", level: "Natif" }, { name: "Anglais", level: "C1" }],
    },
  },
  {
    key: "tech-maintenance",
    profile: {
      ...base,
      educations: [{ school: "Lycée professionnel", degree: "BTS", field: "Maintenance des systèmes", start_date: "2021-09", end_date: "2023-06" }],
      summary: "Technicien de maintenance multitechnique, habilité électrique, dépannage industriel.",
      sectors: ["tech", "services", "start-up"],
      target_countries: ["France"],
      preferred_contracts: ["cdi", "cdd"],
      target_titles: ["Technicien de maintenance", "Technicien de maintenance multitechnique", "Technicien d'intervention"],
      experiences: [
        {
          title: "Technicien de maintenance",
          company: "Site industriel",
          start_date: "2023-06",
          end_date: "present",
          bullet_points: ["Maintenance préventive et curative", "Dépannage électrique et CVC"],
          skills_used: ["Électricité industrielle", "Maintenance préventive", "CVC"],
        },
        {
          title: "Technicien de maintenance en apprentissage",
          company: "Logisticien",
          start_date: "2021-09",
          end_date: "2023-05",
          bullet_points: ["Interventions sur convoyeurs"],
          skills_used: ["Automatismes", "Lecture de schémas"],
        },
      ],
      skills: [
        { name: "Électricité industrielle", category: "technical", evidence_experience_ids: [1] },
        { name: "Habilitation électrique", category: "technical", evidence_experience_ids: [] },
        { name: "Maintenance préventive", category: "technical", evidence_experience_ids: [1] },
        { name: "Maintenance curative", category: "technical", evidence_experience_ids: [1] },
        { name: "CVC", category: "technical", evidence_experience_ids: [1] },
        { name: "Automatismes", category: "technical", evidence_experience_ids: [2] },
        { name: "Lecture de schémas", category: "technical", evidence_experience_ids: [2] },
      ],
      languages: [{ name: "Français", level: "Natif" }],
    },
  },
] as EvalProfile[];
