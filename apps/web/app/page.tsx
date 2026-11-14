import type { Metadata } from "next";

import { Dashboard } from "@/components/dashboard";

export const metadata: Metadata = {
  title: "OpenNest · Your digital life. Your rules.",
};

export default function HomePage() {
  return <Dashboard />;
}
