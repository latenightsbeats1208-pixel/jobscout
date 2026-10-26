import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { SESSION_COOKIE, checkPassword, expectedSessionToken, safeEqual } from "@/lib/auth/session";
import { parseDailyTime } from "@/lib/scan/daily";

const saved = { pw: process.env.JOBSCOUT_PASSWORD, hosts: process.env.JOBSCOUT_ALLOWED_HOSTS };
afterEach(() => {
  for (const [k, v] of [["JOBSCOUT_PASSWORD", saved.pw], ["JOBSCOUT_ALLOWED_HOSTS", saved.hosts]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function req(url: string, init: { host?: string; cookie?: string; headers?: Record<string, string>; method?: string } = {}) {
  const u = new URL(url);
  const headers = new Headers({ host: init.host ?? u.host, ...init.headers });
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(u, { headers, method: init.method ?? "GET" });
}

describe("hôtes autorisés (JOBSCOUT_ALLOWED_HOSTS)", () => {
  it("refuse un hôte non local par défaut, l'accepte une fois déclaré", async () => {
    delete process.env.JOBSCOUT_PASSWORD;
    delete process.env.JOBSCOUT_ALLOWED_HOSTS;
    expect((await middleware(req("http://jobscout.lan/api/profile"))).status).toBe(403);
    process.env.JOBSCOUT_ALLOWED_HOSTS = "jobscout.lan, other.ts.net";
    expect((await middleware(req("http://jobscout.lan/api/profile"))).status).toBe(200);
    expect((await middleware(req("http://evil.example/api/profile"))).status).toBe(403);
  });

  it("refuse une écriture dont l'Origin est un autre hôte", async () => {
    delete process.env.JOBSCOUT_PASSWORD;
    process.env.JOBSCOUT_ALLOWED_HOSTS = "jobscout.lan";
    const r = req("http://jobscout.lan/api/profile", { method: "POST", headers: { origin: "http://evil.example" } });
    expect((await middleware(r)).status).toBe(403);
  });
});

describe("connexion par mot de passe (JOBSCOUT_PASSWORD)", () => {
  it("sans mot de passe défini, tout passe comme avant", async () => {
    delete process.env.JOBSCOUT_PASSWORD;
    expect((await middleware(req("http://localhost:3000/offres"))).status).toBe(200);
  });

  it("redirige les pages vers /login et refuse l'API sans session", async () => {
    process.env.JOBSCOUT_PASSWORD = "s3cret";
    process.env.JOBSCOUT_ALLOWED_HOSTS = "jobscout.lan";
    const page = await middleware(req("http://jobscout.lan/offres?tri=score", { headers: { "x-forwarded-proto": "https" } }));
    expect(page.status).toBe(307);
    const loc = new URL(page.headers.get("location")!);
    expect(loc.origin).toBe("https://jobscout.lan");
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/offres?tri=score");
    expect((await middleware(req("http://jobscout.lan/api/profile"))).status).toBe(401);
    // L'écran de connexion lui-même reste accessible.
    expect((await middleware(req("http://jobscout.lan/login"))).status).toBe(200);
    expect((await middleware(req("http://jobscout.lan/api/auth/login", { method: "POST" }))).status).toBe(200);
  });

  it("laisse passer un cookie de session valide, pas un cookie forgé", async () => {
    process.env.JOBSCOUT_PASSWORD = "s3cret";
    const token = await expectedSessionToken();
    expect((await middleware(req("http://localhost/offres", { cookie: `${SESSION_COOKIE}=${token}` }))).status).toBe(200);
    expect((await middleware(req("http://localhost/offres", { cookie: `${SESSION_COOKIE}=${"0".repeat(64)}` }))).status).toBe(307);
  });

  it("changer le mot de passe invalide les sessions existantes", async () => {
    process.env.JOBSCOUT_PASSWORD = "ancien";
    const old = await expectedSessionToken();
    process.env.JOBSCOUT_PASSWORD = "nouveau";
    expect(await expectedSessionToken()).not.toBe(old);
  });

  it("checkPassword et safeEqual", async () => {
    process.env.JOBSCOUT_PASSWORD = "s3cret";
    expect(await checkPassword("s3cret")).toBe(true);
    expect(await checkPassword("S3cret")).toBe(false);
    delete process.env.JOBSCOUT_PASSWORD;
    expect(await checkPassword("")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("heure du scan quotidien (JOBSCOUT_DAILY_SCAN)", () => {
  it("accepte HH:MM, refuse le reste", () => {
    expect(parseDailyTime("06:30")).toEqual({ h: 6, m: 30 });
    expect(parseDailyTime(" 7:05 ")).toEqual({ h: 7, m: 5 });
    expect(parseDailyTime("23:59")).toEqual({ h: 23, m: 59 });
    for (const bad of [undefined, "", "24:00", "6h30", "06:60", "abc"]) expect(parseDailyTime(bad)).toBeNull();
  });
});
