import {
  sqliteTable,
  integer,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
export const metadata = sqliteTable("instance_metadata", {
  singleton: integer("singleton").primaryKey(),
  generation: text("generation").notNull(),
  schemaVersion: integer("schema_version").notNull(),
});
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    secretHash: text("secret_hash").notNull(),
    principal: text("principal").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("session_hash").on(table.secretHash),
    index("sessions_expiry").on(table.expiresAt),
  ],
);
