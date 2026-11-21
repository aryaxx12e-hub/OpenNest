import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@opennest/ui";

import { FilesRoute } from "@/components/files-route";

export const metadata: Metadata = {
  title: "File · OpenNest",
};

export default function FilesPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <FilesRoute />
    </Suspense>
  );
}
