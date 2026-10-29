import type { Db } from '../db.js';

export async function audit(
  db: Db,
  entity: string,
  entityId: string,
  action: string,
  actorId: string | null,
  changes?: Record<string, unknown>,
): Promise<void> {
  await db.query(
    'insert into audit_log(entity, entity_id, action, actor_id, changes) values ($1, $2, $3, $4, $5)',
    [entity, entityId, action, actorId, changes ? JSON.stringify(changes) : null],
  );
}

/** Fields whose value differs between before and after, as { field: [old, new] }. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = [a ?? null, b ?? null];
  }
  return out;
}
