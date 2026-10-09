"use client";
// Dropdown patterns adapted from shadcn/ui, MIT, copyright shadcn.
import * as Menu from "@radix-ui/react-dropdown-menu";
import type { Task } from "../../contracts/tasks";
export const statuses = ["backlog","in_progress","review","completed"] as const;
export const statusLabel = {backlog:"Backlog",in_progress:"In progress",review:"Review",completed:"Completed"};
export function StatusMenu({task,disabled,onMove}:{task:Task;disabled?:boolean;onMove:(status:Task["status"])=>void}){return <Menu.Root><Menu.Trigger className="secondary" disabled={disabled}>Move task</Menu.Trigger><Menu.Portal><Menu.Content className="menu" sideOffset={6}>{statuses.map(status=><Menu.Item key={status} disabled={task.status==="completed"||status===task.status} onSelect={()=>onMove(status)}>{statusLabel[status]}</Menu.Item>)}</Menu.Content></Menu.Portal></Menu.Root>;}
