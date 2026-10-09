import Database from "better-sqlite3";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrations, openOwnedStore } from "../../src/db";
const directory = () => mkdtempSync(join(realpathSync(tmpdir()), "agentflow-order-"));
function connection(dir: string, operation: (db: Database.Database) => void) {
  const db = new Database(join(dir, "agentflow.sqlite")); db.pragma("foreign_keys=ON");
  try { operation(db); } finally { db.close(); }
}
function legacy(db: Database.Database) {
  db.exec(`INSERT INTO projects VALUES('10000000-0000-4000-8000-000000000001','Synthetic legacy',NULL,NULL,1,0,0);
    INSERT INTO agents VALUES('10000000-0000-4000-8000-000000000002','Synthetic legacy','fixture','implementation',1,0);
    INSERT INTO tasks VALUES('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',NULL,'Synthetic task','','','review','normal','[]',NULL,NULL,NULL,NULL,NULL,1,1,0,0,NULL);`);
  const insert = db.prepare("INSERT INTO runs(rowid,id,project_id,agent_id,task_id,purpose,work_revision,state,last_sequence,last_received_at,version,created_at) VALUES(?,?, '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',? ,?, ?,?,0,0,1,0)");
  insert.run(-10, 'ffffffff-ffff-4fff-8fff-ffffffffffff','10000000-0000-4000-8000-000000000003','implementation',1,'succeeded');
  insert.run(20, '00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','implementation',1,'failed');
  insert.run(80, '10000000-0000-4000-8000-000000000004',null,'planning',null,'queued');
}
it("upgrades 0001 preserving dense legacy rowid order and all run facts", async () => {
  const dir = directory(); const old = await openOwnedStore(dir, migrations.slice(0,2)); old.close();
  connection(dir, legacy);
  const upgraded = await openOwnedStore(dir);
  try {
    connection(dir, db => {
      expect(db.prepare("SELECT id,registration_order FROM runs ORDER BY registration_order").all()).toEqual([{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',registration_order:1},{id:'00000000-0000-4000-8000-000000000001',registration_order:2},{id:'10000000-0000-4000-8000-000000000004',registration_order:3}]);
      expect(db.prepare("SELECT last_value FROM run_order_allocator").get()).toEqual({last_value:3});
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%registration_identity%' OR name LIKE '%event%'").all()).toEqual([]);
    });
    expect(upgraded.store.snapshot({kind:'task',id:'10000000-0000-4000-8000-000000000003',input:{history:'both',historyLimit:50}}).body.data).toMatchObject({latestRun:{id:'00000000-0000-4000-8000-000000000001'}});
    expect(upgraded.store.integrity().integrity).toBe('ok');
  } finally { upgraded.close(); }
});
