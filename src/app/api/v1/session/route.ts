import { foundationSchemas } from "../../../../contracts/foundation";
import { guard } from "../../../../server/runtime";
import {
  privateContext,
  failure,
  json,
} from "../../../../server/next-boundary";
import {
  cookieSecret,
  createSession,
  equalSecret,
  hashSecret,
  sessionCookie,
} from "../../../../server/auth";
import { HttpError, requireBrowserMutation } from "../../../../server/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let generation: string | undefined;
  try {
    const state = guard(request.headers);
    requireBrowserMutation(request.headers);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "json_invalid");
    }
    const parsed = foundationSchemas.pairInput.safeParse(body);
    if (!parsed.success) throw new HttpError(422, "fields_invalid");
    if (!equalSecret(parsed.data.token, state.owned.credentials.pairingToken))
      throw new HttpError(401, "authentication_required");
    generation = state.owned.store.metadata().generation;
    const session = createSession(state.owned.store);
    return json({ paired: true }, 200, {
      "Set-Cookie": sessionCookie(session.secret),
      "AgentFlow-Generation": state.owned.store.metadata().generation,
    });
  } catch (error) {
    return failure(error, generation);
  }
}
export async function DELETE(request: Request) {
  let generation: string | undefined;
  try {
    const state = privateContext(request.headers, "human", (current) => {
      generation = current;
    });
    requireBrowserMutation(request.headers);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "json_invalid");
    }
    if (!foundationSchemas.revokeInput.safeParse(body).success)
      throw new HttpError(422, "fields_invalid");
    state.owned.store.revoke(
      hashSecret(cookieSecret(request.headers.get("cookie"))!),
    );
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": sessionCookie("", true),
        "AgentFlow-Generation": state.owned.store.metadata().generation,
      },
    });
  } catch (error) {
    return failure(error, generation);
  }
}
