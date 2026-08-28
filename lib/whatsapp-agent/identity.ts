import "server-only";
import { sessionByWhatsAppNumber, type SessionRow } from "@/lib/db/session-query";
import type { AuthSession } from "@/lib/auth/session";
import { normalizeWhatsAppNumber } from "./phone";
import { agentSession, runAsWhatsAppUser } from "./context";

function shapeAgentSession(row: SessionRow): AuthSession {
  const globalPermissions = new Set<string>();
  const permissionsByCompany = new Map<string, Set<string>>();
  for (const { companyId, key } of row.perms) {
    if (companyId === null) {
      globalPermissions.add(key);
    } else {
      const permissions = permissionsByCompany.get(companyId) ?? new Set<string>();
      permissions.add(key);
      permissionsByCompany.set(companyId, permissions);
    }
  }
  return {
    userId: row.id,
    supabaseAuthId: row.supabase_auth_id,
    name: row.name,
    email: row.email,
    roleNames: row.role_names,
    globalPermissions,
    permissionsByCompany,
    companyIds: row.company_ids,
    warehouseIds: row.warehouse_ids,
    uiTheme: row.ui_theme,
    uiScale: row.ui_scale,
  };
}

// Unknown, inactive and locked users deliberately produce no reply.  This is a
// business number; an authorization error would disclose that an ERP agent is
// present to every customer who messages it.
export async function sessionForWhatsAppNumber(rawPhone: string): Promise<AuthSession | null> {
  const phone = normalizeWhatsAppNumber(rawPhone);
  if (!phone) return null;
  const [row] = await sessionByWhatsAppNumber(phone);
  return row?.status === "active" ? shapeAgentSession(row) : null;
}

export { agentSession, runAsWhatsAppUser };
