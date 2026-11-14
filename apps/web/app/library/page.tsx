import type { Metadata } from "next";

import { LibraryBrowser } from "@/components/library-browser";

export const metadata: Metadata = {
  title: "My Library · OpenNest",
};

export default function LibraryPage() {
  return <LibraryBrowser folderId={null} />;
}
