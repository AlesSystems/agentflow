import {
  privateContext,
  failure,
  json,
} from "../../../../server/next-boundary";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  try {
    const state = privateContext(request.headers);
    const metadata = state.owned.store.metadata();
    return json({ ready: true, ...metadata }, 200, {
      "AgentFlow-Generation": metadata.generation,
    });
  } catch (error) {
    return failure(error);
  }
}
