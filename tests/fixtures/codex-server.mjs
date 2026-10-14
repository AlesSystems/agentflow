import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (!Object.hasOwn(message, "id")) return;
  if (message.params?.threadId === "timeout") return;
  if (message.params?.threadId === "large") return process.stdout.write("x".repeat(2048));
  const response = message.params?.threadId === "error"
    ? { id: message.id, error: { message: "SECRET private source error" } }
    : { id: message.id, result: message.method === "initialize" ? {} : { data: [], nextCursor: null } };
  process.stdout.write(JSON.stringify(response) + "\n");
});
