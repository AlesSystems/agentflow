import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync,statSync} from "node:fs";
import {join,relative} from "node:path";
import Database from "better-sqlite3";
import {eventInput,eventRecord,eventResponse,eventsResponse,acknowledgement} from "../../src/contracts/observations";
import {uuid} from "../../src/contracts/common";
import {canonicalDigest} from "../../src/domain/request-digest";
import type {launch} from "./server";
export type Queued={body:Record<string,unknown>;digest:string;bytes:number;fileSha256:string;filename:string;originalBytesBase64:string};
export type Attempt={requestBytesBase64:string;responseBytesBase64:string|null;status:number|null;generation:string|null};
export type FlushFacts={expected:{tasks:number;events:number;producers:number;queued:number;runs:string[]};queued:Queued[];attempts:Attempt[];stdout:string[];generation:string|null;database:null|{rows:{event_id:string;run_id:string;sequence:number;digest:string;body:string;acknowledgement:string;received_at:number;occurred_at:number}[];counts:Record<string,number>;integrity:unknown;foreignKeys:unknown};pages:{status:number;raw:string;generation:string|null}[];files:{path:string;bytesBase64:string}[]};
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
export async function collectFlush(facts:FlushFacts,dir:string,outbox:string,server:Awaited<ReturnType<typeof launch>>) {
  const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});
  try{
    facts.generation=(db.prepare("SELECT generation FROM instance_metadata").get() as {generation:string}).generation;
    facts.database={rows:db.prepare(`SELECT event_id,run_id,sequence,digest,body,acknowledgement,received_at,occurred_at FROM run_events WHERE run_id IN (${facts.expected.runs.map(()=>"?").join(",")}) ORDER BY run_id,sequence`).all(...facts.expected.runs) as NonNullable<FlushFacts["database"]>["rows"],counts:Object.fromEntries(["tasks","agents","runs","run_events"].map(table=>[table,(db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n])),integrity:db.pragma("integrity_check"),foreignKeys:db.pragma("foreign_key_check")};
  }finally{db.close();}
  for(const file of readdirSync(outbox,{recursive:true}).map(String)){const path=join(outbox,file);if(statSync(path).isFile())facts.files.push({path:relative(outbox,path),bytesBase64:readFileSync(path).toString("base64")});}
  for(const runId of facts.expected.runs){let cursor:string|null=null;do{
    const response:Response=await fetch(server.url+`/api/v1/runs/${runId}/events?limit=100`+(cursor?`&cursor=${encodeURIComponent(cursor)}`:""),{headers:{Authorization:"Bearer "+server.credentials().reporterToken}});
    const raw=await response.text();facts.pages.push({status:response.status,raw,generation:response.headers.get("agentflow-generation")});assert.equal(response.status,200,"API_STATUS");
    cursor=eventsResponse.parse(JSON.parse(raw)).data.nextCursor;
  }while(cursor);}
}
export function validateFlush(facts:FlushFacts) {
  assert.equal(facts.queued.length,facts.expected.queued,"QUEUED_COUNT");
  const generation=uuid.parse(facts.generation),db=facts.database;assert(db,"DATABASE_FACTS");
  assert.deepEqual(db.integrity,[{integrity_check:"ok"}],"INTEGRITY");assert.deepEqual(db.foreignKeys,[],"FOREIGN_KEYS");
  assert.deepEqual(db.counts,{tasks:facts.expected.tasks,agents:facts.expected.producers,runs:facts.expected.producers*2,run_events:facts.expected.events+facts.expected.queued},"ENTITY_COUNTS");
  const inputs=new Map(facts.queued.map(queue=>{const bytes=Buffer.from(queue.originalBytesBase64,"base64");assert.equal(bytes.length,queue.bytes,"QUEUE_BYTES");assert.equal(hash(bytes),queue.fileSha256,"QUEUE_HASH");const original=JSON.parse(bytes.toString());assert.deepEqual(original.body,queue.body,"QUEUE_BODY");assert.equal(original.digest,queue.digest,"QUEUE_DIGEST");const input=eventInput.parse(queue.body);assert.equal(canonicalDigest(input),queue.digest,"INPUT_DIGEST");assert.equal(queue.filename,`${input.runId}/${input.sequence}-${input.eventId}.json`,"QUEUE_FILENAME");return[input.eventId,input] as const;}));
  assert.equal(inputs.size,facts.expected.queued,"UNIQUE_QUEUE_IDS");assert.equal(db.rows.length,inputs.size,"STORED_COUNT");assert.equal(new Set(db.rows.map(row=>row.event_id)).size,inputs.size,"DUPLICATE_STORED_IDS");
  const stored=new Map(db.rows.map(row=>{const event=eventRecord.parse(JSON.parse(row.body));const {receivedAt,...input}=event;assert.deepEqual(input,inputs.get(event.eventId),"STORED_INPUT");assert.equal(row.event_id,event.eventId);assert.equal(row.run_id,event.runId);assert.equal(row.sequence,event.sequence);assert.equal(row.digest,canonicalDigest(input),"STORED_DIGEST");assert.equal(row.received_at,Date.parse(receivedAt),"STORED_RECEIPT_TIME");assert.equal(row.occurred_at,Date.parse(event.occurredAt),"STORED_OCCURRED_TIME");const receipt=eventResponse.parse(JSON.parse(row.acknowledgement));assert.deepEqual(receipt.data,{eventId:event.eventId,runId:event.runId,acceptedSequence:event.sequence,receivedAt},"STORED_ACK");assert.equal(receipt.generation,generation,"STORED_GENERATION");return[event.eventId,{event,ack:receipt.data}] as const;}));
  const attempts={created201:0,replayed200:0,limited429:0,errors:0};const delivered=new Set<string>();
  for(const attempt of facts.attempts){const bytes=Buffer.from(attempt.requestBytesBase64,"base64"),input=eventInput.parse(JSON.parse(bytes.toString()));assert.deepEqual(input,inputs.get(input.eventId),"HTTP_INPUT");assert.equal(bytes.toString(),JSON.stringify(input),"HTTP_BYTES");
    if(attempt.status!==null&&[200,201].includes(attempt.status)){const receipt=eventResponse.parse(JSON.parse(Buffer.from(attempt.responseBytesBase64!,"base64").toString()));assert.equal(attempt.generation,generation,"HTTP_HEADER_GENERATION");assert.equal(receipt.generation,generation,"HTTP_BODY_GENERATION");assert.deepEqual(receipt.data,stored.get(input.eventId)?.ack,"HTTP_ACK");delivered.add(input.eventId);if(attempt.status===201)attempts.created201++;else attempts.replayed200++;}else if(attempt.status===429)attempts.limited429++;else attempts.errors++;
  }
  assert.equal(delivered.size,inputs.size,"HTTP_DELIVERY_COVERAGE");assert.equal(attempts.errors,0,"HTTP_ERRORS");
  const stdout=facts.stdout.flatMap(text=>text.split("\n").filter(line=>line.trim()).map(line=>acknowledgement.extend({generation:uuid}).parse(JSON.parse(line))));const emitted=new Set<string>();
  for(const ack of stdout){const {generation:stdoutGeneration,...receipt}=ack;assert.equal(stdoutGeneration,generation,"STDOUT_GENERATION");assert.deepEqual(receipt,stored.get(ack.eventId)?.ack,"STDOUT_ACK");emitted.add(ack.eventId);}
  assert.equal(emitted.size,inputs.size,"STDOUT_COVERAGE");
  const api=facts.pages.flatMap(page=>{assert.equal(page.status,200);assert.equal(page.generation,generation,"API_HEADER_GENERATION");const body=eventsResponse.parse(JSON.parse(page.raw));assert.equal(body.generation,generation,"API_BODY_GENERATION");return body.data.items;});assert.equal(api.length,inputs.size,"API_COUNT");assert.equal(new Set(api.map(event=>event.eventId)).size,inputs.size,"DUPLICATE_API_IDS");for(const event of api)assert.deepEqual(event,stored.get(event.eventId)?.event,"API_BODY_RECEIPT");
  const files=new Map(facts.files.map(file=>[file.path,file]));const metadata=JSON.parse(Buffer.from(files.get("metadata.json")!.bytesBase64,"base64").toString());assert.equal(metadata.pendingRegistration,undefined,"PENDING_REGISTRATION");assert.equal(metadata.generation,generation,"METADATA_GENERATION");
  const pending=facts.files.filter(file=>file.path!=="metadata.json"&&!/^(publication|delivery)\.sqlite(?:-(wal|shm|journal))?$/.test(file.path)&&!facts.expected.runs.some(id=>file.path===id+"/state.json"));assert.equal(pending.length,0,"PENDING_ARTIFACTS");
  const perRun=facts.expected.queued/facts.expected.producers;assert(Number.isInteger(perRun));
  for(const runId of facts.expected.runs){const sequence=[...inputs.values()].filter(input=>input.runId===runId).map(input=>input.sequence).sort((a,b)=>a-b);assert.deepEqual(sequence,Array.from({length:perRun},(_,i)=>i+1),"CONTIGUOUS_SEQUENCE");const file=files.get(runId+"/state.json");assert(file,"STATE_MISSING");const state=JSON.parse(Buffer.from(file.bytesBase64,"base64").toString());assert.equal(state.runId,runId);assert.equal(state.formatVersion,1);assert.equal(state.generation,generation,"STATE_GENERATION");assert.equal(state.allocatedThrough,perRun,"ALLOCATED_WATERMARK");assert.equal(state.acknowledgedThrough,perRun,"ACKED_WATERMARK");assert.equal(state.pending,undefined,"PENDING_DESCRIPTOR");}
  return {status:"finalized",uniqueEvents:inputs.size,stdoutAttempts:stdout.length,httpAttempts:facts.attempts.length,...attempts,allocated:facts.expected.queued,acked:facts.expected.queued,pending:0,apiCount:api.length};
}
