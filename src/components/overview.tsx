"use client";
import Link from "next/link";
import { useState } from "react";
import { useRead, QueryFeedback, useWorkspace } from "../client/provider";
import { overviewResponse } from "../contracts/responses";
export function Overview() {
  const query = useRead("/overview?limit=50", overviewResponse, 15000);
  const data = query.data?.data;
  const { api } = useWorkspace();
  const [extra, setExtra] = useState<
      NonNullable<typeof data>["attention"]["items"]
    >([]),
    [next, setNext] = useState<string | null | undefined>(),
    [error, setError] = useState("");
  const items = [...(data?.attention.items ?? []), ...extra].filter(
    (item, index, all) =>
      all.findIndex((value) => value.id === item.id) === index,
  );
  async function more() {
    const cursor = next === undefined ? data?.attention.nextCursor : next;
    if (!cursor) return;
    try {
      const result = await api.read(
        `/overview?limit=50&cursor=${encodeURIComponent(cursor)}`,
        overviewResponse,
      );
      setExtra((old) => [...old, ...result.data.attention.items]);
      setNext(result.data.attention.nextCursor);
      setError("");
    } catch {
      setError("Could not load more attention items. Retry this page.");
    }
  }
  return (
    <>
      <h1>Overview</h1>
      <p className="intro">Your work, and what needs a closer look.</p>
      <QueryFeedback
        error={query.error}
        loading={query.isPending}
        retry={() => void query.refetch()}
      />
      {data && (
        <>
          <dl className="metrics">
            {(
              [
                ["Active projects", data.metrics.activeProjects],
                ["Reporting agents", data.metrics.reportingAgents],
                ["Completed today", data.metrics.completedToday],
                ["Awaiting review", data.metrics.awaitingReview],
                ["Failed runs today", data.metrics.failedRunsToday],
              ] as const
            ).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="metadata">
            Today uses {data.timezone}. Reporting agents have a running report
            received within 60 seconds.
          </p>
          <section className="attention">
            <h2>
              Needs attention{" "}
              <span className="count">{data.attention.total}</span>
            </h2>
            {items.length ? (
              items.map((item) => (
                <div className="attention-row" key={item.id}>
                  <Link
                    href={
                      item.taskId
                        ? `/projects/${item.projectId}/tasks/${item.taskId}`
                        : `/projects/${item.projectId}`
                    }
                  >
                    {item.title}
                  </Link>
                  <span>{item.reasons.join(", ")}</span>
                </div>
              ))
            ) : (
              <p>
                No blocked tasks, failed runs, or stale reports need attention.
              </p>
            )}
            <p role="alert" className="error">
              {error}
            </p>
            {(next === undefined ? data.attention.nextCursor : next) && (
              <button onClick={() => void more()}>
                Load more attention items
              </button>
            )}
          </section>
          <Link className="button primary" href="/projects">
            Open projects
          </Link>
        </>
      )}
    </>
  );
}
