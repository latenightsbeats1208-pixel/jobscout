// ============================================================================
// installer/macho.mjs
//
// Reconnaît un exécutable par son CONTENU, jamais par son nom : Mach-O (macOS),
// PE (Windows) et ELF (Linux), et lit les architectures d'un Mach-O. Partagé
// par l'anti-fuite (check-leaks.mjs), les gardes du build Mac et la recette.
// Module sans effet de bord à l'import, uniquement des modules node:.
//
//   Mach-O fin : feedface / cefaedfe (32 bits), feedfacf / cffaedfe (64 bits),
//                lus en big-endian sur les 4 premiers octets.
//   Mach-O fat : cafebabe (fat_arch) ou cafebabf (fat_arch_64), big-endian,
//                avec 1 <= nfat_arch <= 30. La borne écarte les classes Java,
//                qui commencent aussi par cafebabe mais portent ensuite leur
//                numéro de version (45 ou plus).
//   PE         : « MZ », puis « PE\0\0 » à l'offset lu en 0x3c. « MZ » seul ne
//                suffit pas : un fichier texte peut commencer par ces lettres.
//   ELF        : 7f 45 4c 46, puis la classe 1 (32 bits) ou 2 (64 bits).
//
// Aucun fichier texte UTF-8 ne commence par une signature Mach-O (fe, ca fe,
// ce fa, cf fa ne sont pas des débuts UTF-8 valides) : un texte n'est jamais
// pris pour un Mach-O, et la vérification « PE\0\0 » écarte un texte « MZ… ».
// ============================================================================
import fs from "node:fs";
import path from "node:path";

/** Octets lus en tête de fichier : couvrent l'en-tête fat (8 + 30 × 32 octets). */
export const HEAD_BYTES = 4096;

/** Nombre maximal d'architectures d'un Mach-O fat (au-delà : classe Java). */
export const MAX_FAT_ARCHS = 30;

const MH_MAGIC = 0xfeedface;
const MH_CIGAM = 0xcefaedfe;
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const THIN = new Set([MH_MAGIC, MH_CIGAM, MH_MAGIC_64, MH_CIGAM_64]);

