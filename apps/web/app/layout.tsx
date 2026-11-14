import type { Metadata, Viewport } from "next";

import { LocaleProvider } from "@opennest/localization";

import { AppShell } from "@/components/app-shell";
import { AppDataProvider } from "@/lib/data/app-data-provider";
import { SaveCoordinatorProvider } from "@/lib/data/save-coordinator";
import { themeColors, themeScript } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  applicationName: "OpenNest",
  title: "OpenNest — Your digital life. Your rules.",
  description: "Your digital life. Your rules. A local-first personal workspace.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "OpenNest",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
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
          <AppDataProvider>
            <SaveCoordinatorProvider>
              <AppShell>{children}</AppShell>
            </SaveCoordinatorProvider>
          </AppDataProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
