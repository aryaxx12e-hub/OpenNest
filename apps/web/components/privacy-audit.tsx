"use client";

import { useLocale, useTranslations } from "@opennest/localization";
import { Card } from "@opennest/ui";

import type { AuditEntry } from "@opennest/privacy";

import { formatDateTime } from "@/lib/format";

const EVENT_KEYS: Partial<Record<AuditEntry["event"], string>> = {
  "ai.requested": "privacy.audit.events.ai.requested",
  "ai.completed": "privacy.audit.events.ai.completed",
  "ai.failed": "privacy.audit.events.ai.failed",
  "ai.aborted": "privacy.audit.events.ai.aborted",
  "extension.installed": "privacy.audit.events.extension.installed",
  "extension.updated": "privacy.audit.events.extension.updated",
  "extension.enabled": "privacy.audit.events.extension.enabled",
  "extension.disabled": "privacy.audit.events.extension.disabled",
  "extension.uninstalled": "privacy.audit.events.extension.uninstalled",
  "extension.started": "privacy.audit.events.extension.started",
  "extension.terminated": "privacy.audit.events.extension.terminated",
  "extension.integrity_failed": "privacy.audit.events.extension.integrity_failed",
  "extension.safe_mode": "privacy.audit.events.extension.safe_mode",
};

export function PrivacyAudit({ entries }: { entries: readonly AuditEntry[] }) {
  const t = useTranslations();
  const { locale } = useLocale();

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("privacy.audit.title")}</h2>
        <p className="text-muted text-sm leading-6">{t("privacy.audit.description")}</p>
      </div>

      {entries.length === 0 ? (
        <p role="status" className="text-muted text-sm">
          {t("privacy.audit.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-muted border-border border-b text-xs uppercase">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.audit.sequence")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.audit.event")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.audit.outcome")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.audit.capability")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("privacy.audit.time")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="text-muted py-2 pr-3 font-mono text-xs">
                    {entry.sequence}
                  </td>
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {EVENT_KEYS[entry.event] === undefined
                      ? entry.event
                      : t(EVENT_KEYS[entry.event]!)}
                  </th>
                  <td className="text-muted py-2 pr-3">
                    {t(`privacy.audit.outcomes.${entry.outcome}`)}
                  </td>
                  <td className="text-muted py-2 pr-3 font-mono text-xs">
                    {entry.capability ?? t("privacy.audit.noCapability")}
                  </td>
                  <td className="text-muted py-2">
                    {formatDateTime(locale, new Date(entry.at).toISOString())}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-muted text-xs leading-5">{t("privacy.audit.integrity")}</p>
    </Card>
  );
}
