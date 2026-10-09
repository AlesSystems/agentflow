import { z } from 'zod';
import { uuid, version, timestamp, requiredText, nullableText, pageQuery } from './common';
export const projectCreate = z.strictObject({name:requiredText(200),repositoryPath:nullableText(2000).optional()});
export const projectPatch = z.strictObject({expectedVersion:version,name:requiredText(200).optional(),repositoryPath:nullableText(2000).optional(),archived:z.boolean().optional()}).refine(value=>Object.keys(value).length>1);
export const project = z.strictObject({id:uuid,name:z.string(),repositoryPath:z.string().nullable(),archivedAt:timestamp.nullable(),version,createdAt:timestamp,updatedAt:timestamp});
export const projectQuery = z.strictObject({...pageQuery,archived:z.enum(['true','false']).optional()});
