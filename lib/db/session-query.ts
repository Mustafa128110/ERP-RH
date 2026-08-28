import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./index";
import { withConnectRetry } from "./retry";

export type SessionRow = {
  id: string;
  supabase_auth_id: string;
  name: string;
  email: string;
  status: string;
  role_names: string[];
  perms: { companyId: string | null; key: string }[];
  company_ids: string[];
  warehouse_ids: string[];
  // Display preferences. They live on this row, and this row is already being
  // fetched before every render, so carrying them costs nothing — which is what
  // lets the theme be applied server-side with no flash of the wrong one.
  ui_theme: "light" | "dark";
  ui_scale: number;
};

// The database is ~170ms away (Supabase ap-southeast-2). This used to be a
// profile lookup followed by four more queries, so every request paid two
// sequential waves of that latency before a page could start rendering.
// Independent sub-selects collapse it to a single round trip and, unlike
// joining the four together, produce no row multiplication to undo in JS.
//
// Lives here rather than in lib/auth/session.ts so it stays importable outside
// a request — lib/auth/session.check.ts asserts it against the five queries it
// replaced, and session.ts pulls in next/navigation, which a plain script can't.
// Wrapped in the connect retry because this is the first query of every single
// request: a one-second DNS wobble otherwise 500s whatever the user was doing,
// including the render that follows a save. It's a read, so retrying it can't
// write anything twice.
export function sessionQuery(authId: string) {
  return sessionRows(sql`u.supabase_auth_id = ${authId}`);
}

// The WhatsApp agent authenticates a message by matching the sender number to
// this deliberately identical session projection.  It is an authentication
// bridge only: roles, company access and warehouse access remain the normal ERP
// authorization model.
export function sessionByWhatsAppNumber(phone: string) {
  return sessionRows(sql`u.whatsapp_number = ${phone}`);
}

function sessionRows(match: ReturnType<typeof sql>) {
  return withConnectRetry(() =>
    db.execute<SessionRow>(sql`
    SELECT
      u.id,
      u.supabase_auth_id,
      u.name,
      u.email,
      u.status,
      u.ui_theme,
      u.ui_scale,
      coalesce((
        SELECT json_agg(DISTINCT r.name)
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id
      ), '[]'::json) AS role_names,
      coalesce((
        SELECT json_agg(json_build_object(
          'companyId', ur.company_id,
          'key', p.module || '.' || p.action
        ))
        FROM user_roles ur
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = u.id
      ), '[]'::json) AS perms,
      coalesce((
        SELECT json_agg(uca.company_id)
        FROM user_company_access uca
        WHERE uca.user_id = u.id
      ), '[]'::json) AS company_ids,
      coalesce((
        SELECT json_agg(uwa.location_id)
        FROM user_warehouse_access uwa
        WHERE uwa.user_id = u.id
      ), '[]'::json) AS warehouse_ids
    FROM users u
    WHERE ${match}
    LIMIT 1
  `),
  );
}
