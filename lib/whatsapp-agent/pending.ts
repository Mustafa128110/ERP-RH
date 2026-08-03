// The gap between "5 bags cement to Ahmed" and "yes".
//
// A write is drafted, described, and held here until the same phone number
// confirms it. Keyed by phone because that is the conversation: one person, one
// thread, one thing pending at a time. A second draft replaces the first — a
// shopkeeper who starts describing a different sale has abandoned the previous
// one, and quietly keeping it alive to be confirmed by a later "yes" is how you
// post an invoice nobody meant to post.
//
// ponytail: in-memory Map, so a server restart loses whatever was mid-confirm.
// That costs the user retyping one message, and it fails in the safe direction —
// nothing posts. Move it to the database only if drafts start needing to survive
// a deploy.

export interface Pending<T> {
  value: T;
  expiresAt: number;
}

// Ten minutes. Long enough to be interrupted by a customer at the counter, short
// enough that a "yes" typed after lunch doesn't post this morning's draft.
export const PENDING_TTL_MS = 10 * 60 * 1000;

export class PendingStore<T> {
  private readonly items = new Map<string, Pending<T>>();

  constructor(private readonly ttlMs: number = PENDING_TTL_MS) {}

  set(key: string, value: T, now = Date.now()): void {
    this.items.set(key, { value, expiresAt: now + this.ttlMs });
  }

  // Reading a pending write consumes it: "yes" must post exactly once, and a
  // duplicate delivery of the same message — which WhatsApp does do — must not
  // post it again.
  take(key: string, now = Date.now()): T | null {
    const found = this.items.get(key);
    if (!found) return null;
    this.items.delete(key);
    return found.expiresAt > now ? found.value : null;
  }

  has(key: string, now = Date.now()): boolean {
    const found = this.items.get(key);
    if (!found) return false;
    if (found.expiresAt <= now) {
      this.items.delete(key);
      return false;
    }
    return true;
  }

  clear(key: string): void {
    this.items.delete(key);
  }

  // Called opportunistically on each inbound message. Without it an abandoned
  // draft holds its closure — and everything the closure captured — until the
  // process restarts.
  sweep(now = Date.now()): void {
    for (const [key, item] of this.items) {
      if (item.expiresAt <= now) this.items.delete(key);
    }
  }

  get size(): number {
    return this.items.size;
  }
}
