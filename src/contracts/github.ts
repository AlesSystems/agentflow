import { z } from "zod";
import { envelope, timestamp, version } from "./common";
export const githubRepository = z.string().max(140).regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/).refine(value => ![".",".."].includes(value.split("/")[1])).toLowerCase();
const number = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const githubRepositoriesInput = z.strictObject({expectedVersion:version,enabled:z.boolean(),repositories:z.array(githubRepository).max(10).refine(values => new Set(values).size === values.length)});
export const githubRefreshInput = z.union([
 z.strictObject({expectedVersion:version,repository:githubRepository,page:z.number().int().min(1).max(1000)}),
 z.strictObject({expectedVersion:version,repository:githubRepository,number}),
]);
export const githubQuery = z.strictObject({repository:githubRepository.optional(),number:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),limit:z.coerce.number().int().min(1).max(100).default(20),cursor:z.string().max(4096).optional()}).refine(value => value.number === undefined || value.repository !== undefined);
export const githubError = z.enum(["credential_unavailable","credential_repair","offline","timeout","invalid_payload","response_too_large","redirect_rejected","authentication","forbidden","inaccessible","rate_limited","upstream","interrupted"]);
export const githubPullRequest = z.strictObject({repository:githubRepository,number,url:z.string().max(300),title:z.string().max(1000),state:z.enum(["open","closed"]),draft:z.boolean(),headSha:z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/),baseBranch:z.string().min(1).max(255),mergedAt:timestamp.nullable(),previousHeadSha:z.string().nullable(),fetchedAt:timestamp,lastAttemptedAt:timestamp,lastError:githubError.nullable(),stale:z.boolean(),headChanged:z.boolean()});
export const githubConnection = z.strictObject({enabled:z.boolean(),repositories:z.array(githubRepository).max(10),version,lastAttemptedAt:timestamp.nullable(),lastFetchedAt:timestamp.nullable(),lastError:githubError.nullable(),retryNotBefore:timestamp.nullable(),credential:z.enum(["configured","unavailable","repair"]),busy:z.boolean()});
export const githubRefreshResult = z.strictObject({repository:githubRepository,page:z.number().nullable(),number:number.nullable(),outcome:z.enum(["fetched","failed","interrupted","superseded"]),error:githubError.nullable(),attemptedAt:timestamp,fetchedAt:timestamp.nullable(),nextPage:z.number().int().min(1).max(1000).nullable(),count:z.number().int().nonnegative().max(20)});
export const githubResponse = envelope(z.strictObject({connection:githubConnection,items:z.array(githubPullRequest).max(100),total:z.number().int().nonnegative(),nextCursor:z.string().nullable(),lookupAttempt:z.strictObject({attemptedAt:timestamp,error:githubError.nullable()}).nullable()}));
export const githubRepositoriesResponse = envelope(githubConnection);
export const githubRefreshResponse = envelope(githubRefreshResult);
export type GithubRefreshInput = z.infer<typeof githubRefreshInput>;
export type GithubQuery = z.infer<typeof githubQuery>;
export type GithubRepositoriesInput = z.infer<typeof githubRepositoriesInput>;
export type GithubError = z.infer<typeof githubError>;
export type GithubMetadata = Pick<z.infer<typeof githubPullRequest>,"repository"|"number"|"url"|"title"|"state"|"draft"|"headSha"|"baseBranch"|"mergedAt">;
export type GithubOutcome = {outcome:"fetched"|"failed"|"interrupted";error:GithubError|null;retryNotBefore:number|null;items:GithubMetadata[];nextPage:number|null};
export function pullRequestIdentity(value:string) {
 const match=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9][0-9]*)$/.exec(value);
 if(!match) return null;
 const repository=githubRepository.safeParse(match[1]);const parsed=number.safeParse(Number(match[2]));
 return repository.success && parsed.success ? {repository:repository.data,number:parsed.data} : null;
}
