/**
 * Balisage affiché en clair : formes servies par les sources et restées en base, en
 * miniature, autres formes servies par les mêmes sources (filet d'écriture), et textes
 * légitimes qui doivent rester intacts (quasi-positifs compris). Partagé par
 * tests/escaped-markup.test.ts (règle) et tests/offres-markup.test.ts (réparation en base).
 * Contenus fictifs.
 */

export type MarkupCase = {
  name: string;
  /** Source de l'offre : fixe la re-dérivation du texte (APEC : textContent). */
  source: string;
  /** description_html tel qu'il est stocké. */
  html: string;
  /** description_html réparé attendu. */
  repaired: string;
  /** Texte attendu, quand il est vérifié au caractère près : htmlToText du HTML réparé (STORED_CASES), texte enregistré selon la source (LATENT_CASES). */
  text: string | null;
  rules: string;
};

export const STORED_CASES: MarkupCase[] = [
  {
    name: "A — Talent : document entièrement échappé (JSON-LD stocké avant le correctif des entités), entités dedans",
    source: "talent",
    html: `&lt;p&gt;&lt;img src="https://x.test/1.png" style="width:600px" /&gt;&lt;/p&gt; &lt;p&gt;&lt;em&gt;Exemple SA ind&eacute;pendante, l&#39;&eacute;nergie&lt;/em&gt;&lt;em&gt;&nbsp;&lt;/em&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Exemple&nbsp;: c&rsquo;est&lt;/li&gt;&lt;/ul&gt;`,
    repaired: `<p><img src="https://x.test/1.png" style="width:600px" /></p> <p><em>Exemple SA ind&eacute;pendante, l'&eacute;nergie</em><em>&nbsp;</em></p><ul><li>Exemple&nbsp;: c&rsquo;est</li></ul>`,
    text: "Exemple SA indépendante, l'énergie \nExemple : c’est",
    rules: "markup",
  },
  {
    name: "B — Talent : page entière, bloc « Description de poste » échappé, seul enfant d'un <div>",
    source: "talent",
    html: `<header><h1>Chef de projet</h1><div>EXEMPLE SA • Lyon</div><img src="https://l.test/?a=1&amp;b=2" alt=""></header><span>Description de poste</span><div class="c">&lt;p&gt;Exemple SA est un&nbsp;&lt;strong&gt;groupe&lt;/strong&gt;, d&rsquo;ing&eacute;nierie.&lt;/p&gt;</div><h5>Cr&eacute;er une alerte</h5>`,
    repaired: `<header><h1>Chef de projet</h1><div>EXEMPLE SA • Lyon</div><img src="https://l.test/?a=1&amp;b=2" alt=""></header><span>Description de poste</span><div class="c"><p>Exemple SA est un&nbsp;<strong>groupe</strong>, d&rsquo;ing&eacute;nierie.</p></div><h5>Cr&eacute;er une alerte</h5>`,
    text: "Chef de projet\nEXEMPLE SA • Lyon\nDescription de posteExemple SA est un groupe, d’ingénierie.\n\nCréer une alerte",
    rules: "markup",
  },
  {
    name: "B — Talent : bloc échappé seul enfant d'un <p> (enveloppe retirée), texte brut après le dernier </p>",
    source: "talent",
    html: `<span>Description de poste</span><div class="c"><p>&lt;p&gt;&lt;strong&gt;Exemple SA&nbsp;!&lt;/strong&gt;&lt;/p&gt;Au sein du service, le/la charg&eacute;(e)</p></div>`,
    repaired: `<span>Description de poste</span><div class="c"><p><strong>Exemple SA&nbsp;!</strong></p>Au sein du service, le/la charg&eacute;(e)</div>`,
    text: "Description de posteExemple SA !\nAu sein du service, le/la chargé(e)",
    rules: "markup-unwrap-p",
  },
  {
    name: "C — WTTJ : profil Algolia échappé par un ancien scan, « \\r\\n » devenu « \\r<br> », <p> enveloppe",
    source: "wttj",
    html: `<h2>Profil recherché</h2><p>&lt;div&gt;Candidat en Bac+5.&lt;/div&gt;\r<br>&lt;div&gt;&lt;span lang=&quot;FR-FR&quot;&gt;Bureautique&lt;/span&gt;&lt;/div&gt;</p><h2>Avantages</h2><p>Tickets</p>`,
    repaired: `<h2>Profil recherché</h2><div>Candidat en Bac+5.</div>\r\n<div><span lang="FR-FR">Bureautique</span></div><h2>Avantages</h2><p>Tickets</p>`,
    text: "Profil recherché\nCandidat en Bac+5.\n\r\nBureautique\nAvantages\nTickets",
    rules: "markup-unwrap-p",
  },
  {
    name: "D — APEC : texte brut coupé par la source à l'intérieur d'une balise",
    source: "apec",
    html: `Suivre les indicateurs et piloter la marge ;&lt;li d`,
    repaired: `Suivre les indicateurs et piloter la marge ;`,
    text: "Suivre les indicateurs et piloter la marge ;",
    rules: "truncated-tail",
  },
  {
    name: "D — variante : fermante coupée",
    source: "apec",
    html: `Piloter la marge ;&lt;/li`,
    repaired: `Piloter la marge ;`,
    text: null,
    rules: "truncated-tail",
  },
  {
    name: "D — variante : attribut coupé, dans un vrai <p>",
    source: "apec",
    html: `<p>Piloter la marge ;&lt;li class=&quot;x</p>`,
    repaired: `<p>Piloter la marge ;</p>`,
    text: null,
    rules: "truncated-tail",
  },
  {
    name: "E — LinkedIn : « </p> » tapé en texte, éclaté par un vrai </strong> (deux fois)",
    source: "linkedin",
    html: `<p>⏳<strong> Date limite : 15 janvier 2026&lt;</strong>/p&gt;</p><p><br></p><p>⚠<strong>️ Candidatures en français uniquement&lt;</strong>/p&gt;</p>`,
    repaired: `<p>⏳<strong> Date limite : 15 janvier 2026</strong></p><p><br></p><p>⚠<strong>️ Candidatures en français uniquement</strong></p>`,
    text: "⏳ Date limite : 15 janvier 2026\n\n⚠️ Candidatures en français uniquement",
    rules: "doubled-end-tag+doubled-end-tag",
  },
];

