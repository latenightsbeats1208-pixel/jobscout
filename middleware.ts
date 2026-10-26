import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, authEnabled, expectedSessionToken, safeEqual } from "@/lib/auth/session";

/**
 * Garde-fou de l'API. JobScout n'a pas de compte utilisateur : par défaut il
 * écoute uniquement sur la machine, et son API ne doit répondre qu'à
 * l'application elle-même.
 *
 * - En-tête Host : localhost / 127.0.0.1 / [::1], plus les noms listés dans
 *   JOBSCOUT_ALLOWED_HOSTS (serveur auto-hébergé derrière un reverse proxy).
 *   Bloque le « DNS rebinding » (un site qui fait pointer son propre nom vers
 *   l'adresse du serveur pour lire le profil ou les candidatures).
 * - Sec-Fetch-Site : un navigateur l'envoie toujours ; seules les requêtes de
 *   la même origine (ou tapées dans la barre d'adresse) passent. Un site
 *   ouvert dans un autre onglet ne peut donc ni lancer un scan, ni écraser le
 *   profil, ni consommer la clé API par une génération.
 * - Origin (requêtes qui modifient) : si présent, il doit être autorisé et
 *   correspondre au Host.
 * - Mot de passe (JOBSCOUT_PASSWORD) : s'il est défini, toutes les pages et
 *   l'API exigent le cookie de session posé par /login.
 *
 * Les scripts locaux (ligne de commande, recette d'installation) n'envoient ni
 * Origin ni Sec-Fetch-Site : ils passent, tant qu'ils visent un hôte autorisé.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function allowedHostnames(): Set<string> {
  const extra = (process.env.JOBSCOUT_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOCAL_HOSTNAMES, ...extra]);
}

function hostnameOf(hostHeader: string): string {
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function forbidden(reason: string): NextResponse {
  return NextResponse.json({ error: `Requête refusée (${reason}).` }, { status: 403 });
}

/** Pages et routes accessibles sans session : l'écran de connexion lui-même. */
function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/api/auth/");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const allowed = allowedHostnames();

  if (isApi) {
    const host = req.headers.get("host") ?? "";
    if (!allowed.has(hostnameOf(host))) return forbidden("hôte non autorisé");

    const site = req.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return forbidden("origine externe");

    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = req.headers.get("origin");
      if (origin) {
        let o: URL;
        try {
          o = new URL(origin);
        } catch {
          return forbidden("origine invalide");
        }
        if (!allowed.has(o.hostname.toLowerCase()) || o.host.toLowerCase() !== host.toLowerCase()) {
          return forbidden("origine externe");
        }
      }
    }
  }

  if (authEnabled() && !isPublicPath(pathname)) {
    const token = req.cookies.get(SESSION_COOKIE)?.value ?? "";
    const expected = await expectedSessionToken();
    if (!token || !safeEqual(token, expected)) {
      if (isApi) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
      // URL absolue reconstruite depuis l'en-tête Host (et le protocole vu par le
      // reverse proxy) : derrière Traefik, req.nextUrl porte l'adresse interne.
      const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
      const url = new URL("/login", `${proto}://${req.headers.get("host") ?? "localhost"}`);
      if (pathname !== "/") url.searchParams.set("next", pathname + req.nextUrl.search);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}
