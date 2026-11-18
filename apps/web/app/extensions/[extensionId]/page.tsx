import type { Metadata } from "next";

import { ExtensionRunnerRoute } from "@/components/extension-runner";

export const metadata: Metadata = {
  title: "Extension · OpenNest",
};

export default async function ExtensionPage({
  params,
}: {
  params: Promise<{ extensionId: string }>;
}) {
  const { extensionId } = await params;

  return <ExtensionRunnerRoute extensionId={extensionId} />;
}
