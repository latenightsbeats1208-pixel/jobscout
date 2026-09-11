import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sortie autonome : .next/standalone contient server.js + le strict nécessaire
  // de node_modules. C'est la base du paquet Windows (installer/).
  output: "standalone",
  // Racine de traçage explicite : sans elle Next remonte au dossier parent
  // (COWORK) pour deviner un monorepo, ce qui produit une arborescence
  // .next/standalone/jobscout-v3/... et fait fuiter le chemin absolu du poste
  // de développement dans les artefacts de build.
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: [
    "playwright",
    "pdf-parse",
    "pdfjs-dist",
    "mammoth",
    "tesseract.js",
    "@react-pdf/renderer",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
  // Les prompts et le schéma SQL sont lus à l'exécution via process.cwd().
  // On les déclare pour que le traceur les embarque dans la sortie standalone.
  outputFileTracingIncludes: {
    "/api/**": ["./prompts/**/*", "./lib/db/schema.sql"],
  },
  // Pas d'`outputFileTracingExcludes` ici, volontairement. Le traceur suit
  // `path.join(process.cwd(), "data", …)` et recopie donc la base et les
  // documents du poste de développement dans `.next/standalone` — mais un
  // filtre « data/** » à ce niveau est à double tranchant : il emporte aussi
  // des dossiers `data/` légitimes de dépendances (css-tree/data/patch.json,
  // requis par jsdom, donc par tous les scrapers). L'exclusion des données
  // utilisateur est faite de façon explicite et vérifiable à l'assemblage
  // (installer/assemble.mjs) puis contrôlée par installer/check-leaks.mjs.
};

export default nextConfig;
