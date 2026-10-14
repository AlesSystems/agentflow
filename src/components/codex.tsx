"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useWorkspace, QueryFeedback } from "../client/provider";
import { ApiError } from "../client/api";
import { connectorListResponse, connectorDetailResponse, connectorId, type ConnectorChat, type ConnectorConnection, type ConnectorTurn } from "../contracts/connectors";

function firstById<T extends {id: string}>(items: T[]) {
  const found = new Map<string, T>();
  for (const item of items) if (!found.has(item.id)) found.set(item.id, item);
  return [...found.values()];
}
function time(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Time unavailable";
}
function Connection({ data }: { data?: ConnectorConnection }) {
  return <p className={data?.state === "stale" || data?.state === "unavailable" ? "notice codex-connection" : "metadata codex-connection"} role="status">
    {data?.state === "connected" ? "Codex connected" : data?.state === "stale" ? "Codex unavailable. Showing the last observations." : data?.state === "unavailable" ? "Codex connection unavailable" : "Connecting to Codex…"}
    {data?.observedAt && <> · Observed {time(data.observedAt)}</>}
    {data?.message && <>. {data.message}</>}
  </p>;
}
function ChatMetadata({ chat }: { chat: ConnectorChat }) {
  return <span className="metadata codex-chat-meta">{chat.statusSource === "stored" ? "Stored observation" : "Live observation"} · {chat.status}
    {chat.agentNickname && <> · {chat.agentNickname}</>}{chat.agentRole && <> · {chat.agentRole}</>}{chat.model && <> · {chat.model}</>}
    {chat.updatedAt && <> · {time(chat.updatedAt)}</>}
  </span>;
}
function Turn({ turn }: { turn: ConnectorTurn }) {
  return <article className="codex-turn">
    <div className="codex-turn-heading"><h3>{turn.request ? "Task request" : "Recorded turn"}</h3><span className="report-label">{turn.status}</span></div>
    {turn.request ? <p className="codex-text">{turn.request}</p> : <p className="metadata">No task request was recorded for this turn.</p>}
    <p className="metadata">Started {time(turn.startedAt)}{turn.completedAt && <> · Finished {time(turn.completedAt)}</>}</p>
    {turn.tasks.length > 0 ? <><h4>Reported checklist</h4><ol className="codex-checklist">{turn.tasks.map((task, i) => <li key={i}><span>{task.text}</span><span className="report-label">{task.status.replaceAll("_", " ")}</span></li>)}</ol>
      {turn.progress && <p>{turn.progress.completed} of {turn.progress.total} checklist steps completed ({turn.progress.percent}%).</p>}</> : <p className="metadata">Checklist progress is unknown. Codex has no explicit checklist for this turn.</p>}
    {turn.planText && <details><summary>Recorded plan</summary><p className="codex-text">{turn.planText}</p></details>}
    {turn.latestMessage && <details open><summary>Latest agent update</summary><p className="codex-text">{turn.latestMessage}</p></details>}
  </article>;
}
export function Codex({initialSelected}: {initialSelected?: string | null}) {
  const { api, generation, pair } = useWorkspace();
  const [selected, setSelected] = useState<string | null>(initialSelected ?? null);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [kind, setKind] = useState<"chats" | "agents" | "all">("chats");
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update(); document.addEventListener("visibilitychange", update);
    const pop = () => { const id = new URLSearchParams(window.location.search).get("chat"); setSelected(id && connectorId.safeParse(id).success ? id : null); };
    window.addEventListener("popstate", pop);
    return () => { document.removeEventListener("visibilitychange", update); window.removeEventListener("popstate", pop); };
  }, []);
  function select(id: string | null) {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("chat", id); else url.searchParams.delete("chat");
    window.history.pushState(null, "", url);
  }
  const list = useInfiniteQuery({
    queryKey: [generation, "codex", "list", search, archived, kind],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "30", archived: String(archived), kind });
      if (search) params.set("search", search); if (pageParam) params.set("cursor", pageParam);
      return api.read(`/connections/codex?${params}`, connectorListResponse);
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    refetchInterval: visible ? 5000 : false,
    refetchIntervalInBackground: false,
  });
  const detail = useInfiniteQuery({
    queryKey: [generation, "codex", "detail", selected],
    enabled: !!selected,
    initialPageParam: {} as { turnsCursor?: string; agentsCursor?: string; turnsDone?: boolean; agentsDone?: boolean },
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam.turnsCursor) params.set("turnsCursor", pageParam.turnsCursor);
      if (pageParam.agentsCursor) params.set("agentsCursor", pageParam.agentsCursor);
      return api.read(`/connections/codex/${encodeURIComponent(selected!)}${params.size ? `?${params}` : ""}`, connectorDetailResponse);
    },
    getNextPageParam: (page, _pages, previous) => {
      const turnsCursor = previous.turnsDone ? null : page.data.nextTurnsCursor;
      const agentsCursor = previous.agentsDone ? null : page.data.nextAgentsCursor;
      return turnsCursor || agentsCursor ? { turnsCursor: turnsCursor ?? undefined, agentsCursor: agentsCursor ?? undefined, turnsDone: !turnsCursor, agentsDone: !agentsCursor } : undefined;
    },
    refetchInterval: visible ? 5000 : false,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    if ([list.error, detail.error].some(e => e instanceof ApiError && e.status === 401)) pair();
  }, [list.error, detail.error, pair]);
  const chats = firstById(list.data?.pages.flatMap(p => p.data) ?? []);
  const current = detail.data?.pages[0]?.data;
  const turns = firstById(detail.data?.pages.flatMap(p => p.data.turns) ?? []);
  const agents = firstById(detail.data?.pages.flatMap(p => p.data.agents) ?? []);
  return <>
    <div className="codex-page-heading"><div><h1>Codex</h1><p className="intro">Your existing chats, agent tasks, and recorded progress.</p></div><button disabled={list.isFetching || detail.isFetching} onClick={() => { void list.refetch(); if (selected) void detail.refetch(); }}>Refresh Codex</button></div>
    <Connection data={selected ? detail.data?.pages[0]?.connection ?? list.data?.pages[0]?.connection : list.data?.pages[0]?.connection} />
    <p className="metadata">Automatically refreshed every 5 seconds while this page is visible. Stored observations describe recorded work; they do not confirm an agent is running now. AgentFlow observes Codex and never starts or changes its work.</p>
    <div className="codex-workspace">
      <section className="codex-chats" aria-label="Codex chats">
        <h2>{kind === "agents" ? "Agents" : kind === "all" ? "Chats and agents" : "Chats"}</h2><label className="codex-kind">Show<select value={kind} onChange={e => setKind(e.target.value as "chats" | "agents" | "all")}><option value="chats">Chats</option><option value="agents">Child agents</option><option value="all">All chats and agents</option></select></label><form className="codex-filters" onSubmit={e => { e.preventDefault(); setSearch(String(new FormData(e.currentTarget).get("search") ?? "")); }}><label>Search chats<input name="search" type="search" maxLength={200} placeholder="Search by title" /></label><button>Search</button><label className="checkbox-label"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Show archived chats</label></form>
        <QueryFeedback error={list.error} loading={list.isPending} retry={() => void list.refetch()} />
        {!list.isPending && !list.error && chats.length === 0 && <p>{list.data?.pages[0]?.connection.state === "unavailable" ? "Open Codex on this machine, then refresh to reconnect." : "No chats match this view. Try another search or the archived view."}</p>}
        <ul className="codex-chat-list">{chats.map(chat => <li key={chat.id}><button className="codex-chat-button" aria-current={selected === chat.id ? "true" : undefined} onClick={() => select(chat.id)}><strong>{chat.title || "Untitled chat"}</strong><ChatMetadata chat={chat} />{chat.cwd && <span className="metadata break-word">{chat.cwd}</span>}{chat.parentId && <span className="metadata">Child agent chat</span>}</button></li>)}</ul>
        {list.hasNextPage && <button disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? "Loading chats…" : "Load more chats"}</button>}
      </section>
      <section className="codex-detail" aria-label="Selected Codex chat">
        {!selected ? <><h2>Select a chat</h2><p>Open a chat to inspect its task requests, agent updates, and child agents.</p></> : <>
          <QueryFeedback error={detail.error} loading={detail.isPending} retry={() => void detail.refetch()} />
          {current && <><div className="codex-detail-heading"><h2>{current.chat.title || "Untitled chat"}</h2><a className="button" href={`codex://threads/${encodeURIComponent(current.chat.id)}`}>Open in Codex</a></div><ChatMetadata chat={current.chat} />
            {current.chat.cwd && <p className="metadata break-word">{current.chat.cwd}</p>}
            {current.chat.parentId && <button onClick={() => select(current.chat.parentId)}>Open parent chat</button>}
            <h3>Child agents</h3>{agents.length ? <ul className="codex-agent-list">{agents.map(agent => <li key={agent.id}><button onClick={() => select(agent.id)}>{agent.agentNickname || agent.title || "Unnamed agent"}</button><ChatMetadata chat={agent} /></li>)}</ul> : <p className="metadata">No child agents were recorded for this chat.</p>}
            <h3>Tasks and progress</h3><p className="metadata">These are recorded Codex turns. A finished turn is separate from human acceptance on the AgentFlow board.</p>
            {turns.length ? turns.map(turn => <Turn key={turn.id} turn={turn} />) : <p>No task turns were recorded for this chat.</p>}
            {detail.hasNextPage && <button disabled={detail.isFetchingNextPage} onClick={() => void detail.fetchNextPage()}>{detail.isFetchingNextPage ? "Loading observations…" : "Load more tasks and agents"}</button>}
          </>}
        </>}
      </section>
    </div>
  </>;
}
export function CodexLink() {
  return <p className="codex-discovery"><Link href="/codex">View your Codex chats, tasks, and child agents</Link><span> Automatically discovered from Codex on this machine.</span></p>;
}
