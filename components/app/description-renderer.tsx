import DOMPurify from "isomorphic-dompurify";

export function DescriptionRenderer({ html }: { html: string }) {
  const safe = DOMPurify.sanitize(html, {
    ADD_ATTR: ["target"],
    // Force rel="noopener noreferrer" sur tous les liens sortants (anti-tabnabbing)
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "a",
      "span",
      "div",
      "blockquote",
      "code",
      "pre",
    ],
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
  // Durcit chaque lien sortant : rel anti-tabnabbing.
  const hardened = safe.replace(/<a /g, '<a rel="noopener noreferrer" ');
  return <div className="prose-offre" dangerouslySetInnerHTML={{ __html: hardened }} />;
}
