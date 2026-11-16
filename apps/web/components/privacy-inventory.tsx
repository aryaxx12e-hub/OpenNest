"use client";

import { useTranslations } from "@opennest/localization";
import { Badge, Card } from "@opennest/ui";

import type { DataInventoryEntry, FlowMatrixEntry } from "@opennest/privacy";

export function PrivacyInventory({
  inventory,
  flows,
}: {
  inventory: readonly DataInventoryEntry[];
  flows: readonly FlowMatrixEntry[];
}) {
  const t = useTranslations();

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("privacy.inventory.title")}</h2>
          <p className="text-muted text-sm leading-6">
            {t("privacy.inventory.description")}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-muted border-border border-b text-xs uppercase">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.inventory.columns.data")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.inventory.columns.class")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.inventory.columns.storage")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.inventory.columns.backup")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("privacy.inventory.columns.retention")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {inventory.map((entry) => (
                <tr key={entry.id}>
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {t(entry.labelKey)}
                  </th>
                  <td className="py-2 pr-3">
                    <Badge tone="neutral">{entry.dataClass}</Badge>
                  </td>
                  <td className="text-muted py-2 pr-3">
                    {t(`privacy.inventory.storage.${entry.storage}`)}
                  </td>
                  <td className="py-2 pr-3">
                    {entry.includedInBackup
                      ? t("privacy.inventory.included")
                      : t("privacy.inventory.excluded")}
                  </td>
                  <td className="text-muted py-2">
                    {t(`privacy.inventory.retention.${entry.retention}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("privacy.flows.title")}</h2>
          <p className="text-muted text-sm leading-6">{t("privacy.flows.description")}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-muted border-border border-b text-xs uppercase">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.flows.columns.flow")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.flows.columns.from")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.flows.columns.to")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("privacy.flows.columns.classes")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("privacy.flows.columns.status")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {flows.map((flow) => (
                <tr key={flow.id}>
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {t(flow.labelKey)}
                  </th>
                  <td className="text-muted py-2 pr-3">
                    {t(`privacy.flows.zones.${flow.source}`)}
                  </td>
                  <td className="text-muted py-2 pr-3">
                    {t(`privacy.flows.zones.${flow.destination}`)}
                  </td>
                  <td className="text-muted py-2 pr-3">{flow.dataClasses.join(", ")}</td>
                  <td className="py-2">
                    {flow.available
                      ? t("privacy.flows.available")
                      : t("privacy.flows.unavailable")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-muted text-xs leading-5">
          {t("privacy.flows.revocationLimit")}
        </p>
      </Card>
    </div>
  );
}