/**
 * Autres formes servies par les mêmes sources, réparées par le filet d'écriture à chaque
 * scan. `text` : description_text attendu,
 * dérivé du HTML réparé selon la source. Aucun mot collé : un paragraphe reste un paragraphe.
 */
export const LATENT_CASES: MarkupCase[] = [
  {
    name: "LinkedIn : HTML en ligne tapé par le recruteur dans deux <p> (l'enveloppe reste)",
    source: "linkedin",
    html: `<p>&lt;b&gt;Lieu&lt;/b&gt; : Paris</p><p>&lt;b&gt;Contrat&lt;/b&gt; : CDI</p><p>Description du poste et des missions principales.</p>`,
    repaired: `<p><b>Lieu</b> : Paris</p><p><b>Contrat</b> : CDI</p><p>Description du poste et des missions principales.</p>`,
    text: "Lieu : Paris\nContrat : CDI\nDescription du poste et des missions principales.",
    rules: "markup+markup",
  },
  {
    name: "LinkedIn : HTML en ligne et vrais <br> dans un <p> (les <br> restent des sauts de ligne)",
    source: "linkedin",
    html: `<p>&lt;b&gt;Missions&lt;/b&gt; :<br>- Piloter le budget<br>- Animer les équipes</p><p>Suite de l'annonce.</p>`,
    repaired: `<p><b>Missions</b> :<br>- Piloter le budget<br>- Animer les équipes</p><p>Suite de l'annonce.</p>`,
    text: "Missions :\n- Piloter le budget\n- Animer les équipes\nSuite de l'annonce.",
    rules: "markup",
  },
  {
    name: "HTML en ligne dans un <p> suivi d'un vrai <p>",
    source: "wttj",
    html: `<p>&lt;strong&gt;Lieu&lt;/strong&gt; : Paris</p><p>Contrat : CDI</p>`,
    repaired: `<p><strong>Lieu</strong> : Paris</p><p>Contrat : CDI</p>`,
    text: "Lieu : Paris\nContrat : CDI",
    rules: "markup",
  },
  {
    name: "HTML en ligne dans un <p> suivi de texte brut, dans un <div>",
    source: "talent",
    html: `<div><p>&lt;b&gt;Exemple SA&lt;/b&gt; recrute</p>un chargé de communication.</div>`,
    repaired: `<div><p><b>Exemple SA</b> recrute</p>un chargé de communication.</div>`,
    text: "Exemple SA recrute\nun chargé de communication.",
    rules: "markup",
  },
  {
    name: "apostrophe dans un attribut entre guillemets : réparé",
    source: "talent",
    html: `&lt;p&gt;&lt;img alt=&quot;l&#39;eau&quot; src=&quot;https://x.test/a.png&quot;&gt;&lt;/p&gt;&lt;p&gt;Eau &amp; énergie&lt;/p&gt;`,
    repaired: `<p><img alt="l'eau" src="https://x.test/a.png"></p><p>Eau & énergie</p>`,
    text: "Eau & énergie",
    rules: "markup",
  },
  {
    name: "document échappé ET coupé dans une balise : HTML réparé, balise coupée retirée",
    source: "talent",
    html: `&lt;p&gt;Missions&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Piloter&lt;/li&gt;&lt;li d`,
    repaired: `<p>Missions</p><ul><li>Piloter</li>`,
    text: "Missions\nPiloter",
    rules: "markup+truncated-tail",
  },
  {
    name: "document échappé ET coupé dans une fermante",
    source: "talent",
    html: `&lt;p&gt;Missions&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Piloter&lt;/li&gt;&lt;/u`,
    repaired: `<p>Missions</p><ul><li>Piloter</li>`,
    text: "Missions\nPiloter",
    rules: "markup+truncated-tail",
  },
  {
    name: "balise coupée dans le DERNIER de plusieurs nœuds texte",
    source: "talent",
    html: `<p>Missions</p><p>Piloter la marge ;&lt;li d</p>`,
    repaired: `<p>Missions</p><p>Piloter la marge ;</p>`,
    text: "Missions\nPiloter la marge ;",
    rules: "truncated-tail",
  },
  {
    name: "APEC : double espace gardée (textContent, pas htmlToText)",
    source: "apec",
    html: `Vos missions :Piloter  la marge ;&lt;li d`,
    repaired: `Vos missions :Piloter  la marge ;`,
    text: "Vos missions :Piloter  la marge ;",
    rules: "truncated-tail",
  },
];

