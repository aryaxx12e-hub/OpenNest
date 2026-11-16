"use client";

import { useState } from "react";

import { useTranslations } from "@opennest/localization";
import { Badge, Card } from "@opennest/ui";

import {
  effectiveGrantStatus,
  type CapabilityGrant,
  type ResourceScope,
} from "@opennest/privacy";

export function PrivacyGrants({ grants }: { grants: readonly CapabilityGrant[] }) {
  const t = useTranslations();
  const [now] = useState(() => Date.now());

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("privacy.grants.title")}</h2>
        <p className="text-muted text-sm leading-6">{t("privacy.grants.description")}</p>
      </div>

      {grants.length === 0 ? (
        <p className="text-muted text-sm">{t("privacy.grants.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-muted border-border border-b text-xs uppercase">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.grants.capability")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.grants.scope")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.grants.status")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("privacy.grants.source")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {grants.map((grant) => {
                const status = effectiveGrantStatus(grant, now);

                return (
                  <tr key={grant.id}>
                    <th scope="row" className="py-2 pr-3 font-mono text-xs font-medium">
                      {grant.capability}
                    </th>
                    <td className="text-muted py-2 pr-3">{scopeLabel(grant.scope)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={status === "active" ? "success" : "warning"}>
                        {t(`privacy.grants.statuses.${status}`)}
                      </Badge>
                    </td>
                    <td className="py-2">
                      {grant.builtIn
                        ? t("privacy.grants.builtIn")
                        : t("privacy.grants.external")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-muted text-xs leading-5">{t("privacy.grants.nonRevocable")}</p>
    </Card>
  );
}

function scopeLabel(scope: ResourceScope): string {
  switch (scope.kind) {
    case "workspace":
      return scope.workspaceId;
    case "folder":
      return scope.folderId;
    case "notes":
      return scope.noteIds.join(", ");
    case "files":
      return scope.fileIds.join(", ");
    case "origin":
      return scope.origin;
    case "provider":
      return scope.providerId;
  }
}
