import { headers } from "next/headers";
import { guard } from "../../server/runtime";
import PairForm from "./form";
export const dynamic = "force-dynamic";
export default async function PairPage() {
  try {
    guard(new Headers(await headers()));
  } catch {
    return (
      <>
        <h1>AgentFlow is unavailable</h1>
        <p>Start the local service with npm start, then reload this page.</p>
      </>
    );
  }
  return (
    <>
      <h1>Pair your browser</h1>
      <p>Connect this browser to your local AgentFlow workspace.</p>
      <PairForm />
    </>
  );
}
