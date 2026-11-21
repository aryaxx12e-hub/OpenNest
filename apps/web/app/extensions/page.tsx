import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@opennest/ui";

import { ExtensionsRoute } from "@/components/extensions-route";

export const metadata: Metadata = {
  title: "Extensions · OpenNest",
};

export default function ExtensionsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      }
    >
      <ExtensionsRoute />
    </Suspense>
  );
}
