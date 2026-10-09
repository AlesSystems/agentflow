import { describe, expect, it } from 'vitest';
import { taskCreate, taskPatch } from '../../src/contracts/tasks';
import { canonicalDigest } from '../../src/contracts/common';
const projectId = '10000000-0000-4000-8000-000000000001';
describe('P02 input contracts', () => {
 it('preserves accepted text limits and rejects unknown or forged fields', () => {
 expect(taskCreate.safeParse({projectId,title:'x',description:'x'.repeat(20000),acceptanceCriteria:'x'.repeat(8000)}).success).toBe(true);
 for(const extra of [{description:'x'.repeat(20001)},{acceptanceCriteria:'x'.repeat(8001)},{actor:'operator'},{version:7},{pullRequestUrl:'https://user:secret@example.com'}]) expect(taskCreate.safeParse({projectId,title:'x',...extra}).success).toBe(false);
 expect(taskPatch.safeParse({expectedVersion:1}).success).toBe(false);
 });
 it('hashes original JSON identity before normalization and defaults', () => {
 expect(canonicalDigest({b:2,a:1})).toBe(canonicalDigest(JSON.parse('{ "a":1,"b":2 }')));
 expect(canonicalDigest({title:'x'})).not.toBe(canonicalDigest({title:' x '}));
 expect(canonicalDigest({title:'x'})).not.toBe(canonicalDigest({title:'x',tags:[]}));
 });
});
