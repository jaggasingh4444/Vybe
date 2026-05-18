const devApiBaseUrl =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : "http://localhost:8000";

export const API_BASE_URL = import.meta.env.VITE_API_URL || devApiBaseUrl;

export const apiUrl = (path) => `${API_BASE_URL}${path}`;
