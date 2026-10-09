import { headers } from "next/headers";
import Link from "next/link";
import { privateContext } from "../server/next-boundary";
import type { Metadata } from "../db";
import SignOut from "./sign-out";
export const dynamic = "force-dynamic";
export default async function Home() {
  let metadata: Metadata | undefined;
  try {
    const state = privateContext(new Headers(await headers()), "human");
    metadata = state.owned.store.metadata();
  } catch {}
  if (!metadata)
    return (
      <>
        <h1>Pair this browser to continue</h1>
        <p>
          Your workspace requires a paired browser and the local AgentFlow
          launcher.
        </p>
        <Link href="/pair">Open browser pairing</Link>
      </>
    );
  return (
    <>
      <h1>Your local workspace is ready</h1>
      <p>
        This browser is paired. AgentFlow stores your workspace on this machine.
      </p>
      <dl>
        <dt>Storage</dt>
        <dd>SQLite · ready</dd>
        <dt>Schema version</dt>
        <dd>{metadata.schemaVersion}</dd>
        <dt>Generation</dt>
        <dd>{metadata.generation}</dd>
      </dl>
      <SignOut />
    </>
  );
}
