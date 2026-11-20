"use client";

import { useLocale, useTranslations } from "@opennest/localization";
import type { AiProviderConfig } from "@opennest/ai";
import type { ConsentRecord } from "@opennest/privacy";
import { Badge, Button, Card } from "@opennest/ui";

import { formatDateTime } from "@/lib/format";

export interface PrivacyConsentsProps {
  consents: readonly ConsentRecord[];
  providers?: readonly AiProviderConfig[];
  busyId?: string | null;
  now: number;
  onRevoke?: (id: string) => void | Promise<void>;
}

type ConsentStatus = "revoked" | "used" | "expired" | "ready";

function statusOf(record: ConsentRecord, now: number): ConsentStatus {
  if (record.revokedAt !== null) {
    return "revoked";
  }

  if (record.usedAt !== null) {
    return "used";
  }

  if (record.expiresAt <= now) {
    return "expired";
  }

  return "ready";
}

const statusTone = {
  revoked: "neutral",
  used: "success",
  expired: "warning",
  ready: "primary",
} as const;

export function PrivacyConsents({
  consents,
  providers = [],
  busyId = null,
  now,
  onRevoke,
}: PrivacyConsentsProps) {
  const t = useTranslations();
  const { locale } = useLocale();
  const providerLabels = new Map(
    providers.map((provider) => [provider.id, provider.label])
  );

  function revokeButton(consent: ConsentRecord, status: ConsentStatus) {
    if (onRevoke === undefined || status === "revoked") {
      return null;
    }

    const busy = busyId === consent.id;

    return (
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={() => void onRevoke(consent.id)}
      >
        {busy ? t("privacy.consents.revoking") : t("privacy.consents.revoke")}
      </Button>
    );
  }

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("privacy.consents.title")}</h2>
        <p className="text-muted text-sm leading-6">
          {t("privacy.consents.description")}
        </p>
      </div>

      {consents.length === 0 ? (
        <p role="status" className="text-muted text-sm">
          {t("privacy.consents.empty")}
        </p>
      ) : (
        <>
          <ul className="space-y-3 lg:hidden">
            {consents.map((consent) => {
              const status = statusOf(consent, now);

              return (
                <li
                  key={consent.id}
                  data-testid="privacy-consent-row"
                  className="border-border bg-surface-muted/40 rounded-control space-y-3 border p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium break-words">
                        {providerLabels.get(consent.providerId) ??
                          t("privacy.consents.unknownProvider")}
                      </p>
                      <p className="text-muted text-xs break-all">{consent.model}</p>
                    </div>
                    <Badge tone={statusTone[status]}>
                      {t(`privacy.consents.statuses.${status}`)}
                    </Badge>
                  </div>
                  <dl className="grid gap-2 text-xs sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-muted">{t("privacy.consents.origin")}</dt>
                      <dd className="break-all">{consent.endpointOrigin}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("privacy.consents.classes")}</dt>
                      <dd>{consent.dataClasses.join(", ")}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("privacy.consents.created")}</dt>
                      <dd>
                        {formatDateTime(
                          locale,
                          new Date(consent.createdAt).toISOString()
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("privacy.consents.expires")}</dt>
                      <dd>
                        {formatDateTime(
                          locale,
                          new Date(consent.expiresAt).toISOString()
                        )}
                      </dd>
                    </div>
                  </dl>
                  {revokeButton(consent, status)}
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-muted border-border border-b text-xs uppercase">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("privacy.consents.provider")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("privacy.consents.model")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("privacy.consents.origin")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("privacy.consents.classes")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("privacy.consents.created")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("privacy.consents.expires")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("privacy.consents.status")}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">{t("privacy.consents.action")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {consents.map((consent) => {
                  const status = statusOf(consent, now);

                  return (
                    <tr key={consent.id} data-testid="privacy-consent-row">
                      <th scope="row" className="py-2 pr-3 font-medium">
                        {providerLabels.get(consent.providerId) ??
                          t("privacy.consents.unknownProvider")}
                      </th>
                      <td className="text-muted py-2 pr-3">{consent.model}</td>
                      <td className="text-muted py-2 pr-3">{consent.endpointOrigin}</td>
                      <td className="text-muted py-2 pr-3">
                        {consent.dataClasses.join(", ")}
                      </td>
                      <td className="text-muted py-2 pr-3">
                        {formatDateTime(
                          locale,
                          new Date(consent.createdAt).toISOString()
                        )}
                      </td>
                      <td className="text-muted py-2 pr-3">
                        {formatDateTime(
                          locale,
                          new Date(consent.expiresAt).toISOString()
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={statusTone[status]}>
                          {t(`privacy.consents.statuses.${status}`)}
                        </Badge>
                      </td>
                      <td className="py-2 text-right">{revokeButton(consent, status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