/** @param {Uint8Array} buf */
function asBuffer(buf) {
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Nature d'un exécutable d'après ses premiers octets.
 * @param {Uint8Array | null | undefined} buf  le fichier entier, ou au moins
 *        ses HEAD_BYTES premiers octets (pour un PE dont l'en-tête est plus
 *        loin, utiliser fileBinaryKind).
 * @returns {"macho" | "macho-fat" | "pe" | "elf" | null}
 */
export function binaryKind(buf) {
  if (!buf || buf.length < 4) return null;
  const b = asBuffer(buf);
  const magic = b.readUInt32BE(0);
  // En-tête mach_header : 28 octets (32 bits), 32 octets (64 bits).
  if (THIN.has(magic)) return b.length >= 28 ? "macho" : null;
  if (magic === FAT_MAGIC || magic === FAT_MAGIC_64) {
    if (b.length < 8) return null;
    const n = b.readUInt32BE(4);
    return n >= 1 && n <= MAX_FAT_ARCHS ? "macho-fat" : null;
  }
  if (b[0] === 0x4d && b[1] === 0x5a) {
    if (b.length < 0x40) return null;
    const pe = b.readUInt32LE(0x3c);
    if (pe + 4 > b.length) return null;
    return b.readUInt32BE(pe) === 0x50450000 ? "pe" : null;
  }
  if (magic === 0x7f454c46) return b.length >= 5 && (b[4] === 1 || b[4] === 2) ? "elf" : null;
  return null;
}

/** Vrai pour un Mach-O (fin ou fat), un PE ou un ELF. */
export function isExecutableBinary(buf) {
  return binaryKind(buf) !== null;
}

/** Vrai pour un Mach-O, fin ou fat. */
export function isMachO(buf) {
  const k = binaryKind(buf);
  return k === "macho" || k === "macho-fat";
}

/**
 * Nom d'architecture, comme l'affiche `lipo -archs`.
 * @param {number} cputype
 * @param {number} cpusubtype
 */
export function archName(cputype, cpusubtype = 0) {
  const cpu = cputype >>> 0;
  // Les 8 bits de poids fort du sous-type sont des capacités (CPU_SUBTYPE_MASK).
  const sub = (cpusubtype >>> 0) & 0x00ffffff;
  switch (cpu) {
    case 0x01000007:
      return sub === 8 ? "x86_64h" : "x86_64";
    case 0x00000007:
      return "i386";
    case 0x0100000c:
      return sub === 2 ? "arm64e" : "arm64";
    case 0x0200000c:
      return "arm64_32";
    case 0x0000000c:
      return { 6: "armv6", 9: "armv7", 11: "armv7s", 12: "armv7k" }[sub] ?? "arm";
    case 0x00000012:
      return "ppc";
    case 0x01000012:
      return "ppc64";
    default:
      return `cpu-0x${cpu.toString(16)}`;
  }
}

/**
 * Architectures d'un Mach-O, dans l'ordre du fichier (celui de `lipo -archs`).
 * @param {Uint8Array | null | undefined} buf  début du fichier (HEAD_BYTES suffisent)
 * @returns {string[] | null}  null si ce n'est pas un Mach-O lisible
 */
export function machOArchs(buf) {
  const kind = binaryKind(buf);
  if (!buf || (kind !== "macho" && kind !== "macho-fat")) return null;
  const b = asBuffer(buf);
  const magic = b.readUInt32BE(0);
  if (kind === "macho") {
    const le = magic === MH_CIGAM || magic === MH_CIGAM_64;
    const cpu = le ? b.readUInt32LE(4) : b.readUInt32BE(4);
    const sub = le ? b.readUInt32LE(8) : b.readUInt32BE(8);
    return [archName(cpu, sub)];
  }
  const entry = magic === FAT_MAGIC_64 ? 32 : 20;
  const n = b.readUInt32BE(4);
  if (8 + n * entry > b.length) return null;
  const archs = [];
  for (let i = 0; i < n; i++) {
    const off = 8 + i * entry;
    archs.push(archName(b.readUInt32BE(off), b.readUInt32BE(off + 4)));
  }
  return archs;
}

/** Les `bytes` premiers octets d'un fichier (moins s'il est plus court). */
export function readHead(file, bytes = HEAD_BYTES) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Nature d'un fichier sur disque, sans le lire en entier. Même verdict que
 * binaryKind(fichier entier), y compris pour un PE dont l'en-tête est au-delà
 * des HEAD_BYTES premiers octets.
 * @returns {"macho" | "macho-fat" | "pe" | "elf" | null}
 */
export function fileBinaryKind(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, head, 0, HEAD_BYTES, 0);
    const h = head.subarray(0, n);
    if (n >= 0x40 && h[0] === 0x4d && h[1] === 0x5a) {
      const pe = h.readUInt32LE(0x3c);
      if (pe + 4 > n) {
        const sig = Buffer.alloc(4);
        const got = fs.readSync(fd, sig, 0, 4, pe);
        return got === 4 && sig.readUInt32BE(0) === 0x50450000 ? "pe" : null;
      }
    }
    return binaryKind(h);
  } finally {
    fs.closeSync(fd);
  }
}

/** Architectures d'un Mach-O sur disque, ou null. */
export function fileMachOArchs(file) {
  return machOArchs(readHead(file));
}

/**
 * Inventaire des exécutables d'une arborescence, par le contenu. Les liens
 * symboliques ne sont ni suivis ni lus.
 * @param {string} root
 * @param {{ kinds?: string[] }} [options]  limiter à certaines natures
 *        (par exemple ["macho", "macho-fat"])
 * @returns {Array<{ path: string, kind: string, archs: string[] | null }>}
 *        chemins relatifs à `root`, séparateur « / », triés
 */
export function findExecutables(root, { kinds } = {}) {
  const found = [];
  const visit = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(p, r);
      else if (entry.isFile()) {
        const kind = fileBinaryKind(p);
        if (!kind || (kinds && !kinds.includes(kind))) continue;
        found.push({
          path: r,
          kind,
          archs: kind === "macho" || kind === "macho-fat" ? fileMachOArchs(p) : null,
        });
      }
    }
  };
  visit(root, "");
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