/** Textes légitimes : description_html rendu à l'octet près. */
export const LEGIT_CASES: [string, string][] = [
  ["balise citée au milieu", `<p>React, &lt;canvas&gt; et WebGL</p>`],
  ["commence par une balise sans fermer de bloc", `<p>&lt;div&gt; est requis</p>`],
  ["balises d'en-tête citées", `<p>Balises &lt;title&gt; et &lt;meta&gt; optimisées</p>`],
  ["comparaison « < 50 salariés »", `<p>Entreprise &lt; 50 salariés</p>`],
  ["« <$5M »", `<li>projets &lt;$5M et projets $50M+</li>`],
  ["« (<25%) »", `<li>déplacements ponctuels (&lt;25%)</li>`],
  ["« <=1 mois »", `<p>&nbsp;&nbsp;&lt;=1 mois</p>`],
  ["« <<<** »", `<p>point important &lt;&lt;&lt;**</p>`],
  ["« < >< > »", `étapes : &lt; &gt;&lt; &gt; - Rédiger`],
  ["« <3 »", `<p>On ❤ : &lt;3</p>`],
  ["adresse entre chevrons", `<p>Contact : &lt;prenom.nom@exemple.fr&gt;</p>`],
  ["URL entre chevrons", `<p>Voir &lt;https://exemple.fr/offre&gt;</p>`],
  ["chevrons autour de mots", `<p>&lt;Prénom&gt; &lt;Nom&gt;</p>`],
  ["code cité dans <code>", `<p>Exemple : <code>&lt;p&gt;Bonjour&lt;/p&gt;</code></p>`],
  ["code cité dans <pre>", `<pre>&lt;div&gt;x&lt;/div&gt;</pre>`],
  ["balise de texte brut (avalerait la suite)", `<div>&lt;p&gt;&lt;title&gt;x&lt;/p&gt;</div><p>Suite</p>`],
  ["script échappé", `<div>&lt;p&gt;a&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;</div>`],
  ["fermante orpheline (sortirait de son nœud)", `<div class="c">&lt;p&gt;a&lt;/p&gt;&lt;/div&gt;</div><p>Suite</p>`],
  ["balisage échappé mêlé à du vrai balisage", `<p>Profil : <b>HTML</b> &lt;p&gt;x&lt;/p&gt;</p>`],
  ["« </p> » cité en fin de bloc, d'un seul tenant", `<p>Pour fermer un paragraphe, écrivez &lt;/p&gt;</p>`],
  ["« </p> » cité dans un autre bloc", `<li>Fermer avec &lt;/p&gt;</li>`],
  ["« <50k » en fin de texte", `Salaire &lt;50k`],
  ["comparaison « a<b » en fin de texte", `Condition : a&lt;b`],
  ["balise coupée ailleurs qu'en fin de document", `<p>marge ;&lt;li d</p><p>Suite</p>`],
  ["double échappement (réparation des entités, pas celle-ci)", `<p>ind&amp;eacute;pendante &amp;lt;p&amp;gt;</p>`],
  ["entité lue différemment par le parseur et le décodeur", `&lt;p&gt;P&L; &ampx&lt;/p&gt;`],
  ["HTML propre", `<p>Bonjour <strong>Lyon</strong></p>`],
  ["texte sans « < » échappé", `Salaire 45 k€, R&amp;D`],
  ["balise complète en fin de texte (cas du test des entités)", `<p>R&amp;D, P&amp;L; Budgeting, &eacute;quipe &lt;div&gt;</p>`],
  // Formes relevées en revue : réparés, ces textes perdaient la suite à l'affichage ou collaient des mots.
  ["guillemet d'attribut non fermé au milieu d'une page (avalerait la suite)",
    `<div class="jobDescriptionColumn"><h1>Titre</h1><div class="sc-2">&lt;p&gt;Texte &lt;strong&gt;gras&lt;/strong&gt;&lt;/p&gt;&lt;p&gt;&lt;img src=&quot;https://x.test/a.png&lt;/p&gt;</div><h5>Type de contrat</h5><p>CDI temps plein</p><p>Salaire 45 k€</p></div>`],
  ["commentaire ouvert", `<div class="sc-2">&lt;p&gt;Texte &lt;strong&gt;gras&lt;/strong&gt; &lt;!-- note&lt;/p&gt;</div><p>CDI temps plein, salaire 45 k€</p>`],
  ["balise coupée avec guillemet ouvert au milieu (forme APEC dans un bloc Talent)", `<div class="c">&lt;p&gt;Mission&lt;/p&gt;&lt;li class=&quot;x</div><p>Suite importante</p>`],
  ["guillemet ouvert dans une balise par ailleurs complète", `<div class="c">&lt;p&gt;Mission&lt;/p&gt;&lt;p class=&quot;x&gt;y&lt;/p&gt;</div><p>Suite importante</p>`],
  ["attribut qui avale des mots du bloc échappé lui-même", `<div class="c">&lt;p&gt;Texte&lt;/p&gt;&lt;p&gt;&lt;img src=&quot;a.png&lt;/p&gt;&lt;p&gt;Mot important&lt;p alt=&quot;b&quot;&gt;&lt;/p&gt;</div><p>Suite</p>`],
  ["apostrophe d'attribut non fermée",`<div class="sc-2">&lt;p&gt;Texte&lt;/p&gt;&lt;p&gt;&lt;a href=&#39;https://x.test&lt;/p&gt;</div><h5>Type de contrat</h5><p>CDI</p>`],
  ["guillemet ouvert dans un <p> (forme du profil WTTJ échappé)", `<h2>Profil</h2><p>&lt;div&gt;Bac+5&lt;/div&gt;&lt;div&gt;&lt;span lang=&quot;FR&lt;/div&gt;</p><h2>Avantages</h2><p>Tickets restaurant</p>`],
  ["instruction « <? »", `<div class="sc-2">&lt;p&gt;Texte&lt;/p&gt;&lt;?xml version=&quot;1.0&quot;?&gt;</div><p>CDI</p>`],
  ["section « <![CDATA[ »", `<div class="sc-2">&lt;p&gt;Texte&lt;/p&gt;&lt;![CDATA[ x ]]&gt;</div><p>CDI</p>`],
  ["adresse entre chevrons dans un bloc échappé", `&lt;p&gt;Candidature : &lt;recrutement@exemple.fr&gt;&lt;/p&gt;`],
  ["mots entre chevrons dans un bloc échappé (balise de nom inconnu)", `&lt;p&gt;Madame &lt;NOM&gt; &lt;Prenom&gt;,&lt;/p&gt;`],
  ["<title> dont l'attribut contient un « < »", `<div>&lt;p&gt;a&lt;/p&gt;&lt;title x=&quot;a&lt;b&quot;&gt;</div><p>Suite</p>`],
  ["<svg> dont l'attribut contient une balise (son texte serait masqué)", `<p>&lt;div&gt;a&lt;/div&gt;&lt;svg x=&quot;&lt;p&gt;&quot;&gt;</p>Texte suivant`],
  ["bloc échappé suivi d'un vrai élément dans le même parent", `<p>&lt;p&gt;x&lt;/p&gt;<b>HTML</b></p>`],
  ["HTML en ligne puis un bloc, dans un <p> (le bloc fermerait le paragraphe)", `<p>&lt;b&gt;Profil&lt;/b&gt; : &lt;ul&gt;&lt;li&gt;Bac+5&lt;/li&gt;&lt;/ul&gt;</p><p>Suite</p>`],
  ["bloc échappé dans un élément en ligne d'un <p>", `<p><span>&lt;div&gt;Bac+5&lt;/div&gt;</span> et la suite</p>`],
  ["<li> échappés dans un <li> (fermeraient la puce)", `<ul><li>&lt;li&gt;a&lt;/li&gt;&lt;li&gt;b&lt;/li&gt;</li></ul>`],
  ["mise en forme non refermée (la suite passerait en gras)", `<div class="c">&lt;p&gt;Texte &lt;b&gt;gras&lt;/p&gt;</div><p>Suite</p>`],
  ["liste non refermée au milieu d'une page (contiendrait la suite)", `<div class="c">&lt;ul&gt;&lt;li&gt;Bac+5&lt;/li&gt;</div><p>Suite</p>`],
  ["tableau non refermé au milieu d'une page (la suite passerait avant lui)", `<div class="c">&lt;p&gt;Tableau&lt;/p&gt;&lt;table&gt;&lt;tr&gt;&lt;td&gt;a&lt;/td&gt;&lt;/tr&gt;</div><p>Suite</p>`],
  ["texte déplacé par le parseur (lien mal imbriqué) : autre parent qu'à sa place dans la source", `<a href="https://x.test"><div>&lt;p&gt;y&lt;/p&gt;</a>`],
  ["balise coupée dans le dernier texte, suivie d'autre chose que des fermantes", `<p>marge ;&lt;li d</p><p><img src="x.png"></p>`],
];
