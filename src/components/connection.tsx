"use client";
import { useWorkspace } from "../client/provider";
import { useQueryClient } from "@tanstack/react-query";
const labels = { connecting: "Connecting updates", connected: "Connected updates", polling: "Polling for updates", recovering: "Reconnecting", "authentication-required": "Pair again" };
export function ConnectionStatus() {
  const { connection, pair } = useWorkspace();
  const cache = useQueryClient();
  return <aside className={`connection connection-${connection.state}`} aria-label="Browser update connection">
    <p role="status">{labels[connection.state]}</p>
    {connection.lastSuccess && <p className="metadata">Last fetched <time dateTime={new Date(connection.lastSuccess).toISOString()}>{new Date(connection.lastSuccess).toLocaleTimeString()}</time></p>}
    {connection.state !== "connected" && <><p className="metadata">Last-known data may be outdated.</p><button onClick={() => connection.state === "authentication-required" ? pair() : void cache.invalidateQueries()}> {connection.state === "authentication-required" ? "Pair this browser" : "Retry refresh"}</button></>}
  </aside>;
}
