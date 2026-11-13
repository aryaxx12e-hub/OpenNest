import { NotFoundError } from "../errors";
import type { Workspace } from "../domain";
import type { WorkspaceId } from "../ids";
import type { WorkspaceRepository } from "../ports";

export async function requireWorkspace(
  workspaces: WorkspaceRepository,
  id: WorkspaceId
): Promise<Workspace> {
  const workspace = await workspaces.get(id);

  if (workspace === null) {
    throw new NotFoundError("Workspace does not exist.");
  }

  return workspace;
}
