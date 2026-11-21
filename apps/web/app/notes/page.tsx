import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@opennest/ui";

import { NotesRoute } from "@/components/notes-route";

export const metadata: Metadata = {
  title: "Notes · OpenNest",
};

export default function NotesPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      }
    >
      <NotesRoute />
    </Suspense>
  );
}
