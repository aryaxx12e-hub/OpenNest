import type { Metadata } from "next";

import { PrivacyCenter } from "@/components/privacy-center";

export const metadata: Metadata = {
  title: "OpenNest · Privacy",
};

export default function PrivacyPage() {
  return <PrivacyCenter />;
}
