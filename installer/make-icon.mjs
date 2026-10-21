// ============================================================================
// installer/make-icon.mjs
//
// Génère installer/assets/jobscout.ico, sans dépendance externe.
//
// Format : ICO multi-tailles (16→256) en entrées DIB 32 bits + masque AND.
// Le DIB est choisi plutôt que le PNG-dans-ICO pour rester compatible avec
// tous les consommateurs (Explorateur, Inno Setup, NotifyIcon .NET).
//
// Dessin : carré arrondi en dégradé bleu nuit → bleu accent, loupe blanche.
// Rendu en suréchantillonnage ×4 puis moyenné, pour des bords lisses.
//
// render() est exporté pour l'icône Mac (installer/mac/make-icns.mjs), qui
// l'appelle avec une marge plus large ; la marge par défaut garde le .ico
// identique octet pour octet.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "assets", "jobscout.ico");
const SIZES = [16, 32, 48, 64, 128, 256];
const SS = 4; // suréchantillonnage

const BG_TOP = [17, 24, 39]; // #111827
const BG_BOTTOM = [37, 99, 235]; // #2563EB
const FG = [255, 255, 255];

/** Marge par défaut, en fraction du côté : celle de jobscout.ico, inchangée. */
export const DEFAULT_MARGIN = 0.03;

/**
 * Rendu d'une taille en RGBA (Buffer), coordonnées haut→bas.
 *
 * @param {number} size  côté en pixels
 * @param {{ margin?: number }} [options]
 *   margin : vide autour du carré arrondi, en fraction du côté, dans [0 ; 0,5[.
 *   0.03 (défaut) donne l'icône Windows, octet pour octet : ce cas ne passe par
 *   aucun calcul supplémentaire. Une autre valeur réduit le dessin ENTIER
 *   (carré, coins, loupe) autour du centre ; 0.1 place le carré dans la grille
 *   des icônes macOS (environ 820 px sur 1024).
 * @returns {Buffer}  size × size × 4 octets RGBA
 */
export function render(size, { margin = DEFAULT_MARGIN } = {}) {
  if (typeof margin !== "number" || !Number.isFinite(margin) || margin < 0 || margin >= 0.5) {
    throw new RangeError(`marge ${margin} hors de [0 ; 0,5[`);
  }
  const n = size * SS;
  const acc = new Float64Array(size * size * 4);
  // Échelle du dessin : 1 pour la marge par défaut (chemin d'origine, sans
  // transformation), sinon homothétie de centre n/2 qui amène le carré de
  // [3 % ; 97 %] à [margin ; 1 - margin].
  const k = margin === DEFAULT_MARGIN ? 1 : (1 - 2 * DEFAULT_MARGIN) / (1 - 2 * margin);
  const half = n / 2;

  const r = n * 0.22; // rayon des coins
  const cx = n * 0.435, cy = n * 0.42; // centre de la loupe
  const ringOuter = n * 0.235, ringInner = n * 0.155;
  // Manche : segment épais du bord du cercle vers le coin bas-droit.
  const hx0 = cx + ringOuter * 0.72, hy0 = cy + ringOuter * 0.72;
  const hx1 = n * 0.78, hy1 = n * 0.78;
  const handleHalf = n * 0.055;

  const inRounded = (x, y) => {
    const m = n * DEFAULT_MARGIN; // marge du dessin de référence (0.03)
    const x0 = m, y0 = m, x1 = n - m, y1 = n - m;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
    const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
    return dx * dx + dy * dy <= r * r;
  };

  const onHandle = (x, y) => {
    const vx = hx1 - hx0, vy = hy1 - hy0;
    const len2 = vx * vx + vy * vy;
    let t = ((x - hx0) * vx + (y - hy0) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = hx0 + vx * t, py = hy0 + vy * t;
    const dx = x - px, dy = y - py;
    return dx * dx + dy * dy <= handleHalf * handleHalf;
  };

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let cr = 0, cg = 0, cb = 0, ca = 0;
      // Point échantillonné, dans le repère du dessin de référence.
      let sx = x + 0.5, sy = y + 0.5;
      if (k !== 1) {
        sx = half + (sx - half) * k;
        sy = half + (sy - half) * k;
      }
      if (inRounded(sx, sy)) {
        const t = k === 1 ? y / (n - 1) : Math.min(1, Math.max(0, (sy - 0.5) / (n - 1)));
        cr = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t;
        cg = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t;
        cb = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t;
        ca = 255;

        const dx = sx - cx, dy = sy - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const ring = d <= ringOuter && d >= ringInner;
        if (ring || onHandle(sx, sy)) {
          cr = FG[0]; cg = FG[1]; cb = FG[2];
        }
      }
      // Moyennage vers la grille finale
      const ox = Math.floor(x / SS), oy = Math.floor(y / SS);
      const i = (oy * size + ox) * 4;
      acc[i] += cr; acc[i + 1] += cg; acc[i + 2] += cb; acc[i + 3] += ca;
    }
  }

  const div = SS * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = Math.round(acc[i * 4] / div);
    out[i * 4 + 1] = Math.round(acc[i * 4 + 1] / div);
    out[i * 4 + 2] = Math.round(acc[i * 4 + 2] / div);
    out[i * 4 + 3] = Math.round(acc[i * 4 + 3] / div);
  }
  return out; // RGBA, ligne 0 = haut
}

/** Une image ICO : BITMAPINFOHEADER + pixels BGRA bas→haut + masque AND. */
function dibEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16); // BI_RGB

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = size - 1 - y; // bas → haut
    for (let x = 0; x < size; x++) {
      const s = (src * size + x) * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
    }
  }

  const maskRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskRow * size, 0); // 0 = opaque, l'alpha fait le reste
  return Buffer.concat([header, xor, and]);
}

export function makeIcon(outPath = OUT) {
  const images = SIZES.map((s) => dibEntry(s, render(s)));
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(SIZES.length, 4);

  let offset = 6 + 16 * SIZES.length;
  const entries = SIZES.map((size, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.concat([dir, ...entries, ...images]));
  return outPath;
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const p = makeIcon();
  console.log(`[icon] ${p} (${(fs.statSync(p).size / 1024).toFixed(0)} Ko)`);
}
