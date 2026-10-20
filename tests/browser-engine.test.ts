import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEngineInstalled } from "@/lib/scrapers/browser-engine";

/**
 * Le moteur LinkedIn n'est « installé » que si Playwright peut le lancer : la
 * révision du shell Chromium doit être celle de son browsers.json. Cas réel
 * (octobre 2026) : le registre global gardait les révisions 1234 et 1243 d'une
 * autre version de Playwright, la détection les acceptait, et chaque scan
 * LinkedIn échouait sur « Executable doesn't exist at …-1217 ».
 */

const expected = (
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "node_modules", "playwright-core", "browsers.json"), "utf-8")) as {
    browsers: { name: string; revision: string }[];
  }
).browsers.find((b) => b.name === "chromium-headless-shell")!.revision;

let root: string;

function install(dir: string, name: string) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "INSTALLATION_COMPLETE"), "");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-engine-"));
  // Ni le registre de l'application ni le registre global du poste : deux dossiers vides.
  vi.stubEnv("PLAYWRIGHT_BROWSERS_PATH", path.join(root, "app"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("XDG_CACHE_HOME", path.join(root, "home", ".cache"));
  vi.stubEnv("LOCALAPPDATA", path.join(root, "home", "AppData", "Local"));
});
afterEach(() => vi.unstubAllEnvs());

const globalRegistry = () =>
  process.platform === "darwin"
    ? path.join(root, "home", "Library", "Caches", "ms-playwright")
    : process.platform === "win32"
    ? path.join(root, "home", "AppData", "Local", "ms-playwright")
    : path.join(root, "home", ".cache", "ms-playwright");

describe("détection du moteur LinkedIn", () => {
  it("ignore un moteur d'une autre révision, même complet", () => {
    install(globalRegistry(), `chromium_headless_shell-${Number(expected) + 17}`);
    install(globalRegistry(), `chromium-${Number(expected) + 17}`);
    install(path.join(root, "app"), `chromium-${expected}`); // Chromium complet, pas le shell que lance le scan
    expect(isEngineInstalled()).toBe(false);
  });

  it("reconnaît le shell de la révision attendue, dans l'application ou dans le registre global", () => {
    install(globalRegistry(), `chromium_headless_shell-${expected}`);
    expect(isEngineInstalled()).toBe(true);
  });

  it("une installation interrompue ne compte pas", () => {
    fs.mkdirSync(path.join(root, "app", `chromium_headless_shell-${expected}`), { recursive: true });
    expect(isEngineInstalled()).toBe(false);
  });
});
