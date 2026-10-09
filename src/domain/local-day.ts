import { Temporal } from '@js-temporal/polyfill';
export function localDate(now:number,zone:string):string {
 return Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).toPlainDate().toString();
}
export function localDayInterval(date:string,zone:string):{start:number;end:number} {
 const target=Temporal.PlainDate.from(date);
 const start=target.toZonedDateTime(zone).epochMilliseconds;
 const end=target.add({days:1}).toZonedDateTime(zone).epochMilliseconds;
 return {start,end};
}
