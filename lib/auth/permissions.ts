import "server-only";
import type { AuthSession } from "./session";

export class PermissionError extends Error {
  constructor(message = "Permission denied") {
    super(message);
    this.name = "PermissionError";
  }
}

interface Scope {
  companyId?: string;
  warehouseId?: string;
}

// A user can hold different roles per company (e.g. Admin in Royal Hardware,
// Salesman in M52) — globalPermissions (role assigned with no company) always
// apply; permissionsByCompany only applies when scope.companyId matches.
// With no companyId given, this checks "does the user have this permission in
// ANY company they can access" — useful for module-level UI gating before a
// specific company is selected.
function hasPermission(session: AuthSession, key: string, companyId?: string): boolean {
  if (session.globalPermissions.has(key)) return true;
  if (companyId) return session.permissionsByCompany.get(companyId)?.has(key) ?? false;
  for (const set of session.permissionsByCompany.values()) {
    if (set.has(key)) return true;
  }
  return false;
}

// Used by every Server Action per phase-7-api-design.md §0.2 step 2 — thrown
// errors are caught once, centrally, and converted to PERMISSION_DENIED
// (§0.1), so individual actions never write their own auth-check logic.
export function requirePermission(
  session: AuthSession | null,
  moduleName: string,
  action: string,
  scope?: Scope,
): asserts session is AuthSession {
  if (!session) throw new PermissionError("Not authenticated");
  if (!hasPermission(session, `${moduleName}.${action}`, scope?.companyId)) {
    throw new PermissionError(`Missing permission ${moduleName}.${action}`);
  }
  if (scope?.companyId && !session.companyIds.includes(scope.companyId)) {
    throw new PermissionError(`No access to company ${scope.companyId}`);
  }
  // Empty warehouseIds means unrestricted — the user wasn't assigned to
  // specific warehouses, so they can access all of them.
  if (scope?.warehouseId && session.warehouseIds.length > 0 && !session.warehouseIds.includes(scope.warehouseId)) {
    throw new PermissionError(`No access to warehouse ${scope.warehouseId}`);
  }
}

// Account administration is system-wide: a company-scoped users.* grant must
// never be enough to create, deactivate, delete, or globally promote a person.
// Keep this separate from requirePermission()'s intentionally permissive
// no-scope UI check so callers have to opt into global authority explicitly.
export function requireGlobalPermission(
  session: AuthSession | null,
  moduleName: string,
  action: string,
): asserts session is AuthSession {
  if (!session) throw new PermissionError("Not authenticated");
  const key = `${moduleName}.${action}`;
  if (!session.globalPermissions.has(key)) {
    throw new PermissionError(`Missing global permission ${key}`);
  }
}
