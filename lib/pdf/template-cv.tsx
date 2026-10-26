import "server-only";
import * as React from "react";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import type { TemplateCvDoc } from "@/lib/cvtemplate/assemble";

// Pas de césure automatique (règles anglaises appliquées au français sinon).
Font.registerHyphenationCallback((word) => [word]);

// =============================================================
// CV assemblé depuis le modèle maître — une colonne, compatible ATS :
// texte réel (aucune image), titres de sections standards, ordre de
// lecture linéaire. `scale` réduit tailles et marges pour tenir sur une page.
// =============================================================

const ACCENT = "#1f3a5f";

/** « Libellé : » en français (espace insécable), « Label: » en anglais. */
export const labelSep = (lang: TemplateCvDoc["lang"]) => (lang === "fr" ? "\u00a0: " : ": ");

function styles(scale: number) {
  const s = (n: number) => Math.round(n * scale * 100) / 100;
  return StyleSheet.create({
    page: {
      paddingHorizontal: s(38),
      paddingVertical: s(28),
      fontFamily: "Helvetica",
      fontSize: s(9),
      lineHeight: 1.25,
      color: "#111111",
    },
    // Interligne explicite : hérité de la page (corps 9 pt), il ferait chevaucher nom et titre.
    name: { fontSize: s(17), lineHeight: 1.15, fontFamily: "Helvetica-Bold", color: ACCENT, marginBottom: s(2) },
    headline: { fontSize: s(11), lineHeight: 1.2, fontFamily: "Helvetica-Bold", marginBottom: s(3) },
    contact: { fontSize: s(8.5), color: "#333333" },
    tagline: { fontSize: s(8.5), color: "#333333", marginTop: s(1) },
    sectionTitle: {
      fontSize: s(10),
      fontFamily: "Helvetica-Bold",
      color: ACCENT,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginTop: s(8),
      marginBottom: s(3),
      paddingBottom: s(1.5),
      borderBottomWidth: 0.6,
      borderBottomColor: "#9aa7b8",
    },
    paragraph: { textAlign: "justify" },
    entry: { marginTop: s(3.5) },
    entryHead: { fontSize: s(9.5) },
    entryTitle: { fontFamily: "Helvetica-Bold" },
    entryMeta: { color: "#444444" },
    entrySub: { fontSize: s(8.5), fontStyle: "italic", color: "#444444", marginTop: s(0.5) },
    bullet: { flexDirection: "row", marginTop: s(1.2), paddingLeft: s(4) },
    bulletDot: { width: s(8) },
    bulletText: { flex: 1, textAlign: "justify" },
    eduLine: { marginTop: s(1.5) },
    skillLine: { marginTop: s(1.5) },
    skillLabel: { fontFamily: "Helvetica-Bold" },
  });
}

export function TemplateCVDocument({ doc, scale = 1 }: { doc: TemplateCvDoc; scale?: number }) {
  const st = styles(scale);
  return (
    <Document title={`${doc.name} — ${doc.headline}`} author={doc.name} language={doc.lang}>
      <Page size="A4" style={st.page}>
        <Text style={st.name}>{doc.name}</Text>
        <Text style={st.headline}>{doc.headline}</Text>
        <Text style={st.contact}>{doc.contact.join("  ·  ")}</Text>
        {doc.tagline && <Text style={st.tagline}>{doc.tagline}</Text>}

        {doc.profile && (
          <>
            <Text style={st.sectionTitle}>{doc.profileTitle}</Text>
            <Text style={st.paragraph}>{doc.profile}</Text>
          </>
        )}

        {doc.sections.map((section) => (
          <View key={section.id}>
            <Text style={st.sectionTitle}>{section.title}</Text>
            {section.entries.map((e) => (
              <View key={e.id} style={st.entry} wrap={false}>
                {e.heading ? (
                  <Text style={st.entryHead}>
                    <Text style={st.entryTitle}>{e.heading}</Text>
                    {e.meta ? <Text style={st.entryMeta}>{`  ·  ${e.meta}`}</Text> : null}
                  </Text>
                ) : null}
                {e.sub ? <Text style={st.entrySub}>{e.sub}</Text> : null}
                {e.bullets.map((b) => (
                  <View key={b.id} style={st.bullet}>
                    <Text style={st.bulletDot}>•</Text>
                    <Text style={st.bulletText}>{b.text}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ))}

        {doc.education.length > 0 && (
          <>
            <Text style={st.sectionTitle}>{doc.educationTitle}</Text>
            {doc.education.map((e, i) => (
              <Text key={i} style={st.eduLine}>
                <Text style={st.entryTitle}>{e.heading}</Text>
                {e.meta ? <Text style={st.entryMeta}>{`  ·  ${e.meta}`}</Text> : null}
              </Text>
            ))}
          </>
        )}

        {doc.skills.length > 0 && (
          <>
            <Text style={st.sectionTitle}>{doc.skillsTitle}</Text>
            {doc.skills.map((s, i) => (
              <Text key={i} style={st.skillLine}>
                <Text style={st.skillLabel}>{`${s.label}${labelSep(doc.lang)}`}</Text>
                {s.items}
              </Text>
            ))}
          </>
        )}
      </Page>
    </Document>
  );
}
