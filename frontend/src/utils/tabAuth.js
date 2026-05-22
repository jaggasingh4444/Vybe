import { API_BASE_URL } from "../config/api";

const TAB_AUTH_TOKEN_KEY = "vybe-tab-auth-token";
const PERSISTENT_AUTH_TOKEN_KEY = "vybe-auth-token";
const TAB_LOGGED_OUT_KEY = "vybe-tab-logged-out";

export const getTabAuthToken = () => {
  if (typeof window === "undefined") return "";
  if (window.sessionStorage.getItem(TAB_LOGGED_OUT_KEY) === "1") return "";

  return (
    window.sessionStorage.getItem(TAB_AUTH_TOKEN_KEY) ||
    window.localStorage.getItem(PERSISTENT_AUTH_TOKEN_KEY) ||
    ""
  );
};

export const setTabAuthToken = (token) => {
  if (typeof window === "undefined" || !token) return;
  window.sessionStorage.removeItem(TAB_LOGGED_OUT_KEY);
  window.sessionStorage.setItem(TAB_AUTH_TOKEN_KEY, token);
  window.localStorage.setItem(PERSISTENT_AUTH_TOKEN_KEY, token);
};

export const clearTabAuthToken = ({ persistent = true } = {}) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TAB_AUTH_TOKEN_KEY);
  if (persistent) {
    window.localStorage.removeItem(PERSISTENT_AUTH_TOKEN_KEY);
  }
};

export const markTabLoggedOut = () => {
  if (typeof window === "undefined") return;
  clearTabAuthToken();
  window.sessionStorage.setItem(TAB_LOGGED_OUT_KEY, "1");
};

export const isTabLoggedOut = () => {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(TAB_LOGGED_OUT_KEY) === "1";
};

export const withTabAuth = (url) => {
  const token = getTabAuthToken();
  if (!token || typeof window === "undefined") return url;

  const nextUrl = new URL(url, window.location.href);
  nextUrl.searchParams.set("token", token);
  return nextUrl.toString();
};

export const getTabAuthHeaders = (headers = {}) => {
  const nextHeaders = new Headers(headers);
  const token = getTabAuthToken();

  if (token && !nextHeaders.has("Authorization")) {
    nextHeaders.set("Authorization", `Bearer ${token}`);
  }

  return nextHeaders;
};

export const installTabAuthFetch = () => {
  if (typeof window === "undefined" || window.__vybeTabAuthFetchInstalled) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const token = getTabAuthToken();
    const url = typeof input === "string" ? input : input?.url;
    const isApiRequest = typeof url === "string" && url.startsWith(API_BASE_URL);

    if (!token || !isApiRequest) {
      return nativeFetch(input, init);
    }

    const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return nativeFetch(input, {
      ...init,
      headers,
    });
  };

  window.__vybeTabAuthFetchInstalled = true;
};
