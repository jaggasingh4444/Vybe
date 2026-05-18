import crypto from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, "..", "uploads");
const dataUrlPattern = /^data:(image|video)\/([a-zA-Z0-9.+-]+);base64,(.+)$/;
const extensionMap = {
  jpeg: "jpg",
  "svg+xml": "svg",
  "quicktime": "mov",
  "x-msvideo": "avi",
};

export const isDataUrl = (value) =>
  typeof value === "string" && dataUrlPattern.test(value);

export const getPublicOrigin = (req) =>
  process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`;

export const saveDataUrlMedia = async (dataUrl, folder, req) => {
  const match = typeof dataUrl === "string" ? dataUrl.match(dataUrlPattern) : null;
  if (!match) return dataUrl;

  const [, , rawExtension, base64Data] = match;
  const extension = extensionMap[rawExtension.toLowerCase()] || rawExtension.toLowerCase();
  const safeFolder = folder.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "media";
  const directory = path.join(uploadsRoot, safeFolder);
  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`;

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), base64Data, "base64");

  return `${getPublicOrigin(req)}/uploads/${safeFolder}/${filename}`;
};
