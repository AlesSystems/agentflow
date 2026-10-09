import { z } from 'zod';
export const uuid = z.uuid();
export const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const timestamp = z.iso.datetime();
export const requiredText = (max: number) => z.string().max(max).trim().min(1);
export const nullableText = (max: number) => z.string().max(max).nullable();
export const safeUrl = z.string().max(2000).url().refine(value => {
 const url = new URL(value);
 return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
});
export const role = z.enum(['orchestrator','implementation','reviewer','verifier']);
export const priority = z.enum(['low','normal','high','urgent']);
export const status = z.enum(['backlog','in_progress','review','completed']);
export const manualStatus = z.enum(['backlog','in_progress','review']);
export const actor = z.enum(['operator','reporter']);
export const pageQuery = {limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.string().max(4096).optional()};
export const envelope = <T extends z.ZodType>(data:T) => z.strictObject({data,snapshotCursor:z.string().regex(/^\d+$/),generation:uuid});
export const timezone = z.string().max(100).refine(value => {
 if(!/^[A-Za-z][A-Za-z_+\-/]*$/.test(value) || /^(GMT|UTC)[+-]/.test(value)) return false;
 try { new Intl.DateTimeFormat('en',{timeZone:value}); return true; } catch { return false; }
});
