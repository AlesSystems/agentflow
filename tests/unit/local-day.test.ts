import { expect,it } from 'vitest';
import { localDayInterval, localDate } from '../../src/domain/local-day';
const fixtures=[['UTC','2026-10-09','2026-10-09T00:00Z','2026-10-10T00:00Z'],['America/New_York','2026-03-08','2026-03-08T05:00Z','2026-03-09T04:00Z'],['America/New_York','2026-11-01','2026-11-01T04:00Z','2026-11-02T05:00Z'],['America/Havana','2020-11-01','2020-11-01T04:00Z','2020-11-02T05:00Z'],['America/Sao_Paulo','2018-11-04','2018-11-04T03:00Z','2018-11-05T02:00Z'],['Pacific/Apia','2011-12-30','2011-12-30T10:00Z','2011-12-30T10:00Z']];
for(const [zone,date,start,end] of fixtures) it(`finds exact half-open ${zone} ${date} interval`,()=>{
 const interval=localDayInterval(date,zone);
 expect(interval).toEqual({start:Date.parse(start),end:Date.parse(end)});
 expect(localDate(interval.start-1,zone)<date).toBe(true);
 if(interval.start<interval.end){expect(localDate(interval.start,zone)).toBe(date);expect(localDate(interval.end-1,zone)).toBe(date);}
 else expect(localDate(interval.start,zone)>date).toBe(true);
 expect(localDate(interval.end,zone)>date).toBe(true);
});
