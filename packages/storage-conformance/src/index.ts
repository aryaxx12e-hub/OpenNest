import { describe } from "vitest";

import type { StorageAdapter } from "@opennest/core";

import { registerBlobScenarios } from "./scenarios/blobs";
import { registerErrorScenarios } from "./scenarios/errors";
import { registerFileScenarios } from "./scenarios/files";
import { registerFolderScenarios } from "./scenarios/folders";
import { registerLifecycleScenarios } from "./scenarios/lifecycle";
import { registerNoteScenarios } from "./scenarios/notes";
import { registerPaginationScenarios } from "./scenarios/pagination";
import { registerRestoreScenarios } from "./scenarios/restore";
import { registerSearchScenarios } from "./scenarios/search";
import { registerTagScenarios } from "./scenarios/tags";
import { registerTransactionScenarios } from "./scenarios/transactions";
import { registerWorkspaceScenarios } from "./scenarios/workspaces";

export type StorageFactory = (name?: string) => Promise<StorageAdapter>;

export { openHarness, withHarness, type Harness } from "./harness";

export function runStorageConformance(name: string, create: StorageFactory): void {
  describe(name, () => {
    registerLifecycleScenarios(create);
    registerWorkspaceScenarios(create);
    registerFolderScenarios(create);
    registerFileScenarios(create);
    registerNoteScenarios(create);
    registerTagScenarios(create);
    registerPaginationScenarios(create);
    registerSearchScenarios(create);
    registerBlobScenarios(create);
    registerTransactionScenarios(create);
    registerRestoreScenarios(create);
    registerErrorScenarios(create);
  });
}
