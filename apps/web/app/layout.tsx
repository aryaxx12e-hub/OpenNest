import type { Metadata, Viewport } from "next";

import { LocaleProvider } from "@opennest/localization";

import { AppShell } from "@/components/app-shell";
import { themeColors, themeScript } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "OpenNest — Your digital life. Your rules.",
  description: "Your digital life. Your rules. A local-first personal workspace.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: themeColors.light,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <LocaleProvider>
          <AppShell>{children}</AppShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
