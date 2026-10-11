import { spawn } from "node:child_process";
if (process.argv.includes("--tail")) {
  setTimeout(() => {
    process.stdout.write("trailing stdout Ω\n");
    process.stderr.write("trailing stderr ě\n");
  }, 150);
} else {
  const child = spawn(process.execPath, [import.meta.filename, "--tail"], {
    stdio: ["ignore", process.stdout, process.stderr],
  });
  child.unref();
  process.stdout.write("initial stdout\n");
  process.stderr.write("initial stderr\n");
}
