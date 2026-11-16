// Everything about media files in one place: strict filename validation (no path
// traversal), type allowlist, magic-byte sniffing, signed URLs, ranged reads.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { signMedia } from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const mediaDir = path.join(__dirname, "..", "media");

export const MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm",
};
const VIDEO = new Set(["mp4", "mov", "m4v", "webm"]);

// Only names we generate ourselves are ever accepted: <timestamp>-<8 hex>.<ext>
const NAME_RE = new RegExp(`^\\d{10,}-[0-9a-f]{8}\\.(${Object.keys(MIME).join("|")})$`);

export const isValidMediaName = (n) => typeof n === "string" && NAME_RE.test(n);
export const extOf = (n) => path.extname(n).slice(1).toLowerCase();
export const typeOf = (n) => (VIDEO.has(extOf(n)) ? "video" : "image");
export const isAllowedExt = (n) => extOf(n) in MIME;

/** Absolute path for a stored media name; throws on anything unexpected. */
export function mediaFile(name) {
  if (!isValidMediaName(name)) throw new Error("Invalid media reference.");
  const full = path.join(mediaDir, name);
  if (!fs.existsSync(full)) throw new Error("Media file is missing from disk.");
  return full;
}

export function mediaUrl(name, ttlSec) {
  if (!isValidMediaName(name)) throw new Error("Invalid media reference.");
  const { exp, sig } = signMedia(name, ttlSec);
  return `${config.publicBaseUrl}/media/${name}?exp=${exp}&sig=${sig}`;
}

/** Check the file's leading bytes really match its extension. */
export function sniffMatchesExtension(fullPath, name) {
  const fd = fs.openSync(fullPath, "r");
  const b = Buffer.alloc(16);
  try { fs.readSync(fd, b, 0, 16, 0); } finally { fs.closeSync(fd); }
  const ext = extOf(name);
  if (ext === "jpg" || ext === "jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === "png") return b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (ext === "gif") return b.subarray(0, 3).toString("latin1") === "GIF";
  if (ext === "webp") return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
  if (ext === "mp4" || ext === "mov" || ext === "m4v") return b.subarray(4, 8).toString("latin1") === "ftyp";
  if (ext === "webm") return b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

export const fileSize = (name) => fs.statSync(mediaFile(name)).size;

/** Read [start, end) without loading the whole file into memory. */
export async function readRange(name, start, end) {
  const fh = await fs.promises.open(mediaFile(name), "r");
  try {
    const buf = Buffer.alloc(end - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export function deleteMediaFile(name) {
  if (!isValidMediaName(name)) return;
  fs.rm(path.join(mediaDir, name), { force: true }, () => {});
}
