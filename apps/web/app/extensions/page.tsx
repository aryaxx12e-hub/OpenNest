import type { Metadata } from "next";

import { ExtensionsViewRoute } from "@/components/extensions-view";

export const metadata: Metadata = {
  title: "Extensions · OpenNest",
};

export default function ExtensionsPage() {
  return <ExtensionsViewRoute />;
}
