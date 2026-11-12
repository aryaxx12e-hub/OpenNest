export type ThemeName = "light" | "dark";

export type ThemeTokens = {
  background: string;
  surface: string;
  primary: string;
  primaryForeground: string;
  foreground: string;
  muted: string;
  border: string;
};

export const tokens: Record<ThemeName, ThemeTokens> = {
  light: {
    background: "#faf8f3",
    surface: "#ffffff",
    primary: "#1f4d3a",
    primaryForeground: "#ffffff",
    foreground: "#1f2420",
    muted: "#5c6660",
    border: "#e3ded2",
  },
  dark: {
    background: "#171a19",
    surface: "#1f2422",
    primary: "#6fbf95",
    primaryForeground: "#101713",
    foreground: "#f2efe8",
    muted: "#a8b0ab",
    border: "#333a37",
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
