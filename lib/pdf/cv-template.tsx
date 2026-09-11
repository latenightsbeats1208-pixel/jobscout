import "server-only";
import * as React from "react";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import type { GeneratedCV } from "@/lib/ai/generate-cv";
import {
  typographyFor,
  formatLanguage,
  displayUrl,
  capitalizeFirst,
  eduYearRange,
  expDateRange,
  cleanJobTitle,
} from "@/lib/text/typography";
import { LABELS, letterDateLine, type DocLang } from "@/lib/text/lang";

// Pas de césure automatique : react-pdf coupe les mots avec des règles
// anglaises (« corre-spond », « ar-tisans »), inacceptable dans une lettre.
Font.registerHyphenationCallback((word) => [word]);

// =============================================================
// CV — modèle inspiré du fichier de référence de l'auteur
// Tous les libellés fixes viennent de LABELS[language] : un CV pour une
// offre anglophone est entièrement en anglais (titres de sections,
// « Present », « Languages: »), avec la typographie anglaise.
// =============================================================

const cvStyles = StyleSheet.create({
  page: {
    paddingHorizontal: 42,
    paddingVertical: 30,
    fontFamily: "Helvetica",
    fontSize: 9,
    lineHeight: 1.22,
    color: "#000000",
  },
  name: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  contactLine: { fontSize: 9, color: "#202020", marginBottom: 8 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 6,
    marginBottom: 3,
  },
  summary: { fontSize: 9, marginBottom: 2, textAlign: "justify" },
  expBlock: { marginTop: 3 },
  expHeaderLine: { fontSize: 9.5, marginBottom: 1 },
  expTitleBold: { fontFamily: "Helvetica-Bold" },
  expDates: { fontStyle: "italic", color: "#3a3a3c" },
  bullet: { flexDirection: "row", marginBottom: 0.5, paddingLeft: 6 },
  bulletDot: { width: 7, fontSize: 9 },
  bulletText: { flex: 1, fontSize: 9 },
  eduBlock: { marginTop: 3 },
  eduSchool: { fontSize: 9.5, marginBottom: 1 },
  eduDegree: { fontSize: 9, fontStyle: "italic", color: "#202020", marginBottom: 1 },
  skillsFlow: { fontSize: 9, marginTop: 2, marginBottom: 2 },
  languagesLine: { fontSize: 9, fontFamily: "Helvetica-Bold" },
});

type Ty = (s: string | null | undefined) => string;

function Bullets({ items, ty }: { items: string[]; ty: Ty }) {
  return (
    <>
      {items
        .filter((b) => b && b.trim())
        .map((b, j) => (
          <View key={j} style={cvStyles.bullet}>
            <Text style={cvStyles.bulletDot}>•</Text>
            <Text style={cvStyles.bulletText}>{ty(b)}</Text>
          </View>
        ))}
    </>
  );
}

export function CVDocument({ cv, language = "fr" }: { cv: GeneratedCV; language?: DocLang }) {
  const L = LABELS[language];
  const ty = typographyFor(language);
  const contact = [
    cv.identity.phone,
    cv.identity.email,
    cv.identity.location,
    displayUrl(cv.identity.linkedin_url),
    displayUrl(cv.identity.portfolio_url),
  ].filter(Boolean) as string[];
  const projects = cv.sections.projects ?? [];

  return (
    <Document>
      <Page size="A4" style={cvStyles.page}>
        <Text style={cvStyles.name}>{cv.identity.full_name}</Text>
        {contact.length > 0 && <Text style={cvStyles.contactLine}>{contact.join("  |  ")}</Text>}

        {cv.summary && (
          <>
            <Text style={cvStyles.sectionTitle}>{L.profile}</Text>
            <Text style={cvStyles.summary}>{ty(cv.summary)}</Text>
          </>
        )}

        {cv.sections.experiences.length > 0 && (
          <>
            <Text style={cvStyles.sectionTitle}>{L.experience}</Text>
            {cv.sections.experiences.map((e, i) => (
              <View key={i} style={cvStyles.expBlock} wrap={false}>
                <Text style={cvStyles.expHeaderLine}>
                  <Text style={cvStyles.expTitleBold}>
                    {cleanJobTitle(e.title)}
                    {e.company ? ` — ${e.company}` : ""}
                  </Text>
                  <Text style={cvStyles.expDates}>
                    {`  |  ${expDateRange(e.start_date, e.end_date, language)}`}
                    {e.location ? `  |  ${e.location}` : ""}
                  </Text>
                </Text>
                <Bullets items={e.bullet_points ?? []} ty={ty} />
              </View>
            ))}
          </>
        )}

        {projects.length > 0 && (
          <>
            <Text style={cvStyles.sectionTitle}>{projects.length > 1 ? L.projects : L.project}</Text>
            {projects.map((p, i) => (
              <View key={i} style={cvStyles.expBlock} wrap={false}>
                <Text style={cvStyles.expHeaderLine}>
                  <Text style={cvStyles.expTitleBold}>
                    {p.name}
                    {p.role ? ` — ${p.role}` : ""}
                  </Text>
                  <Text style={cvStyles.expDates}>
                    {`  |  ${expDateRange(p.start_date, p.end_date, language)}`}
                  </Text>
                </Text>
                <Bullets items={p.bullet_points ?? []} ty={ty} />
              </View>
            ))}
          </>
        )}

        {cv.sections.educations.length > 0 && (
          <>
            <Text style={cvStyles.sectionTitle}>{L.education}</Text>
            {cv.sections.educations.map((e, i) => (
              <View key={i} style={cvStyles.eduBlock} wrap={false}>
                <Text style={cvStyles.eduSchool}>
                  <Text style={cvStyles.expTitleBold}>{e.school}</Text>
                  <Text style={cvStyles.expDates}>
                    {`  |  ${eduYearRange(e.start_date, e.end_date, language)}`}
                  </Text>
                </Text>
                {(e.degree || e.field) && (
                  <Text style={cvStyles.eduDegree}>{ty([e.degree, e.field].filter(Boolean).join(" — "))}</Text>
                )}
                <Bullets items={e.bullet_points ?? []} ty={ty} />
              </View>
            ))}
          </>
        )}

        {(cv.sections.skills_flat?.length || cv.sections.languages.length) ? (
          <>
            <Text style={cvStyles.sectionTitle}>{L.skills}</Text>
            {cv.sections.skills_flat?.length > 0 && (
              <Text style={cvStyles.skillsFlow}>
                {cv.sections.skills_flat.map((s) => capitalizeFirst(s)).join(" | ")}
              </Text>
            )}
            {cv.sections.languages.length > 0 && (
              <Text style={cvStyles.languagesLine}>
                {ty(
                  `${L.languages} : ${cv.sections.languages
                    .map((l) => formatLanguage(l.name, l.level))
                    .join(" | ")}`
                )}
              </Text>
            )}
          </>
        ) : null}
      </Page>
    </Document>
  );
}

