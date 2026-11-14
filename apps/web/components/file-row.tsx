import Link from "next/link";

import type { StoredFile } from "@opennest/core";
import { useLocale } from "@opennest/localization";

import { extensionOf } from "@/lib/files";
import { formatBytes, formatCalendarDate } from "@/lib/format";

export function FileRow({ file }: { file: StoredFile }) {
  const { locale } = useLocale();
  const extension = extensionOf(file.name).toUpperCase().slice(0, 3);

  return (
    <li>
      <Link
        href={`/files/${file.id}`}
        className="hover:bg-border/30 flex min-h-14 items-center gap-3 px-3 py-2 transition-colors"
      >
        <span
          aria-hidden="true"
          className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg text-[10px] font-bold"
        >
          {extension.length === 0 ? "FILE" : extension}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{file.name}</span>
          <span className="text-muted block truncate text-xs">
            {formatBytes(locale, file.sizeBytes)} ·{" "}
            {formatCalendarDate(locale, file.updatedAt)}
          </span>
        </span>
      </Link>
    </li>
  );
}
