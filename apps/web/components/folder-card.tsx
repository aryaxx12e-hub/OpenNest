import Link from "next/link";

import type { Folder } from "@opennest/core";

export function FolderCard({ folder }: { folder: Folder }) {
  return (
    <Link
      href={`/library/${folder.id}`}
      className="border-border bg-surface hover:bg-border/20 flex min-h-16 items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
    >
      <span
        aria-hidden="true"
        className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3l2 2h7a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z"
          />
        </svg>
      </span>
      <span className="min-w-0 truncate text-sm font-medium">{folder.name}</span>
    </Link>
  );
}
