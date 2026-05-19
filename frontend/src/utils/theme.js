import { useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "vybe-theme";

const normalizeTheme = (theme) => (theme === "light" ? "light" : "dark");

export const getStoredTheme = () => {
  if (typeof window === "undefined") return "dark";
  return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
};

export const applyTheme = (theme, active = true) => {
  if (typeof document === "undefined") return;

  const normalizedTheme = normalizeTheme(theme);
  const isLight = active && normalizedTheme === "light";

  document.documentElement.classList.toggle("vybe-light", isLight);
  document.body.classList.toggle("vybe-light", isLight);
  document.body.classList.toggle("vybe-theme-active", Boolean(active));
  document.documentElement.style.colorScheme = isLight ? "light" : "dark";
};

export const setStoredTheme = (theme) => {
  if (typeof window === "undefined") return;

  const normalizedTheme = normalizeTheme(theme);
  window.localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
  applyTheme(normalizedTheme);
  window.dispatchEvent(
    new CustomEvent("vybe:theme-change", {
      detail: { theme: normalizedTheme },
    })
  );
};

export const useThemePreference = () => {
  const [theme, setThemeState] = useState(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);

    const handleThemeChange = (event) => {
      setThemeState(normalizeTheme(event.detail?.theme));
    };
    const handleStorage = (event) => {
      if (event.key === THEME_STORAGE_KEY) {
        const nextTheme = normalizeTheme(event.newValue);
        setThemeState(nextTheme);
        applyTheme(nextTheme);
      }
    };

    window.addEventListener("vybe:theme-change", handleThemeChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("vybe:theme-change", handleThemeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [theme]);

  const setTheme = (nextTheme) => {
    const resolvedTheme =
      typeof nextTheme === "function" ? nextTheme(getStoredTheme()) : nextTheme;
    setStoredTheme(resolvedTheme);
  };

  return [theme, setTheme];
};
