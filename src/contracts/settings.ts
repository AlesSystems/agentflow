import { z } from 'zod';
import { timezone, version } from './common';
export const settingsPatch = z.strictObject({expectedVersion:version,timezone});
export const settings = z.strictObject({timezone,version,dataLocation:z.string(),storageBytes:z.number().int().nonnegative(),storageMeasurement:z.literal('observational')});
