import { openOwnedStore } from "../../src/db";
import { restore } from "../../src/db/recovery";
import { rotateCredentials } from "../../src/server/auth";
const [operation, dir, phase, source] = process.argv.slice(2);
function pause(at: string) {
  if (at === phase) {
    process.stdout.write("phase " + at + "\n");
    process.kill(process.pid, "SIGSTOP");
  }
}
if (operation === "rotate") {
  const owned = await openOwnedStore(dir);
  try {
    rotateCredentials(dir, owned.store, pause);
  } finally {
    owned.close();
  }
} else if (operation === "restore") await restore(dir, source, pause);
else throw new Error("Unknown fixture operation");
