import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Scout",
  description: "Trouvez le job de vos rêves grâce au scan IA multi-plateformes.",
};

// Applique le thème enregistré AVANT le paint pour éviter tout flash (FOUC).
const THEME_INIT = `(function(){try{var t=localStorage.getItem('jobscout:theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="antialiased min-h-screen bg-bg text-text">{children}</body>
    </html>
  );
}
