export function queryPath(path: string) {
  const url = new URL(path, "http://agentflow.local");
  url.searchParams.sort();
  return url.pathname + url.search;
}
