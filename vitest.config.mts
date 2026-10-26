import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // tsconfig laisse le JSX à Next (« preserve ») : les tests qui rendent un PDF
  // (composants react-pdf en .tsx) ont besoin de le transformer eux-mêmes.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": root,
      // « server-only » lève une erreur hors du serveur Next : neutralisé pour les tests.
      "server-only": path.join(root, "tests", "stubs", "server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests réels (payants, avec une vraie clé) : seulement sur demande explicite.
    exclude: process.env.JOBSCOUT_LIVE === "1" ? [] : ["tests/live/**"],
    setupFiles: ["tests/setup.ts"],
    // Un processus par fichier : chaque fichier a sa propre base SQLite temporaire.
    pool: "forks",
    testTimeout: 30_000,
  },
});
