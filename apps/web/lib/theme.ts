import { tokens } from "./tokens";

export const THEME_STORAGE_KEY = "opennest.theme";

export const THEME_CHANGE_EVENT = "opennest:theme";

export const themeColors = {
  light: tokens.light.background,
  dark: tokens.dark.background,
} as const;

export const themeScript = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var d=s==="dark"||(s===null&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?${JSON.stringify(
  themeColors.dark
)}:${JSON.stringify(themeColors.light)});}catch(e){}})();`;

export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function setTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta !== null) {
    meta.content = dark ? themeColors.dark : themeColors.light;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // Storage can be blocked; the theme still applies for this session.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function subscribeToTheme(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
