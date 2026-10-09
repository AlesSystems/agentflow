import { expect,it } from 'vitest';
import { MutationBudget } from '../../src/server/security';
it('shares burst 200 and refills exactly 100 requests per second',()=>{
 const budget=new MutationBudget(0);const now=0;
 for(let i=0;i<200;i++)budget.charge(now);
 expect(()=>budget.charge(now)).toThrow('rate_limited');
 budget.charge(now+10);expect(()=>budget.charge(now+10)).toThrow('rate_limited');
 for(let i=0;i<100;i++)budget.charge(now+1010);
 expect(()=>budget.charge(now+1010)).toThrow('rate_limited');
});
