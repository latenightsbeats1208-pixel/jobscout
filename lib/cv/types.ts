import { z } from "zod";

export const ExperienceSchema = z.object({
  id: z.number().optional(),
  title: z.string().min(1),
  company: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  bullet_points: z.array(z.string()).default([]),
  skills_used: z.array(z.string()).default([]),
});
export type Experience = z.infer<typeof ExperienceSchema>;

export const EducationSchema = z.object({
  id: z.number().optional(),
  school: z.string().min(1),
  degree: z.string().nullable().optional(),
  field: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type Education = z.infer<typeof EducationSchema>;

export const SkillSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1),
  category: z.enum(["technical", "soft", "language", "tool"]).nullable().optional(),
  level: z.enum(["beginner", "intermediate", "advanced", "expert"]).nullable().optional(),
  evidence_experience_ids: z.array(z.number()).default([]),
});
export type Skill = z.infer<typeof SkillSchema>;

export const LanguageSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1),
  level: z.string().nullable().optional(),
});
export type Language = z.infer<typeof LanguageSchema>;

export const ProfileSchema = z.object({
  id: z.number().optional(),
  full_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  portfolio_url: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  raw_cv_text: z.string().nullable().optional(),
  sectors: z.array(z.string()).default([]),
  target_countries: z.array(z.string()).default([]),
  sources_enabled: z.array(z.string()).default([]),
  preferred_contracts: z
    .array(z.enum(["cdi", "cdd", "vie", "stage", "alternance"]))
    .default(["cdi", "cdd"]),
  extraction_confidence: z.number().min(0).max(100).default(0),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileFullSchema = ProfileSchema.extend({
  experiences: z.array(ExperienceSchema).default([]),
  educations: z.array(EducationSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  languages: z.array(LanguageSchema).default([]),
});
export type ProfileFull = z.infer<typeof ProfileFullSchema>;

// Schema returned by Claude tool call
export const ExtractedCVSchema = z.object({
  identity: z.object({
    full_name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    linkedin_url: z.string().nullable(),
    portfolio_url: z.string().nullable(),
  }),
  summary: z.string().nullable(),
  experiences: z.array(
    z.object({
      title: z.string(),
      company: z.string().nullable(),
      location: z.string().nullable(),
      start_date: z.string().nullable(),
      end_date: z.string().nullable(),
      description: z.string().nullable(),
      bullet_points: z.array(z.string()).default([]),
      skills_used: z.array(z.string()).default([]),
    })
  ),
  educations: z.array(
    z.object({
      school: z.string(),
      degree: z.string().nullable(),
      field: z.string().nullable(),
      location: z.string().nullable(),
      start_date: z.string().nullable(),
      end_date: z.string().nullable(),
      description: z.string().nullable(),
    })
  ),
  skills: z.array(
    z.object({
      name: z.string(),
      category: z.enum(["technical", "soft", "language", "tool"]).nullable(),
      level: z.enum(["beginner", "intermediate", "advanced", "expert"]).nullable(),
    })
  ),
  languages: z.array(z.object({ name: z.string(), level: z.string().nullable() })),
  certifications: z
    .array(z.object({ name: z.string(), issuer: z.string().nullable(), date: z.string().nullable() }))
    .default([]),
});
export type ExtractedCV = z.infer<typeof ExtractedCVSchema>;
