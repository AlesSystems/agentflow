"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TaskDetail } from "./detail";
import { useRead } from "../../client/provider";
import { projectResponse } from "../../contracts/responses";
import { Modal } from "../ui/dialog";
export function TaskPage({
  projectId,
  taskId,
  boardSearch = "",
}: {
  projectId: string;
  taskId: string;
  boardSearch?: string;
}) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [taskId]);
  const project = useRead(`/projects/${projectId}`, projectResponse);
  const [dirty, setDirty] = useState(false),
    [confirm, setConfirm] = useState(false);
  const onDirty = useCallback((value: boolean) => setDirty(value), []);
  const back = () => router.push(`/projects/${projectId}${boardSearch}`);
  return (
    <>
      <button onClick={() => (dirty ? setConfirm(true) : back())}>
        Back to work board
      </button>
      <h1 ref={heading} tabIndex={-1}>
        Task details
      </h1>
      <div className="task-page">
        <TaskDetail
          id={taskId}
          archived={!!project.data?.data.archivedAt}
          onDirty={onDirty}
        />
      </div>
      <Modal
        title="Keep your draft?"
        open={confirm}
        onClose={() => setConfirm(false)}
      >
        <p>Stay to keep editing, or discard unsaved changes.</p>
        <button onClick={() => setConfirm(false)}>Stay</button>
        <button onClick={back}>Discard and leave</button>
      </Modal>
    </>
  );
}