// =============================================================
// Lettre de motivation — modèle de référence
// =============================================================

const lmStyles = StyleSheet.create({
  page: {
    paddingHorizontal: 56,
    paddingVertical: 50,
    fontFamily: "Helvetica",
    fontSize: 10.5,
    lineHeight: 1.32,
    color: "#000000",
  },
  senderName: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginBottom: 1 },
  senderLine: { fontSize: 10.5, marginBottom: 0.5 },
  blockGap: { height: 8 },
  smallGap: { height: 4 },
  dateLine: { fontSize: 10.5, marginBottom: 8 },
  recipient: { fontSize: 10.5, marginBottom: 8 },
  subject: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginBottom: 10 },
  salutation: { marginBottom: 8 },
  paragraph: { textAlign: "justify", marginBottom: 8 },
  signatureSpace: { height: 14 },
  signature: { fontFamily: "Helvetica-Bold" },
});

export function LMDocument({
  identity,
  recipient,
  object,
  body_paragraphs,
  language = "fr",
}: {
  identity: GeneratedCV["identity"];
  recipient: { company: string; location?: string | null };
  object: string;
  body_paragraphs: string[];
  language?: DocLang;
}) {
  const L = LABELS[language];
  const ty = typographyFor(language);
  const senderCity = identity.location?.split(",")[0]?.trim() || null;
  const dateLine = letterDateLine(senderCity, language);
  const company = (recipient.company ?? "").trim();

  return (
    <Document>
      <Page size="A4" style={lmStyles.page}>
        <Text style={lmStyles.senderName}>{identity.full_name}</Text>
        {identity.phone && <Text style={lmStyles.senderLine}>{identity.phone}</Text>}
        {identity.email && <Text style={lmStyles.senderLine}>{identity.email}</Text>}
        <View style={lmStyles.smallGap} />
        {identity.location && <Text style={lmStyles.senderLine}>{identity.location}</Text>}

        <View style={lmStyles.blockGap} />
        <Text style={lmStyles.dateLine}>{dateLine}</Text>

        {/* Destinataire uniquement si l'entreprise est connue : un pays seul n'a aucun sens */}
        {company ? (
          <Text style={lmStyles.recipient}>
            {company}
            {recipient.location ? `\n${recipient.location}` : ""}
          </Text>
        ) : null}

        <Text style={lmStyles.subject}>{ty(`${L.subject} : ${cleanJobTitle(object)}`)}</Text>
        <Text style={lmStyles.salutation}>{L.salutation}</Text>

        {body_paragraphs
          .filter((p) => p && p.trim())
          .map((p, i) => (
            <Text key={i} style={lmStyles.paragraph}>
              {ty(p)}
            </Text>
          ))}

        {L.closing ? <Text style={lmStyles.paragraph}>{L.closing}</Text> : null}
        {L.signoff ? <Text style={lmStyles.paragraph}>{L.signoff}</Text> : null}
        <View style={lmStyles.signatureSpace} />
        <Text style={lmStyles.signature}>{identity.full_name}</Text>
      </Page>
    </Document>
  );
}
