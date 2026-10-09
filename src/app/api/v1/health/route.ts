import { guard } from "../../../../server/runtime";
import { failure, json } from "../../../../server/next-boundary";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  try {
    guard(request.headers);
    return json({ ready: true, apiVersion: "v1" });
  } catch (error) {
    return failure(error);
  }
}
