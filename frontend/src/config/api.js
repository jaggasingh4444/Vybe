export const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

export const apiUrl = (path) => `${API_BASE_URL}${path}`;

export const mediaUrl = (value) => {
  if (!value || typeof value !== "string") return "";
  if (value.startsWith("data:") || value.startsWith("blob:")) return value;
  if (value.startsWith("/uploads/")) return `${API_BASE_URL}${value}`;

  try {
    const url = new URL(value);
    const localUpload =
      ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname) &&
      url.pathname.startsWith("/uploads/");

    if (localUpload) {
      return `${API_BASE_URL}${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return value;
  }

  return value;
};
