import { historyLine } from "./history";
import { historyExportExamples } from "./examples";
import { taskRegistrationExample } from "./examples";
import { taskRegistrationResponse } from "./task-registration";
import { foundationSchemas } from "./foundation";
import { z } from "zod";
import { prerequisite } from "./evidence";
import { endpoints } from "./routes";
import { uuid, version, changeCursor } from "./common";
import {
  requestExamples,
  responseExamples,
  detailContinuationExample,
} from "./examples";
import { run, taskDetailV1, taskDetailQueryV1 } from "./tasks";
import { envelope } from "./common";
export const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    details: z
      .strictObject({
        currentVersion: version.optional(),
        expectedSequence: version.optional(),
        blockedPrerequisiteIds: z.array(uuid).max(20).optional(),
        prerequisites: z.array(prerequisite).max(20).optional(),
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
    override(context) {
      if (io === "output" && context.zodSchema instanceof z.ZodObject
        && context.zodSchema.shape.artifactRef === run.shape.artifactRef
        && context.zodSchema.shape.reworkRound === run.shape.reworkRound)
        context.jsonSchema.required = context.jsonSchema.required?.filter(key => key !== "artifactRef" && key !== "reworkRound");
    },
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
  taskMinimal?: unknown,
) {
  const headers = authenticated
    ? {
        ...(taskMinimal ? { Vary: { schema: {type:"string"}, example:"Prefer", description:"Full and minimal task creation representations vary on Prefer; existing Vary values remain." }, "Preference-Applied": { schema: {type:"string",const:"return=minimal"}, description:"Present only for the compact task creation representation." } } : {}),
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
      content: { "application/json": { schema: schema(response), ...(taskMinimal ? { examples: { full: {value:example}, minimal: {value:taskMinimal} } } : {example}) } },
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
    if (endpoint.kind === "export") {
      const lines=historyExportExamples;
      endpoint.input.parse(requestExamples[endpoint.id]);
      for(const line of lines)historyLine.parse(line);
      const example=lines.map(line=>JSON.stringify(line)).join("\n")+"\n";
      const headers={"AgentFlow-Generation":{schema:schema(uuid)}};
      const parameters=[{in:"query",name:"content",required:true,schema:{type:"string"},example:"tasks,attempts,workflows,github",description:"Nonempty duplicate-free subset in canonical order. Unknown and repeated keys, cursor and unsupported groups are rejected before copying."},{in:"query",name:"generation",required:true,schema:schema(uuid)}];
      const errors=responses(200,endpoint.response,undefined);
      paths["/api/v1"+endpoint.path]={get:{operationId:endpoint.id,description:endpoint.description,security:[{browserSession:[]}],parameters,responses:{...errors,200:{description:"Versioned JSONL manifest, explicit record lines, and completion only after all selected records",headers,content:{"application/x-ndjson":{schema:{type:"string"},example,"x-line-schema":schema(historyLine)}}}}},head:{operationId:endpoint.id+"Head",security:[{browserSession:[]}],parameters,responses:{...errors,200:{description:"Validated bodyless export status; creates no snapshot",headers}}}};
      continue;
    }
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
    endpoint.taskCreationReply?.response.parse(taskRegistrationExample);
    const path = "/api/v1" + endpoint.path;
    const input = schema(endpoint.input, "input") as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const parameters: unknown[] = [];
    if(endpoint.taskCreationReply)parameters.push({in:"header",name:"Prefer",required:false,schema:{type:"string"},example:"return=minimal",description:"Task create only. Single return=minimal preference accepts case-insensitive name and surrounding/equal-sign spaces or tabs; the value minimal is case-sensitive. Unsupported, malformed, duplicate or conflicting forms return the full receipt. Compact data is a pure view of the original receipt, with original status/cursor/body generation and current generation header."});
    for (const match of endpoint.path.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g))
      parameters.push({
        in: "path",
        name: match[1],
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
          endpoint.taskCreationReply ? z.union([endpoint.response,endpoint.taskCreationReply.response]) : endpoint.response,
          responseExamples[endpoint.id],
          true,
          endpoint.taskCreationReply ? taskRegistrationExample : undefined,
        ),
        ...(["registerRun", "ingestEvent", "createWorkflow", "createWorkflowRevision", "registerWorkflowRun", "ingestWorkflowEvent"].includes(endpoint.id)
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
      version: "v1-p05",
      description:
        "Implemented P01–P05 operations, including native SSE, joined tracking and Activity snapshots, and the browser subscription/recovery owner. Producer CLI hooks and workflows remain planned. Metadata is inert; credentials never belong in URLs. Cookie mutations require exact Origin and same-origin Fetch Metadata. Reporter mutations permit originless requests or an exact allowed local Origin. JSON bodies are capped at 64 KiB and five seconds. Mutation budget is installation-wide 100 per second with burst 200.",
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
        TaskRegistrationResponse: schema(taskRegistrationResponse),
        TaskDetailV1: schema(taskDetailV1),
        TaskDetailQueryV1: schema(taskDetailQueryV1, "input"),
      },
      examples: {
        taskHistoryContinuation: { value: detailContinuationExample },
      },
    },
  };
}
