"use client";

import { useSearchParams } from "next/navigation";

import { ExtensionRunnerRoute } from "@/components/extension-runner";
import { ExtensionsViewRoute } from "@/components/extensions-view";

export function ExtensionsRoute() {
  const searchParams = useSearchParams();
  const extensionId = searchParams.get("extensionId");

  return extensionId ? (
    <ExtensionRunnerRoute key={extensionId} extensionId={extensionId} />
  ) : (
    <ExtensionsViewRoute />
  );
}
