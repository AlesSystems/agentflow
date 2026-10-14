#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
const chat = (id, updatedAt) => ({ id, name: id, cwd: "/fixture", updatedAt, source: "cli", status: { type: "notLoaded" } });
const child = { ...chat("child", 30), source: { subAgent: { thread_spawn: { parent_thread_id: "chat-a", agent_role: "worker" } } } };
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  if (method !== "initialize" && process.argv[2] && existsSync(process.argv[2])) return process.stdout.write(JSON.stringify({ id, error: { message: "PRIVATE source failure" } }) + "\n");
  let result;
  if (method === "initialize") result = {};
  else if (method === "thread/list") {
    if (!params.useStateDbOnly || !params.sourceKinds.includes("subAgent")) throw new Error("unsafe listing");
    const archived = process.argv.includes("--overflow") ? [child, chat("archived-a", 40), chat("archived-b", 50)] : [child];
    result = params.archived ? { data: archived, nextCursor: null } : params.cursor ? { data: [chat("chat-b", 20)], nextCursor: null } : { data: [chat("chat-a", 10)], nextCursor: "page2" };
  } else if (method === "thread/read") result = { thread: chat(params.threadId, 10) };
  else if (method === "thread/turns/list") result = { data: [{ id: "turn", status: "inProgress", items: [] }], nextCursor: null };
  else if (method === "thread/items/list") result = { data: [
    { turnId: "turn", item: { type: "agentMessage", text: "Working" } },
    { turnId: "turn", item: { type: "userMessage", content: [{ type: "text", text: "Build a connector" }] } },
  ], nextCursor: null };
  else throw new Error("mutation method forbidden");
  process.stdout.write(JSON.stringify({ id, result }) + "\n");
});
