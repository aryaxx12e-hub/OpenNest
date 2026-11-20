import type { AuthDatabase } from "../auth/auth-db";
import { countOwners } from "../auth/membership";
import { HttpError } from "../errors";
import { sendJson, type Router } from "../http/router";

export interface BootstrapRouteDependencies {
  auth: AuthDatabase;
}

export function registerBootstrapRoutes(
  router: Router,
  dependencies: BootstrapRouteDependencies
): void {
  router.get("/auth/bootstrap", (_request, response) => {
    if (countOwners(dependencies.auth) > 0) {
      throw new HttpError(404, "not_found", "The requested path was not found.");
    }

    sendJson(response, 200, { status: "required" });
  });
}
