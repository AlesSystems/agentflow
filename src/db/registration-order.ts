import type Database from "better-sqlite3";
// The insert trigger advances high-water atomically. Call only within an immediate write transaction.
export function nextRegistrationOrder(db: Database.Database): number {
  if (!db.inTransaction)
    throw new Error("REGISTRATION_ORDER_TRANSACTION_REQUIRED");
  const row = db
    .prepare(
      "SELECT last_value AS lastValue FROM run_order_allocator WHERE singleton=1",
    )
    .get() as { lastValue: number } | undefined;
  if (!row || row.lastValue >= Number.MAX_SAFE_INTEGER)
    throw new Error("REGISTRATION_ORDER_EXHAUSTED");
  return row.lastValue + 1;
}
