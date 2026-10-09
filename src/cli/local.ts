import { openOwnedStore } from "../db";
import { restore, repairRestore } from "../db/recovery";
import { readConfig } from "../server/config";
import { rotateCredentials } from "../server/auth";
async function main() {
  const config = readConfig();
  const args = process.argv.slice(2);
  if (args[0] === "restore") {
    if (args[1] === "repair") {
      await repairRestore(config.dataDir);
      console.log("Restore repaired.");
      return;
    }
    if (args[1] !== "--from" || !args[2] || args.length !== 3)
      throw new Error("USAGE: local restore --from <absolute-backup-path>");
    await restore(config.dataDir, args[2]);
    console.log("Restore complete. Browser sessions were revoked.");
    return;
  }
  const owned = await openOwnedStore(config.dataDir);
  try {
    if (args.length === 1 && args[0] === "setup") {
      if (!process.stdout.isTTY)
        throw new Error(
          "INTERACTIVE_TERMINAL_REQUIRED: Run setup in your local terminal.",
        );
      console.log("Pairing token: " + owned.credentials.pairingToken);
      console.log("Reporter token: " + owned.credentials.reporterToken);
      return;
    }
    if (args.join(" ") === "credentials rotate") {
      rotateCredentials(owned.store.dataDir, owned.store);
      console.log("Credentials rotated. Run local setup to view them.");
      return;
    }
    if (
      args[0] === "backup" &&
      args[1] === "--output" &&
      args[2] &&
      args.length === 3
    ) {
      await owned.store.backup(args[2]);
      console.log("Backup verified. Integrity ok.");
      return;
    }
    throw new Error(
      "USAGE: local setup | credentials rotate | backup --output <absolute-path> | restore --from <absolute-path> | restore repair",
    );
  } finally {
    owned.close();
  }
}
main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
