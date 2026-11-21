import { useSyncExternalStore } from "react";

export interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

export function isNativeApp(): boolean {
  return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.() === true;
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

export function useIsNativeApp(): boolean {
  return useSyncExternalStore(subscribeToNothing, isNativeApp, () => false);
}
