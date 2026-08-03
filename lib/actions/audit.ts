import "server-only";
import { and, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInScope } from "@/lib/auth/scope";

// Not "use server": nothing here is called from the browser. The writer runs
// inside the actions that mutate, the reader from the audit-logs page.

export type AuditEntry = {
  action: "create" | "update" | "delete" | "merge" | "import";
  // What kind of record changed, lowercase and singular: "sale", "product".
  entity: string;
  entityId?: string | null;
  // How the record names itself to a human. A deleted invoice can't be joined
  // back to, so this is copied rather than looked up later.
  summary: string;
  detail?: string | null;
  companyId?: string | null;
};

// Records one change. Never throws: an audit row that fails to write must not
// roll back the sale it was describing, so the failure goes to the server log
// and the operation carries on. That is a deliberate trade — the alternative is
// an outage in the shop every time this table has a bad day.
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const session = await getSession();
    if (!session) return;
    await db.insert(auditLogs).values({
      companyId: entry.companyId ?? null,
      userId: session.userId,
      // Copied, not joined: the log outlives the account.
      userName: session.name,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary.slice(0, 200),
      detail: entry.detail ?? null,
    });
  } catch (e) {
    console.error("[audit] failed to record", entry, e);
  }
}

export type AuditRow = {
  id: string;
  createdAt: Date;
  userName: string;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  detail: string | null;
};

export type AuditFilters = {
  entity?: string;
  action?: string;
  user?: string;
  from?: string;
  to?: string;
};

// Newest first, capped. An audit log is read as "what happened lately" or
// "what happened to this record", never as a full table scan — and an unbounded
// SELECT over a table that only ever grows is a page that gets slower every
// week until it stops loading at all.
const PAGE = 200;

export async function listAuditLogs(filters: AuditFilters = {}): Promise<AuditRow[]> {
  const session = await getSession();
  requirePermission(session, "audit", "view");

  const where: (SQL | undefined)[] = [await companyInScope(auditLogs.companyId)];
  if (filters.entity) where.push(eq(auditLogs.entity, filters.entity));
  if (filters.action) where.push(eq(auditLogs.action, filters.action as AuditEntry["action"]));
  if (filters.user) where.push(ilike(auditLogs.userName, `%${filters.user}%`));
  if (filters.from) where.push(gte(auditLogs.createdAt, new Date(`${filters.from}T00:00:00`)));
  // End of the chosen day, not the start of it — a "to" of the 25th has to
  // include the 25th.
  if (filters.to) where.push(lte(auditLogs.createdAt, new Date(`${filters.to}T23:59:59.999`)));

  return db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      userName: auditLogs.userName,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      summary: auditLogs.summary,
      detail: auditLogs.detail,
    })
    .from(auditLogs)
    .where(and(...where))
    .orderBy(desc(auditLogs.createdAt))
    .limit(PAGE);
}

// The distinct entity kinds and users actually present, for the filter
// dropdowns — offering "quotation" when nothing has ever touched one is a filter
// that can only return nothing.
export async function getAuditFacets(): Promise<{ entities: string[]; users: string[] }> {
  const session = await getSession();
  requirePermission(session, "audit", "view");

  const scope = await companyInScope(auditLogs.companyId);
  const [entities, names] = await Promise.all([
    db.selectDistinct({ entity: auditLogs.entity }).from(auditLogs).where(scope).orderBy(auditLogs.entity),
    db.selectDistinct({ userName: auditLogs.userName }).from(auditLogs).where(scope).orderBy(auditLogs.userName),
  ]);
  return { entities: entities.map((e) => e.entity), users: names.map((n) => n.userName) };
}

// Everything that ever touched one record, oldest first — the history panel on a
// document. `or` on entityId and summary so an invoice found by number still
// shows the entries written before it had an id.
export async function historyFor(entity: string, entityId: string, summary?: string): Promise<AuditRow[]> {
  const session = await getSession();
  requirePermission(session, "audit", "view");

  return db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      userName: auditLogs.userName,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      summary: auditLogs.summary,
      detail: auditLogs.detail,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(and(eq(auditLogs.entity, entity), summary ? or(eq(auditLogs.entityId, entityId), eq(auditLogs.summary, summary)) : eq(auditLogs.entityId, entityId)))
    .orderBy(auditLogs.createdAt);
}
