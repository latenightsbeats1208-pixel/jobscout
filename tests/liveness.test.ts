import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkLiveness, talentPageLiveness, type LivenessRef } from "@/lib/scrapers/liveness";

/**
 * Offre retirée par sa source : les signaux relevés sur les sites en octobre
 * 2026, servis par un faux fetch. Seul un signal net ferme une offre ; une
 * panne, un format inconnu ou une réponse inattendue la laissent en l'état.
 */

vi.mock("@/lib/scrapers/dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scrapers/dom")>()),
  sleep: async () => {},
}));

let respond: (url: URL, init?: RequestInit) => Response | Promise<Response>;
const requests: string[] = [];

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push(url.href);
    return respond(url, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

let seq = 0;
const ref = (source: string, source_id: string, url = `https://example.org/${source_id}`): LivenessRef => ({ id: ++seq, source, source_id, url });
const status = (code: number, body = "") => new Response(code === 204 ? null : body, { status: code });

// Données de page Talent.com, telles qu'échappées dans une chaîne JavaScript.
type TalentJob = { legacy_id: string; expired?: string; found?: string; re_found?: string };
const talentJob = (j: TalentJob) =>
  `{\\"id\\":\\"6268951380\\",\\"system_date_found\\":\\"${j.found ?? ""}\\",` +
  (j.expired === undefined ? "" : `\\"system_date_expired\\":\\"${j.expired}\\",\\"system_date_re_found\\":\\"${j.re_found ?? ""}\\",`) +
  `\\"legacy_id\\":\\"${j.legacy_id}\\"}`;
// Comme sur le site : les « offres similaires » d'abord, l'offre ensuite.
const talentPage = (own: Omit<TalentJob, "legacy_id">, similar: TalentJob[] = []) =>
  `<script>self.__next_f.push([1,"[${[...similar, { legacy_id: "04cce3927cc9", ...own }].map(talentJob).join(",")}]"])</script>`;

describe("France Travail", () => {
  it("204 sur le JSON de l'offre : retirée ; 200 : en ligne ; panne : inconnu", async () => {
    const codes: Record<string, number> = { "900AAAA": 200, "900BBBB": 204, "900CCCC": 503 };
    respond = (url) => status(codes[url.pathname.split("/").pop()!], "{}");
    const refs = ["900AAAA", "900BBBB", "900CCCC"].map((id) => ref("francetravail", id));
    const { results } = await checkLiveness(refs);
    expect(refs.map((r) => results.get(r.id))).toEqual(["open", "closed", "unknown"]);
    expect(requests[0]).toBe("https://candidat.francetravail.fr/api-descriptifoffre/offre/900AAAA");
  });
});

describe("HelloWork", () => {
  it("410 Gone : retirée ; 200 : en ligne", async () => {
    respond = (url) => status(url.pathname.includes("70000007") ? 410 : 200, "<html></html>");
    const refs = [ref("hellowork", "70000007", "https://www.hellowork.com/fr-fr/emplois/70000007.html"), ref("hellowork", "70859659", "https://www.hellowork.com/fr-fr/emplois/70859659.html")];
    const { results } = await checkLiveness(refs);
    expect(refs.map((r) => results.get(r.id))).toEqual(["closed", "open"]);
  });
});

describe("Talent.com", () => {
  it("une date d'expiration ne vaut que si l'offre n'a pas été retrouvée depuis (cas réels)", () => {
    const live = (own: Omit<TalentJob, "legacy_id">, similar?: TalentJob[]) => talentPageLiveness(talentPage(own, similar), "04cce3927cc9");
    expect(live({ expired: "", found: "2026-10-06T19:12:26Z" })).toBe("open");
    // Expirée le 11/10 à 14 h 35, retrouvée à 18 h 40 : de nouveau en ligne.
    expect(live({ expired: "2026-10-11T14:35:25.321000Z", found: "2026-10-09T11:27:39Z", re_found: "2026-10-11T18:40:52Z" })).toBe("open");
    expect(live({ expired: "2026-10-08T20:53:33.383000Z", found: "2026-07-05T18:51:04Z" })).toBe("closed");
  });

  it("ne lit que l'offre elle-même, jamais les offres similaires de la page (cas réel)", () => {
    const similar = [
      { legacy_id: "0f548893a88a", found: "2026-04-25T18:35:42Z", expired: "2026-10-10T08:00:00Z" },
      { legacy_id: "91b54792094a", found: "2026-10-12T08:00:00Z" },
    ];
    expect(talentPageLiveness(talentPage({ expired: "", found: "2026-09-07T17:58:03Z" }, similar), "04cce3927cc9")).toBe("open");
    expect(talentPageLiveness(talentPage({ expired: "2026-10-08T20:53:33Z", found: "2026-07-05T18:51:04Z" }, similar), "04cce3927cc9")).toBe("closed");
    // Offre absente de la page, ou page sans ces données (format changé) : on ne conclut rien.
    expect(talentPageLiveness(talentPage({ expired: "" }, similar), "ffffffffffff")).toBe("unknown");
    expect(talentPageLiveness(talentPage({}), "04cce3927cc9")).toBe("unknown");
    expect(talentPageLiveness("<html><title>Talent.com</title></html>", "04cce3927cc9")).toBe("unknown");
  });

  it("lit la page de l'offre et y cherche son identifiant", async () => {
    respond = () => status(200, talentPage({ expired: "2026-10-08T20:53:33Z", found: "2026-07-05T18:51:04Z" }));
    const r = ref("talent", "04cce3927cc9", "https://sn.talent.com/view?id=04cce3927cc9");
    expect((await checkLiveness([r])).results.get(r.id)).toBe("closed");
  });

  it("404 : retirée", async () => {
    respond = () => status(404, "<html></html>");
    const r = ref("talent", "1bc051a01285", "https://www.talent.com/view?id=1bc051a01285");
    expect((await checkLiveness([r])).results.get(r.id)).toBe("closed");
  });
});

describe("Welcome to the Jungle", () => {
  it("lit l'index par lots ; un identifiant absent est une offre retirée", async () => {
    const bodies: { requests: { objectID: string }[] }[] = [];
    respond = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { requests: { objectID: string }[] };
      bodies.push(body);
      return new Response(JSON.stringify({ results: body.requests.map((r) => (r.objectID.startsWith("gone") ? null : { objectID: r.objectID })) }));
    };
    const refs = [...Array.from({ length: 52 }, (_, i) => ref("wttj", `live-${i}`)), ref("wttj", "gone-1")];
    const { results, suspicious } = await checkLiveness(refs);
    expect(bodies.map((b) => b.requests.length)).toEqual([50, 3]);
    expect(results.get(refs.at(-1)!.id)).toBe("closed");
    expect(refs.slice(0, -1).every((r) => results.get(r.id) === "open")).toBe(true);
    expect(suspicious).toEqual([]);
    expect(requests[0]).toMatch(/algolia\.net\/1\/indexes\/\*\/objects$/);
  });

  it("index en panne : rien n'est conclu", async () => {
    respond = () => status(403, '{"message":"Invalid API key"}');
    const r = ref("wttj", "x");
    expect((await checkLiveness([r])).results.get(r.id)).toBe("unknown");
  });
});

describe("garde-fous", () => {
  it("toutes les offres d'une source « retirées » : le site a sans doute changé, résultat ignoré", async () => {
    respond = (url) => status(url.hostname.includes("hellowork") ? 410 : 200, "{}");
    const hw = Array.from({ length: 6 }, (_, i) => ref("hellowork", `h${i}`, `https://www.hellowork.com/fr-fr/emplois/${i}.html`));
    const ft = ref("francetravail", "900AAAA");
    const { results, suspicious } = await checkLiveness([...hw, ft]);
    expect(suspicious).toEqual(["hellowork"]);
    expect(hw.every((r) => results.get(r.id) === "unknown")).toBe(true);
    expect(results.get(ft.id)).toBe("open");
  });

  it("LinkedIn n'est jamais interrogé", async () => {
    respond = () => {
      throw new Error("aucune requête attendue");
    };
    const r = ref("linkedin", "123");
    expect((await checkLiveness([r])).results.get(r.id)).toBe("unknown");
    expect(requests).toEqual([]);
  });
});
