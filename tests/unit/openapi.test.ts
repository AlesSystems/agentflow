import { expect,it } from 'vitest';
import { openapiDocument } from '../../src/contracts/openapi';
import { endpoints } from '../../src/contracts/routes';
import { requestExamples,responseExamples } from '../../src/contracts/examples';
it('publishes every implemented registry operation and validates every example',()=>{
 const doc=openapiDocument();expect(doc.openapi).toBe('3.1.0');
 for(const endpoint of endpoints){expect(endpoint.input.safeParse(requestExamples[endpoint.id]).success).toBe(true);expect(endpoint.response.safeParse(responseExamples[endpoint.id]).success).toBe(true);expect(doc.paths['/api/v1'+endpoint.path][endpoint.method.toLowerCase()]).toBeDefined();}
 expect(doc.paths['/api/v1/runs']).toBeUndefined();
});
