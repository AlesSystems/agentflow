"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useWorkspace, QueryFeedback } from "../client/provider";
import { ApiError } from "../client/api";
import { connectorListResponse, connectorDetailResponse, connectorId, type ConnectorSource, type ConnectorChat, type ConnectorConnection, type ConnectorTurn } from "../contracts/connectors";

function firstById<T extends {id: string}>(items: T[]) {
  const found = new Map<string, T>();
  for (const item of items) if (!found.has(item.id)) found.set(item.id, item);
  return [...found.values()];
}
function time(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Time unavailable";
}

type Descriptor = {
  name: string; intro: string; refresh: string; connected: string; stale: string; unavailable: string; connecting: string;
  base: string; unit: string; units: string; Units: string; sectionLabel: string; selectedLabel: string; untitled: string;
  emptyUnavailable: string; emptyNone: string; unknownChecklist: string; turnsNote: string; footer: string;
  noAgents: string; noTurns: string; childMarker: string; openParent: string; selectTitle: string; selectBody: string;
  agentsOption: string; allOption: string; agentsHeading: string; allHeading: string; searchLabel: string; kindHeading: string;
  loadMore: string; loading: string; statusLabel: (s: string) => string;
  deepLink?: (id: string) => string; deepLinkLabel?: string; capabilities: { archive: boolean };
};
const descriptors: Record<ConnectorSource, Descriptor> = {
  codex: {
    name: "Codex", intro: "Your existing chats, agent tasks, and recorded progress.", refresh: "Refresh Codex",
    connected: "Codex connected", stale: "Codex unavailable. Showing the last observations.", unavailable: "Codex connection unavailable", connecting: "Connecting to Codex…",
    base: "/connections/codex", unit: "chat", units: "chats", Units: "Chats", sectionLabel: "Codex chats", selectedLabel: "Selected Codex chat", untitled: "Untitled chat",
    emptyUnavailable: "Open Codex on this machine, then refresh to reconnect.", emptyNone: "No chats match this view. Try another search or the archived view.",
    unknownChecklist: "Checklist progress is unknown. Codex has no explicit checklist for this turn.",
    turnsNote: "These are recorded Codex turns. A finished turn is separate from human acceptance on the AgentFlow board.",
    footer: "Automatically refreshed every 5 seconds while this page is visible. Stored observations describe recorded work; they do not confirm an agent is running now. AgentFlow observes Codex and never starts or changes its work.",
    noAgents: "No child agents were recorded for this chat.", noTurns: "No task turns were recorded for this chat.", childMarker: "Child agent chat", openParent: "Open parent chat",
    selectTitle: "Select a chat", selectBody: "Open a chat to inspect its task requests, agent updates, and child agents.",
    agentsOption: "Child agents", allOption: "All chats and agents", agentsHeading: "Agents", allHeading: "Chats and agents", searchLabel: "Search chats", kindHeading: "Chats",
    loadMore: "Load more chats", loading: "Loading chats…", statusLabel: s => s,
    deepLink: id => `codex://threads/${encodeURIComponent(id)}`, deepLinkLabel: "Open in Codex", capabilities: { archive: true },
  },
  claude: {
    name: "Claude Code", intro: "Your existing Claude Code sessions, agent tasks, and recorded progress.", refresh: "Refresh Claude",
    connected: "Claude connected", stale: "Claude unavailable. Showing the last observations.", unavailable: "Claude connection unavailable", connecting: "Connecting to Claude…",
    base: "/connections/claude", unit: "session", units: "sessions", Units: "Sessions", sectionLabel: "Claude sessions", selectedLabel: "Selected Claude session", untitled: "Untitled session",
    emptyUnavailable: "Run Claude Code on this machine, then refresh to reconnect.", emptyNone: "No sessions match this view. Try another search.",
    unknownChecklist: "Checklist progress is unknown. Claude recorded no task list for this turn.",
    turnsNote: "These are recorded Claude Code turns. A finished turn is separate from human acceptance on the AgentFlow board.",
    footer: "Automatically refreshed every 5 seconds while this page is visible. Stored observations describe recorded work; they do not confirm an agent is running now. AgentFlow observes Claude Code and never starts or changes its work.",
    noAgents: "No child agents were recorded for this session.", noTurns: "No task turns were recorded for this session.", childMarker: "Child agent session", openParent: "Open parent session",
    selectTitle: "Select a session", selectBody: "Open a session to inspect its task requests, agent updates, and child agents.",
    agentsOption: "Child agents", allOption: "All sessions and agents", agentsHeading: "Agents", allHeading: "Sessions and agents", searchLabel: "Search sessions", kindHeading: "Sessions",
    loadMore: "Load more sessions", loading: "Loading sessions…", statusLabel: s => s === "inProgress" ? "in progress" : s,
    capabilities: { archive: false },
  },
};
function Connection({ data, d }: { data?: ConnectorConnection; d: Descriptor }) {
  return <p className={data?.state === "stale" || data?.state === "unavailable" ? "notice connector-connection" : "metadata connector-connection"} role="status">
    {data?.state === "connected" ? d.connected : data?.state === "stale" ? d.stale : data?.state === "unavailable" ? d.unavailable : d.connecting}
    {data?.observedAt && <> · Observed {time(data.observedAt)}</>}
    {data?.message && <>. {data.message}</>}
  </p>;
}
function ChatMetadata({ chat, d }: { chat: ConnectorChat; d: Descriptor }) {
  return <span className="metadata connector-chat-meta">{chat.statusSource === "stored" ? "Stored observation" : "Live observation"} · {d.statusLabel(chat.status)}
    {chat.agentNickname && <> · {chat.agentNickname}</>}{chat.agentRole && <> · {chat.agentRole}</>}{chat.model && <> · {chat.model}</>}
    {chat.updatedAt && <> · {time(chat.updatedAt)}</>}
  </span>;
}
function Turn({ turn, d }: { turn: ConnectorTurn; d: Descriptor }) {
  return <article className="connector-turn">
    <div className="connector-turn-heading"><h3>{turn.request ? "Task request" : "Recorded turn"}</h3><span className="report-label">{d.statusLabel(turn.status)}</span></div>
    {turn.request ? <p className="connector-text">{turn.request}</p> : <p className="metadata">No task request was recorded for this turn.</p>}
    <p className="metadata">Started {time(turn.startedAt)}{turn.completedAt && <> · Finished {time(turn.completedAt)}</>}</p>
    {turn.tasks.length > 0 ? <><h4>Reported checklist</h4><ol className="connector-checklist">{turn.tasks.map((task, i) => <li key={i}><span>{task.text}</span><span className="report-label">{task.status.replaceAll("_", " ")}</span></li>)}</ol>
      {turn.progress && <p>{turn.progress.completed} of {turn.progress.total} checklist steps completed ({turn.progress.percent}%).</p>}</> : <p className="metadata">{d.unknownChecklist}</p>}
    {turn.planText && <details><summary>Recorded plan</summary><p className="connector-text">{turn.planText}</p></details>}
    {turn.latestMessage && <details open><summary>Latest agent update</summary><p className="connector-text">{turn.latestMessage}</p></details>}
  </article>;
}
export function ConnectorHistory({source, initialSelected}: {source: ConnectorSource; initialSelected?: string | null}) {
  const d = descriptors[source];
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
    queryKey: [generation, source, "list", search, archived, kind],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "30", archived: String(archived), kind });
      if (search) params.set("search", search); if (pageParam) params.set("cursor", pageParam);
      return api.read(`${d.base}?${params}`, connectorListResponse);
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    refetchInterval: visible ? 5000 : false,
    refetchIntervalInBackground: false,
  });
  const detail = useInfiniteQuery({
    queryKey: [generation, source, "detail", selected],
    enabled: !!selected,
    initialPageParam: {} as { turnsCursor?: string; agentsCursor?: string; turnsDone?: boolean; agentsDone?: boolean },
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam.turnsCursor) params.set("turnsCursor", pageParam.turnsCursor);
      if (pageParam.agentsCursor) params.set("agentsCursor", pageParam.agentsCursor);
      return api.read(`${d.base}/${encodeURIComponent(selected!)}${params.size ? `?${params}` : ""}`, connectorDetailResponse);
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
    <div className="connector-page-heading"><div><h1>{d.name}</h1><p className="intro">{d.intro}</p></div><button disabled={list.isFetching || detail.isFetching} onClick={() => { void list.refetch(); if (selected) void detail.refetch(); }}>{d.refresh}</button></div>
    <Connection d={d} data={selected ? detail.data?.pages[0]?.connection ?? list.data?.pages[0]?.connection : list.data?.pages[0]?.connection} />
    <p className="metadata">{d.footer}</p>
    <div className="connector-workspace">
      <section className="connector-chats" aria-label={d.sectionLabel}>
        <h2>{kind === "agents" ? d.agentsHeading : kind === "all" ? d.allHeading : d.kindHeading}</h2><label className="connector-kind">Show<select value={kind} onChange={e => setKind(e.target.value as "chats" | "agents" | "all")}><option value="chats">{d.kindHeading}</option><option value="agents">{d.agentsOption}</option><option value="all">{d.allOption}</option></select></label><form className="connector-filters" onSubmit={e => { e.preventDefault(); setSearch(String(new FormData(e.currentTarget).get("search") ?? "")); }}><label>{d.searchLabel}<input name="search" type="search" maxLength={200} placeholder="Search by title" /></label><button>Search</button>{d.capabilities.archive && <label className="checkbox-label"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Show archived chats</label>}</form>
        <QueryFeedback error={list.error} loading={list.isPending} retry={() => void list.refetch()} />
        {!list.isPending && !list.error && chats.length === 0 && <p>{list.data?.pages[0]?.connection.state === "unavailable" ? d.emptyUnavailable : d.emptyNone}</p>}
        <ul className="connector-chat-list">{chats.map(chat => <li key={chat.id}><button className="connector-chat-button" aria-current={selected === chat.id ? "true" : undefined} onClick={() => select(chat.id)}><strong>{chat.title || d.untitled}</strong><ChatMetadata d={d} chat={chat} />{chat.cwd && <span className="metadata break-word">{chat.cwd}</span>}{chat.parentId && <span className="metadata">{d.childMarker}</span>}</button></li>)}</ul>
        {list.hasNextPage && <button disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? d.loading : d.loadMore}</button>}
      </section>
      <section className="connector-detail" aria-label={d.selectedLabel}>
        {!selected ? <><h2>{d.selectTitle}</h2><p>{d.selectBody}</p></> : <>
          <QueryFeedback error={detail.error} loading={detail.isPending} retry={() => void detail.refetch()} />
          {current && <><div className="connector-detail-heading"><h2>{current.chat.title || d.untitled}</h2>{d.deepLink && <a className="button" href={d.deepLink(current.chat.id)}>{d.deepLinkLabel}</a>}</div><ChatMetadata d={d} chat={current.chat} />
            {current.chat.cwd && <p className="metadata break-word">{current.chat.cwd}</p>}
            {current.chat.parentId && <button onClick={() => select(current.chat.parentId)}>{d.openParent}</button>}
            <h3>Child agents</h3>{agents.length ? <ul className="connector-agent-list">{agents.map(agent => <li key={agent.id}><button onClick={() => select(agent.id)}>{agent.agentNickname || agent.title || "Unnamed agent"}</button><ChatMetadata d={d} chat={agent} /></li>)}</ul> : <p className="metadata">{d.noAgents}</p>}
            <h3>Tasks and progress</h3><p className="metadata">{d.turnsNote}</p>
            {turns.length ? turns.map(turn => <Turn key={turn.id} d={d} turn={turn} />) : <p>{d.noTurns}</p>}
            {detail.hasNextPage && <button disabled={detail.isFetchingNextPage} onClick={() => void detail.fetchNextPage()}>{detail.isFetchingNextPage ? "Loading observations…" : "Load more tasks and agents"}</button>}
          </>}
        </>}
      </section>
    </div>
  </>;
}
export function ConnectorLinks() {
  return <>
    <p className="connector-discovery"><Link href="/codex">View your Codex chats, tasks, and child agents</Link><span> Automatically discovered from Codex on this machine.</span></p>
    <p className="connector-discovery"><Link href="/claude">View your Claude Code sessions, tasks, and subagents</Link><span> Automatically discovered from Claude Code on this machine.</span></p>
  </>;
}
