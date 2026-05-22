import crypto from "crypto";
import { mkdir, writeFile } from "fs/promises";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, "..", "uploads");
const databaseBucketName = "vybeMedia";
const dataUrlPattern = /^data:(image|video)\/([a-zA-Z0-9.+-]+);base64,(.+)$/;
const mediaTypePattern = /^(image|video)\/([a-zA-Z0-9.+-]+)$/;
const databaseDefaultFolders = new Set(["chat", "content", "stories", "profiles"]);
const extensionMap = {
  jpeg: "jpg",
  "svg+xml": "svg",
  "quicktime": "mov",
  "x-msvideo": "avi",
};
const extensionMimeMap = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  ogv: "video/ogg",
  ogg: "video/ogg",
  "3gp": "video/3gpp",
};

export const isDataUrl = (value) =>
  typeof value === "string" && dataUrlPattern.test(value);

export const inferMediaInfo = ({ mimeType = "", fileName = "", fallbackMediaType = "" } = {}) => {
  const normalizedMime = typeof mimeType === "string" ? mimeType.split(";")[0].trim().toLowerCase() : "";
  const directMatch = normalizedMime.match(mediaTypePattern);

  if (directMatch) {
    return {
      mediaKind: directMatch[1],
      mimeType: normalizedMime,
    };
  }

  const extension = typeof fileName === "string"
    ? fileName.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase()
    : "";
  const inferredMime = extension ? extensionMimeMap[extension] : "";
  const inferredMatch = inferredMime.match(mediaTypePattern);

  if (inferredMatch) {
    return {
      mediaKind: inferredMatch[1],
      mimeType: inferredMime,
    };
  }

  if (fallbackMediaType === "image") {
    return {
      mediaKind: "image",
      mimeType: "image/jpeg",
    };
  }

  if (fallbackMediaType === "video") {
    return {
      mediaKind: "video",
      mimeType: "video/mp4",
    };
  }

  return {
    mediaKind: "",
    mimeType: normalizedMime,
  };
};

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

  if (["db", "database", "mongo", "mongodb"].includes(storageMode)) return true;
  if (["file", "files", "filesystem", "uploads"].includes(storageMode)) return false;

  let configuredHost = "";
  try {
    configuredHost = process.env.SERVER_URL ? new URL(process.env.SERVER_URL).host : "";
  } catch {
    configuredHost = "";
  }

  const host = req?.get?.("x-forwarded-host") || req?.get?.("host") || configuredHost;
  return databaseDefaultFolders.has(safeFolder) && !isLocalHost(host);
};

const saveBufferToDatabase = (buffer, mimeType, safeFolder, mediaKind, extension) =>
  new Promise((resolve, reject) => {
    if (!mongoose.connection.db) {
      reject(new Error("Database media storage is not ready"));
      return;
    }

    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: databaseBucketName,
    });
    const filename = `${safeFolder}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: mimeType,
      metadata: {
        folder: safeFolder,
        mediaKind,
      },
    });

    uploadStream.once("error", reject);
    uploadStream.once("finish", () => resolve(`/api/media/${uploadStream.id.toString()}`));
    uploadStream.end(buffer);
  });

export const saveDataUrlMedia = async (dataUrl, folder, req) => {
  const match = typeof dataUrl === "string" ? dataUrl.match(dataUrlPattern) : null;
  if (!match) return dataUrl;

  const [, mediaKind, rawExtension, base64Data] = match;
  const extension = extensionMap[rawExtension.toLowerCase()] || rawExtension.toLowerCase();
  const safeFolder = getSafeFolder(folder);

  if (shouldStoreInDatabase(safeFolder, req, mediaKind)) {
    return saveBufferToDatabase(
      Buffer.from(base64Data, "base64"),
      `${mediaKind}/${rawExtension}`,
      safeFolder,
      mediaKind,
      extension
    );
  }

  const directory = path.join(uploadsRoot, safeFolder);
  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`;

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), base64Data, "base64");

  return `/uploads/${safeFolder}/${filename}`;
};

export const isStoredMediaUrl = (value) =>
  typeof value === "string" &&
  (/^https?:\/\/.+\/uploads\/[^?#]+\/[^?#]+/.test(value) ||
    /^https?:\/\/.+\/api\/media\/[^?#]+/.test(value) ||
    value.startsWith("/uploads/") ||
    value.startsWith("/api/media/"));

export const saveBinaryMedia = async (buffer, mimeType, folder, req, options = {}) => {
  const mediaInfo = inferMediaInfo({
    mimeType,
    fileName: options.fileName,
    fallbackMediaType: options.mediaType,
  });
  const match = mediaInfo.mimeType.match(mediaTypePattern);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || !match || !mediaInfo.mediaKind) return "";

  const [, mediaKind, rawExtension] = match;
  const extension = extensionMap[rawExtension.toLowerCase()] || rawExtension.toLowerCase();
  const safeFolder = getSafeFolder(folder);

  if (shouldStoreInDatabase(safeFolder, req, mediaKind)) {
    return saveBufferToDatabase(buffer, mediaInfo.mimeType, safeFolder, mediaKind, extension);
  }

  const directory = path.join(uploadsRoot, safeFolder);
  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`;

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), buffer);

  return `/uploads/${safeFolder}/${filename}`;
};
