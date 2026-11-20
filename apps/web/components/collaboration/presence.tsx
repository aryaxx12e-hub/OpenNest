"use client";

import { useTranslations } from "@opennest/localization";
import { cn } from "@opennest/ui";

import type { CollaborationParticipant } from "@/lib/collaboration/provider";

export interface PresenceProps {
  participants: readonly CollaborationParticipant[];
  className?: string;
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  const first = Array.from(trimmed)[0];

  return first === undefined ? "?" : first.toUpperCase();
}

export function Presence({ participants, className }: PresenceProps) {
  const t = useTranslations();

  if (participants.length === 0) {
    return null;
  }

  return (
    <ul
      aria-label={t("collaboration.presence")}
      className={cn("flex flex-wrap items-center gap-1", className)}
    >
      {participants.map((participant) => {
        const name =
          participant.displayName.trim().length === 0
            ? t("collaboration.unknownMember")
            : participant.displayName.trim();

        return (
          <li key={participant.connectionId} title={name}>
            <span
              aria-hidden="true"
              className="border-surface inline-flex size-7 items-center justify-center rounded-full border-2 text-[11px] font-semibold text-white shadow-sm"
              style={{ backgroundColor: participant.color }}
            >
              {initialOf(name)}
            </span>
            <span className="sr-only">{name}</span>
          </li>
        );
      })}
    </ul>
  );
}
