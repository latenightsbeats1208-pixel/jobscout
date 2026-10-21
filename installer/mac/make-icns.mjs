// ============================================================================
// installer/mac/make-icns.mjs
//
// Icône de l'app Mac (Resources/JobScout.icns), sans dépendance externe :
//   - le dessin vient de installer/make-icon.mjs (render), avec une marge de
//     10 % pour la grille des icônes macOS (le .ico Windows garde 3 %) ;
//   - chaque taille de 16 à 1024 px est encodée en PNG (zlib.deflateSync,
//     zlib.crc32) dans installer/assets/JobScout.iconset ;
//   - `iconutil -c icns` produit installer/assets/JobScout.icns.
// Les deux sorties sont ignorées par git.
//
//   node installer/mac/make-icns.mjs                   iconset + .icns (macOS)
//   node installer/mac/make-icns.mjs --iconset-only <dossier>
//                                                     PNG seulement (tout système)
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { INSTALLER, fail, isMainModule, notice, requireDarwin, run, runMain } from "./bundle.mjs";

export const ASSETS = path.join(INSTALLER, "assets");
export const DEFAULT_ICONSET = path.join(ASSETS, "JobScout.iconset");
export const DEFAULT_ICNS = path.join(ASSETS, "JobScout.icns");
export const ICON_MARGIN = 0.1;

/** Fichiers d'un .iconset et leur taille en pixels (iconutil exige ces noms). */
export const ICONSET = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  if (typeof zlib.crc32 !== "function") {
    throw new Error(`zlib.crc32 absent (Node ${process.version}) : Node ≥ 22.2 requis pour encoder les PNG.`);
  }
  return zlib.crc32(buf) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([len, typed, crc]);
}

/** PNG RGBA 8 bits (type de couleur 6), sans filtre, non entrelacé. */
export function encodePng(width, height, rgba) {
  const src = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  if (src.length !== width * height * 4) {
    throw new Error(`PNG ${width}×${height} : ${src.length} octets RGBA, attendu ${width * height * 4}.`);
  }
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtre « None »
    src.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits par composante
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * render() moyenne des sous-pixels transparents (couleur 0) avec les opaques :
 * ses couleurs sont « prémultipliées » par l'alpha. Le PNG attend un alpha
 * droit : on divise, sinon les bords de l'icône tirent vers le noir.
 */
export function unpremultiply(rgba) {
  const out = Buffer.from(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a === 0) {
      out[i] = out[i + 1] = out[i + 2] = 0;
    } else if (a < 255) {
      for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.round((out[i + c] * 255) / a));
    }
  }
  return out;
}

/** render(size, { margin }) de installer/make-icon.mjs, avec contrôle que la marge est prise en compte. */
export async function loadRender() {
  const mod = await import(pathToFileURL(path.join(INSTALLER, "make-icon.mjs")).href);
  if (typeof mod.render !== "function") {
    throw new Error("installer/make-icon.mjs n'exporte pas render(size, { margin }).");
  }
  const a = Buffer.from(mod.render(16));
  const b = Buffer.from(mod.render(16, { margin: ICON_MARGIN }));
  if (a.length !== 16 * 16 * 4 || b.length !== a.length) {
    throw new Error("installer/make-icon.mjs : render(16) ne renvoie pas 16×16 pixels RGBA.");
  }
  if (a.equals(b)) {
    throw new Error(`installer/make-icon.mjs : render() ignore l'option margin (${ICON_MARGIN}) : l'icône Mac serait trop grande.`);
  }
  return mod.render;
}

/** Écrit les 10 PNG du .iconset ; renvoie [{ name, size, bytes }]. */
export async function writeIconset(dir = DEFAULT_ICONSET, { margin = ICON_MARGIN, render } = {}) {
  const draw = render ?? (await loadRender());
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cache = new Map();
  const written = [];
  for (const [name, size] of ICONSET) {
    if (!cache.has(size)) {
      const rgba = Buffer.from(draw(size, { margin }));
      if (rgba.length !== size * size * 4) throw new Error(`render(${size}) : taille RGBA inattendue (${rgba.length}).`);
      cache.set(size, encodePng(size, size, unpremultiply(rgba)));
    }
    const png = cache.get(size);
    fs.writeFileSync(path.join(dir, name), png);
    written.push({ name, size, bytes: png.length });
  }
  return written;
}

/** En-tête d'un .icns : « icns » + longueur totale (big-endian) = taille du fichier. */
export function icnsHeaderProblems(buf) {
  if (buf.length < 8) return ["fichier trop court"];
  const p = [];
  if (buf.toString("ascii", 0, 4) !== "icns") p.push("signature « icns » absente");
  if (buf.readUInt32BE(4) !== buf.length) p.push(`longueur d'en-tête ${buf.readUInt32BE(4)} ≠ taille ${buf.length}`);
  return p;
}

/** iconset + .icns ; renvoie { icns, bytes, iconset: [...] }. macOS seulement (iconutil). */
export async function makeIcns({ out = DEFAULT_ICNS, iconset = DEFAULT_ICONSET } = {}) {
  requireDarwin("Icône .icns");
  if (!iconset.endsWith(".iconset")) throw new Error(`le dossier d'images doit finir par .iconset : ${iconset}`);
  const written = await writeIconset(iconset);
  fs.rmSync(out, { force: true });
  run("iconutil", ["-c", "icns", iconset, "-o", out]);
  if (!fs.existsSync(out)) throw new Error("iconutil n'a pas produit le .icns.");
  const buf = fs.readFileSync(out);
  const problems = icnsHeaderProblems(buf);
  if (problems.length) throw new Error(`.icns invalide : ${problems.join(", ")}`);
  return { icns: out, bytes: buf.length, iconset: written };
}

if (isMainModule(import.meta.url)) {
  runMain("Icône .icns", async () => {
    const args = process.argv.slice(2);
    const i = args.indexOf("--iconset-only");
    if (i >= 0) {
      const dir = args[i + 1];
      if (!dir) fail("Icône .icns", "usage : --iconset-only <dossier>");
      const w = await writeIconset(path.resolve(dir));
      notice("Icône .icns", `${w.length} PNG écrits dans ${dir}`);
      return;
    }
    const r = await makeIcns();
    notice("Icône .icns", `${path.basename(r.icns)} : ${(r.bytes / 1024).toFixed(0)} Ko, ${r.iconset.length} images de 16 à 1024 px`);
  });
}
