const MIME_EXTENSION_MAP = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

const sanitizeFileName = (fileName) =>
  fileName
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/^-+|-+$/g, "") || "vybe-media";

const getExtensionFromMedia = (media, mediaType) => {
  const dataUrlMime = media.match(/^data:([^;]+);/)?.[1];
  if (dataUrlMime && MIME_EXTENSION_MAP[dataUrlMime]) return MIME_EXTENSION_MAP[dataUrlMime];

  const cleanUrl = media.split("?")[0].split("#")[0];
  const urlExtension = cleanUrl.match(/\.([a-zA-Z0-9]+)$/)?.[1];
  if (urlExtension) return urlExtension.toLowerCase();

  return mediaType === "video" ? "mp4" : "jpg";
};

export const downloadMediaFile = async (media, mediaType = "image", baseFileName = "vybe-media") => {
  if (!media) throw new Error("Media is missing");

  const mediaUrl = String(media);
  const extension = getExtensionFromMedia(mediaUrl, mediaType);
  const fileName = `${sanitizeFileName(baseFileName)}.${extension}`;
  const link = document.createElement("a");
  link.download = fileName;
  link.rel = "noopener";

  let objectUrl = "";

  try {
    if (mediaUrl.startsWith("data:") || mediaUrl.startsWith("blob:")) {
      link.href = mediaUrl;
    } else {
      const response = await fetch(mediaUrl, { credentials: "include" });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
    }

    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    if (objectUrl) {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  }
};
