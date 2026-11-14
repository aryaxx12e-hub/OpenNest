import { Suspense } from "react";

import { SearchView } from "@/components/search-view";
import { Skeleton } from "@opennest/ui";

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      }
    >
      <SearchView />
    </Suspense>
  );
}
