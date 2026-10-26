import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, authEnabled, checkPassword, expectedSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/** Petite temporisation après un échec : freine l'essai de mots de passe en rafale. */
const FAIL_DELAY_MS = 800;

function isHttps(req: NextRequest): boolean {
  return (req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(":", "")) === "https";
}

export async function POST(req: NextRequest) {
  if (!authEnabled()) return NextResponse.json({ ok: true });
  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  const candidate = typeof body.password === "string" ? body.password : "";
  if (!(await checkPassword(candidate))) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await expectedSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
