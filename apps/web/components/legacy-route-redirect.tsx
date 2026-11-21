"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { legacyRouteRedirect } from "@/lib/routes";

export function LegacyRouteRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname === null) {
      return;
    }

    const target = legacyRouteRedirect(pathname);

    if (target !== null) {
      router.replace(target);
    }
  }, [pathname, router]);

  return null;
}
