import { readFileSync,writeFileSync } from 'node:fs';
import { openapiDocument } from '../src/contracts/openapi';
const path='docs/openapi.json';
const rendered=JSON.stringify(openapiDocument(),null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==rendered)throw new Error('OPENAPI_STALE');console.log('OpenAPI registry, examples and committed output match.');}
else writeFileSync(path,rendered);
