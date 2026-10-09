import { foundationSchemas } from "./foundation";
import { z } from "zod";
import { endpoints } from "./routes";
import { uuid, version, changeCursor } from "./common";
import {
  requestExamples,
  responseExamples,
  detailContinuationExample,
} from "./examples";
import { taskDetailV1, taskDetailQueryV1 } from "./tasks";
import { envelope } from "./common";
export const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    details: z
      .strictObject({
        currentVersion: version.optional(),
        expectedSequence: version.optional(),
      })
      .optional(),
  }),
});
const errorExample = {
  error: {
    code: "version_conflict",
    message:
      "The request could not be completed. Check the local service and request.",
    details: { currentVersion: 2 },
  },
};
function schema(value: z.ZodType, io: "input" | "output" = "output") {
  const { $schema, ...result } = z.toJSONSchema(value, {
    io,
    unrepresentable: "any",
  });
  void $schema;
  return result;
}
const security = [{ browserSession: [] }, { reporterBearer: [] }];
function responses(
  status: number,
  response: z.ZodType,
  example: unknown,
  authenticated = true,
) {
  const headers = authenticated
    ? {
        "AgentFlow-Generation": {
          description: "Current database generation, including exact retries.",
          schema: { type: "string", format: "uuid" },
        },
      }
    : {};
  return {
    [status]: {
      description: "Committed result",
      headers,
      content: { "application/json": { schema: schema(response), example } },
    },
    ...Object.fromEntries(
      [400, 401, 403, 404, 408, 409, 413, 415, 422, 429, 503].map((code) => [
        code,
        {
          $ref:
            "#/components/responses/" +
            ([429, 503].includes(code) ? "RetryableError" : "RequestError"),
        },
      ]),
    ),
  };
}
export function openapiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of endpoints) {
    if (endpoint.kind === "stream") {
      const properties = (schema(endpoint.input, "input") as {
        properties: Record<string, unknown>;
      }).properties;
      const parameters = [
        ...Object.entries(properties).map(([name, value]) => ({
          in: "query", name, required: true, schema: value,
        })),
        { in: "header", name: "Last-Event-ID", schema: schema(changeCursor) },
      ];
      const streamResponses = responses(200, endpoint.response, undefined);
      const headers = { "AgentFlow-Generation": { schema: schema(uuid) } };
      paths["/api/v1" + endpoint.path] = {
        get: {
          operationId: endpoint.id,
          description: endpoint.description,
          security: [{ browserSession: [] }],
          parameters,
          responses: {
            ...streamResponses,
            200: {
              description: "Invalidation frames or finite reset then close",
              headers,
              content: {
                "text/event-stream": {
                  schema: { type: "string" },
                  example: 'id: 1\nevent: change\ndata: {"entityType":"task","entityId":"example","kind":"updated"}\n\n',
                },
              },
            },
          },
        },
        head: {
          operationId: endpoint.id + "Head",
          security: [{ browserSession: [] }],
          parameters,
          responses: {
            ...streamResponses,
            200: { description: "Finite bodyless stream status", headers },
          },
        },
      };
      continue;
    }
    endpoint.input.parse(requestExamples[endpoint.id]);
    endpoint.response.parse(responseExamples[endpoint.id]);
    const path = "/api/v1" + endpoint.path;
    const input = schema(endpoint.input, "input") as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const parameters: unknown[] = [];
    if (endpoint.path.includes("{id}"))
      parameters.push({
        in: "path",
        name: "id",
        required: true,
        schema: schema(uuid),
      });
    if (endpoint.kind === "command" && !endpoint.eventIdentity)
      parameters.push({
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: schema(uuid),
      });
    else
      for (const [name, value] of Object.entries(input.properties ?? {}))
        parameters.push({
          in: "query",
          name,
          required: input.required?.includes(name) ?? false,
          schema: value,
        });
    const operation = {
      operationId: endpoint.id,
      ...(endpoint.description ? { description: endpoint.description } : {}),
      security:
        endpoint.access === "human" ? [{ browserSession: [] }] : security,
      parameters,
      ...(endpoint.kind === "command"
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: input,
                  example: requestExamples[endpoint.id],
                },
              },
            },
          }
        : {}),
      responses: {
        ...responses(
          endpoint.status,
          endpoint.response,
          responseExamples[endpoint.id],
        ),
        ...(["registerRun", "ingestEvent"].includes(endpoint.id)
          ? {
              200: {
                description:
                  "Exact identity replay; historical body and current generation header.",
                headers: { "AgentFlow-Generation": { schema: schema(uuid) } },
                content: {
                  "application/json": {
                    schema: schema(endpoint.response),
                    example: responseExamples[endpoint.id],
                  },
                },
              },
            }
          : {}),
      },
    };
    paths[path] ??= {};
    paths[path][endpoint.method.toLowerCase()] = operation;
    if (endpoint.method === "GET")
      paths[path].head = {
        ...operation,
        operationId: endpoint.id + "Head",
        responses: {
          200: {
            description: "Bodyless snapshot status",
            headers: { "AgentFlow-Generation": { schema: schema(uuid) } },
          },
        },
      };
  }
  foundationSchemas.health.parse({ ready: true, apiVersion: "v1" });
  foundationSchemas.foundation.parse({
    ready: true,
    generation: "10000000-0000-4000-8000-000000000004",
    schemaVersion: 2,
  });
  foundationSchemas.pairInput.parse({ token: "synthetic-pairing-example" });
  foundationSchemas.paired.parse({ paired: true });
  errorSchema.parse(errorExample);
  envelope(taskDetailV1).parse(detailContinuationExample);
  taskDetailQueryV1.parse({ history: "completion", historyLimit: 50 });
  paths["/api/v1/health"] = {
    get: {
      operationId: "health",
      security: [],
      responses: responses(
        200,
        foundationSchemas.health,
        { ready: true, apiVersion: "v1" },
        false,
      ),
    },
  };
  paths["/api/v1/foundation"] = {
    get: {
      operationId: "foundation",
      security,
      responses: responses(200, foundationSchemas.foundation, {
        ready: true,
        generation: "10000000-0000-4000-8000-000000000004",
        schemaVersion: 2,
      }),
    },
  };
  paths["/api/v1/health"].head = {
    operationId: "healthHead",
    security: [],
    responses: {
      200: { description: "Bodyless readiness status" },
      503: { $ref: "#/components/responses/RetryableError" },
    },
  };
  paths["/api/v1/foundation"].head = {
    operationId: "foundationHead",
    security,
    responses: {
      200: {
        description: "Bodyless readiness status",
        headers: { "AgentFlow-Generation": { schema: schema(uuid) } },
      },
      401: { $ref: "#/components/responses/RequestError" },
      503: { $ref: "#/components/responses/RetryableError" },
    },
  };
  paths["/api/v1/session"] = {
    post: {
      operationId: "pairSession",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: schema(foundationSchemas.pairInput),
            example: { token: "synthetic-pairing-example" },
          },
        },
      },
      responses: responses(200, foundationSchemas.paired, { paired: true }),
    },
    delete: {
      operationId: "revokeSession",
      security: [{ browserSession: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: schema(foundationSchemas.revokeInput),
            example: {},
          },
        },
      },
      responses: { 204: { description: "Session revoked; empty body" } },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "AgentFlow local API",
      version: "v1-p05-transport",
      description:
        "Implemented P01–P04 operations and the P05 native stream transport. Activity, browser live tracking and workflows remain planned. Metadata is inert; credentials never belong in URLs. Cookie mutations require exact Origin and same-origin Fetch Metadata. Reporter mutations permit originless requests or an exact allowed local Origin. JSON bodies are capped at 64 KiB and five seconds. Mutation budget is installation-wide 100 per second with burst 200.",
    },
    servers: [{ url: "http://127.0.0.1:3000" }],
    paths,
    components: {
      responses: {
        RequestError: {
          description:
            "Rejected request. Authenticated errors carry current generation.",
          headers: { "AgentFlow-Generation": { schema: schema(uuid) } },
          content: {
            "application/json": {
              schema: schema(errorSchema),
              example: errorExample,
            },
          },
        },
        RetryableError: {
          description:
            "Retryable rejection. Authenticated errors carry current generation.",
          headers: {
            "AgentFlow-Generation": { schema: schema(uuid) },
            "Retry-After": { schema: { type: "string" }, example: "1" },
          },
          content: {
            "application/json": {
              schema: schema(errorSchema),
              example: errorExample,
            },
          },
        },
      },
      securitySchemes: {
        browserSession: {
          type: "apiKey",
          in: "cookie",
          name: "agentflow_session",
        },
        reporterBearer: { type: "http", scheme: "bearer" },
      },
      schemas: {
        TaskDetailV1: schema(taskDetailV1),
        TaskDetailQueryV1: schema(taskDetailQueryV1, "input"),
      },
      examples: {
        taskHistoryContinuation: { value: detailContinuationExample },
      },
    },
  };
}
