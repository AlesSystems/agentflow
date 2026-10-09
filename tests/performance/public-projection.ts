import type {ApplicationQuery,SnapshotBody} from '../../src/db/application';
export function comparableSnapshot(_query:ApplicationQuery,body:SnapshotBody):unknown {return body.data;}
