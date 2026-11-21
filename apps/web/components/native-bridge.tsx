"use client";

import { useEffect } from "react";

import { useIsNativeApp } from "@/lib/native";
import { isDarkTheme, subscribeToTheme } from "@/lib/theme";

export type BackNavigationResult = "dialog" | "history" | "exit";

export function handleBackNavigation(exit: () => void): BackNavigationResult {
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");

  if (dialog !== null && dialog.getAttribute("aria-busy") !== "true") {
    dialog.close();
    return "dialog";
  }

  if (window.history.length > 1) {
    window.history.back();
    return "history";
  }

  exit();
  return "exit";
}

export function NativeBridge() {
  const native = useIsNativeApp();

  useEffect(() => {
    if (!native) {
      return;
    }

    let disposed = false;
    let removeThemeListener: (() => void) | undefined;
    let removeBackListener: (() => void) | undefined;

    void (async () => {
      const { SystemBars, SystemBarsStyle } = await import("@capacitor/core");

      if (disposed) {
        return;
      }

      const applySystemBars = () => {
        void SystemBars.setStyle({
          style: isDarkTheme() ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
        }).catch(() => undefined);
      };

      applySystemBars();
      removeThemeListener = subscribeToTheme(applySystemBars);

      const { App } = await import("@capacitor/app");

      if (disposed) {
        return;
      }

      const listener = await App.addListener("backButton", () => {
        handleBackNavigation(() => {
          void App.exitApp();
        });
      });

      if (disposed) {
        await listener.remove();
        return;
      }

      removeBackListener = () => {
        void listener.remove();
      };
    })().catch(() => undefined);

    return () => {
      disposed = true;
      removeThemeListener?.();
      removeBackListener?.();
    };
  }, [native]);

  return null;
}
