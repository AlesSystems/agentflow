import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launch, pair } from "../fixtures/server";
it("persists paired sessions across restart and fails closed under plain next start", async () => {
  const first = await launch();
  const cookie = await pair(first);
  const generation = (
    await (
      await fetch(first.url + "/api/v1/foundation", {
        headers: { Cookie: cookie },
      })
    ).json()
  ).generation;
  await first.stop();
  const second = await launch({ dir: first.dir });
  try {
    expect(
      (
        await (
          await fetch(second.url + "/api/v1/foundation", {
            headers: { Cookie: cookie },
          })
        ).json()
      ).generation,
    ).toBe(generation);
  } finally {
    await second.stop();
  }
  const plain = await launch({ dir: first.dir, plain: true });
  try {
    expect((await fetch(plain.url + "/api/v1/health")).status).toBe(503);
    expect(
      (
        await fetch(plain.url + "/api/v1/foundation", {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await fetch(plain.url + "/api/v1/session", {
          method: "POST",
          headers: { Origin: plain.url, "Content-Type": "application/json" },
          body: JSON.stringify({ token: first.credentials().pairingToken }),
        })
      ).status,
    ).toBe(503);
    expect(await (await fetch(plain.url)).text()).not.toContain(generation);
  } finally {
    await plain.stop();
  }
});
it("plain framework startup never initializes a fresh data directory", async () => {
  const plain = await launch({ plain: true });
  try {
    expect((await fetch(plain.url + "/api/v1/foundation")).status).toBe(503);
    expect(existsSync(join(plain.dir, "credentials.json"))).toBe(false);
    expect(existsSync(join(plain.dir, "agentflow.sqlite"))).toBe(false);
  } finally {
    await plain.stop();
  }
});
it("never exposes synthetic secrets in responses or process logs", async () => {
  const server = await launch();
  try {
    const cookie = await pair(server);
    for (const route of [
      "/",
      "/pair",
      "/api/v1/health",
      "/api/v1/foundation",
    ]) {
      const body = await (
        await fetch(server.url + route, { headers: { Cookie: cookie } })
      ).text();
      for (const token of Object.values(server.credentials()).filter(
        (value) => typeof value === "string",
      ))
        expect(body).not.toContain(token);
      expect(body).not.toContain(server.dir);
    }
    const credentials = JSON.parse(
      readFileSync(join(server.dir, "credentials.json"), "utf8"),
    );
    expect(server.logs()).not.toContain(credentials.pairingToken);
    expect(server.logs()).not.toContain(credentials.reporterToken);
  } finally {
    await server.stop();
  }
});
