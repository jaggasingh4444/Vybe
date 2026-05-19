import crypto from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, "..", "uploads");
const dataUrlPattern = /^data:(image|video)\/([a-zA-Z0-9.+-]+);base64,(.+)$/;
const mediaTypePattern = /^(image|video)\/([a-zA-Z0-9.+-]+)$/;
const databaseDefaultFolders = new Set(["content", "stories", "profiles"]);
const extensionMap = {
  jpeg: "jpg",
  "svg+xml": "svg",
  "quicktime": "mov",
  "x-msvideo": "avi",
};

export const isDataUrl = (value) =>
  typeof value === "string" && dataUrlPattern.test(value);

export const getPublicOrigin = (req) => {
  if (process.env.SERVER_URL) return process.env.SERVER_URL.replace(/\/$/, "");

  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || req.protocol;
  const host = forwardedHost || req.get("host");

  return `${protocol}://${host}`;
};

const getSafeFolder = (folder) =>
  folder.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "media";

const isLocalHost = (host = "") =>
  ["localhost", "127.0.0.1", "0.0.0.0"].includes(host.split(":")[0]);

const shouldStoreInDatabase = (safeFolder, req, mediaKind) => {
  const storageMode = (process.env.MEDIA_STORAGE || "").toLowerCase();

  // MongoDB documents are capped at 16 MB, so hosted videos need file storage.
  if (mediaKind === "video") return false;

  if (["db", "database", "mongo", "mongodb"].includes(storageMode)) return true;
  if (["file", "files", "filesystem", "uploads"].includes(storageMode)) return false;

  const host = req?.get?.("x-forwarded-host") || req?.get?.("host") || "";
  return databaseDefaultFolders.has(safeFolder) && !isLocalHost(host);
};

export const saveDataUrlMedia = async (dataUrl, folder, req) => {
  const match = typeof dataUrl === "string" ? dataUrl.match(dataUrlPattern) : null;
  if (!match) return dataUrl;

  const [, mediaKind, rawExtension, base64Data] = match;
  const extension = extensionMap[rawExtension.toLowerCase()] || rawExtension.toLowerCase();
  const safeFolder = getSafeFolder(folder);

  if (shouldStoreInDatabase(safeFolder, req, mediaKind)) {
    return dataUrl;
  }

  const directory = path.join(uploadsRoot, safeFolder);
  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`;

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), base64Data, "base64");

  return `${getPublicOrigin(req)}/uploads/${safeFolder}/${filename}`;
};

export const isStoredMediaUrl = (value) =>
  typeof value === "string" &&
  (/^https?:\/\/.+\/uploads\/[^?#]+\/[^?#]+/.test(value) ||
    value.startsWith("/uploads/"));

export const saveBinaryMedia = async (buffer, mimeType, folder, req) => {
  const match = typeof mimeType === "string" ? mimeType.match(mediaTypePattern) : null;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || !match) return "";

  const [, , rawExtension] = match;
  const extension = extensionMap[rawExtension.toLowerCase()] || rawExtension.toLowerCase();
  const safeFolder = getSafeFolder(folder);
  const directory = path.join(uploadsRoot, safeFolder);
  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`;

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), buffer);

  return `${getPublicOrigin(req)}/uploads/${safeFolder}/${filename}`;
};
