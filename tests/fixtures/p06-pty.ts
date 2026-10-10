import { spawn } from "node:child_process";
const driver = `import os, pty, subprocess, sys, json, select, time
master, slave = pty.openpty()
tty = os.isatty(slave)
child = subprocess.Popen(json.loads(sys.argv[1]), stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
output = b''
started = time.monotonic()
try:
 while True:
  if time.monotonic() - started > 15:
   child.kill()
   raise RuntimeError('PTY deadline')
  readable, _, _ = select.select([master], [], [], .1)
  if readable:
   try: data = os.read(master, 65536)
   except OSError: break
   if not data: break
   output += data
  elif child.poll() is not None: break
 code = child.wait()
 print(json.dumps({'code': code, 'output': output.decode(), 'tty': tty}))
finally:
 os.close(master)
 if child.poll() is None: child.kill()
 child.wait()
`;
export async function ptyCli(args: string[], env: Record<string, string | undefined>) {
  const child = spawn("python3", ["-c", driver, JSON.stringify([process.execPath, "--import", "tsx", "src/cli/main.ts", ...args])], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => stdout += chunk);
  child.stderr.on("data", chunk => stderr += chunk);
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  if (code !== 0) throw new Error(`PTY driver failed: ${stderr}`);
  return JSON.parse(stdout) as { code: number; output: string; tty: boolean };
}
