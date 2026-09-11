import "server-only";

export type FileKind = "pdf" | "docx" | "doc" | "image" | "txt" | "unknown";

export function detectFileKind(buffer: Buffer, filename?: string): FileKind {
  if (buffer.length < 4) return "unknown";
  const head = buffer.subarray(0, 8);

  // %PDF
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf";

  // ZIP-based formats (DOCX is a zip with word/document.xml)
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05)) {
    // Heuristic: rely on filename for DOCX
    if (filename && /\.docx$/i.test(filename)) return "docx";
    // Search for "word/" marker in first 4KB
    const slice = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("latin1");
    if (slice.includes("word/document.xml")) return "docx";
  }

  // Old DOC
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return "doc";

  // PNG
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image";
  // JPEG
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image";

  // Heuristic: mostly printable ASCII → text
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let printable = 0;
  for (const byte of sample) {
    if ((byte >= 0x20 && byte < 0x7f) || byte === 0x09 || byte === 0x0a || byte === 0x0d) printable++;
  }
  if (printable / sample.length > 0.85) return "txt";

  return "unknown";
}
