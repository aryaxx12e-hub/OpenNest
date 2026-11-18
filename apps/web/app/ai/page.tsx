import type { Metadata } from "next";

import { AiConsoleRoute } from "@/components/ai-console";

export const metadata: Metadata = {
  title: "OpenNest · AI console",
};

export default function AiPage() {
  return <AiConsoleRoute />;
}
