export type ThemeName = "light" | "dark";

export type ThemeTokens = {
  background: string;
  surface: string;
  surfaceMuted: string;
  primary: string;
  primaryForeground: string;
  primarySoft: string;
  accent: string;
  accentSoft: string;
  foreground: string;
  muted: string;
  border: string;
};

export const tokens: Record<ThemeName, ThemeTokens> = {
  light: {
    background: "#f5f4f0",
    surface: "#ffffff",
    surfaceMuted: "#eeece6",
    primary: "#0f6b6b",
    primaryForeground: "#ffffff",
    primarySoft: "#dcefea",
    accent: "#8a4b24",
    accentSoft: "#f6e7da",
    foreground: "#18211e",
    muted: "#5e6a64",
    border: "#e1ded6",
  },
  dark: {
    background: "#0d1412",
    surface: "#151f1c",
    surfaceMuted: "#1c2925",
    primary: "#6fd3c4",
    primaryForeground: "#08201c",
    primarySoft: "#173b35",
    accent: "#e7b58a",
    accentSoft: "#3a2a1e",
    foreground: "#eef3f0",
    muted: "#a5b2ac",
    border: "#2a3733",
  },
};

export type Pair = {
  foreground: keyof ThemeTokens;
  background: keyof ThemeTokens;
  label: string;
  min: number;
};

export const contrastPairs: Pair[] = [
  {
    label: "body text on background",
    foreground: "foreground",
    background: "background",
    min: 4.5,
  },
  {
    label: "body text on surface",
    foreground: "foreground",
    background: "surface",
    min: 4.5,
  },
  {
    label: "muted text on background",
    foreground: "muted",
    background: "background",
    min: 4.5,
  },
  {
    label: "muted text on surface",
    foreground: "muted",
    background: "surface",
    min: 4.5,
  },
  {
    label: "muted text on muted surface",
    foreground: "muted",
    background: "surfaceMuted",
    min: 4.5,
  },
  {
    label: "body text on primary soft",
    foreground: "foreground",
    background: "primarySoft",
    min: 4.5,
  },
  {
    label: "body text on accent soft",
    foreground: "foreground",
    background: "accentSoft",
    min: 4.5,
  },
  {
    label: "accent text on accent soft",
    foreground: "accent",
    background: "accentSoft",
    min: 4.5,
  },
  {
    label: "primary text on primary soft",
    foreground: "primary",
    background: "primarySoft",
    min: 3,
  },
  {
    label: "primary text on background",
    foreground: "primary",
    background: "background",
    min: 3,
  },
  {
    label: "primary text on surface",
    foreground: "primary",
    background: "surface",
    min: 3,
  },
  {
    label: "button label on primary",
    foreground: "primaryForeground",
    background: "primary",
    min: 4.5,
  },
];
