import { z } from 'zod';
import { envelope, pageQuery, requiredText, role, safeUrl, timestamp, uuid, version } from './common';
import { run } from './tasks';
export const agentCreate=z.strictObject({id:uuid.optional(),displayName:requiredText(200),source:requiredText(200),defaultRole:role});
export const agentPatch=z.strictObject({expectedVersion:version,displayName:requiredText(200).optional(),source:requiredText(200).optional(),defaultRole:role.optional()}).refine(v=>Object.keys(v).length>1);
export const agent=z.strictObject({id:uuid,displayName:z.string(),source:z.string(),defaultRole:role,version,createdAt:timestamp});
export const runRegister=z.strictObject({id:uuid,projectId:uuid,agentId:uuid,taskId:uuid.optional(),purpose:run.shape.purpose,model:requiredText(200).optional(),expectedTaskVersion:version.optional()}).refine(v=>v.taskId ? v.expectedTaskVersion!==undefined : v.purpose==='planning' && v.expectedTaskVersion===undefined);
export const runQuery=z.strictObject({...pageQuery,projectId:uuid.optional(),agentId:uuid.optional(),taskId:uuid.optional(),state:run.shape.state.optional(),stale:z.enum(['true','false']).optional()});
export const agentQuery=z.strictObject(pageQuery);
export const eventQuery=z.strictObject(pageQuery);
export const closeInput=z.strictObject({expectedVersion:version,reason:requiredText(4000)});
export const freshness=z.strictObject({stale:z.boolean(),reporting:z.enum(['no_report_received','fresh','stale','terminal'])});
export const observedRun=run.extend({freshness});
export const observedAgent=agent.extend({reporting:z.boolean(),activeRunsUrl:z.string(),historyUrl:z.string()});
const eventBase={schemaVersion:z.literal(1),eventId:uuid,runId:uuid,sequence:version,occurredAt:z.iso.datetime({offset:true}).transform(v=>new Date(v).toISOString())};
export const eventInput=z.discriminatedUnion('type',[
 z.strictObject({...eventBase,type:z.literal('run.started'),payload:z.strictObject({})}),
 z.strictObject({...eventBase,type:z.literal('run.heartbeat'),payload:z.strictObject({})}),
 z.strictObject({...eventBase,type:z.literal('run.progress'),payload:z.strictObject({message:requiredText(4000),percent:z.number().int().min(0).max(100).optional()})}),
 z.strictObject({...eventBase,type:z.literal('run.succeeded'),payload:z.strictObject({summary:requiredText(4000),evidenceUrl:safeUrl.optional()})}),
 z.strictObject({...eventBase,type:z.literal('run.failed'),payload:z.strictObject({message:requiredText(4000),code:requiredText(100).optional()})}),
 z.strictObject({...eventBase,type:z.literal('run.cancelled'),payload:z.strictObject({reason:requiredText(4000)})}),
]);
export const acknowledgement=z.strictObject({eventId:uuid,runId:uuid,acceptedSequence:version,receivedAt:timestamp});
export const storedEvent=z.intersection(eventInput,z.strictObject({receivedAt:timestamp}));
// The event envelope is extended per variant so unknown fields remain rejected.
export const eventRecord=z.union(eventInput.options.map(option=>option.extend({receivedAt:timestamp})));
const list=<S extends z.ZodType>(item:S)=>z.strictObject({items:z.array(item),total:z.number().int().nonnegative(),nextCursor:z.string().nullable()});
export const agentResponse=envelope(observedAgent);
export const agentsResponse=envelope(list(observedAgent));
export const runResponse=envelope(observedRun);
export const runsResponse=envelope(list(observedRun));
export const eventResponse=envelope(acknowledgement);
export const eventsResponse=envelope(list(eventRecord));
export type Run=z.infer<typeof run>;
export type RunRegistration=z.infer<typeof runRegister>;
export type EventInput=z.infer<typeof eventInput>;
