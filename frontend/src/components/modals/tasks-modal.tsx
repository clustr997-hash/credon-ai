"use client";

import { useEffect, useState } from "react";
import { loadTasks, saveTasks, type Task } from "@/lib/slash";
import { IconCheck, IconPlus, IconTrash, IconX } from "@/components/chat/icons";

export function TasksModal({
  open,
  onClose,
  onNotify,
}: {
  open: boolean;
  onClose: () => void;
  onNotify: (msg: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (open) setTasks(loadTasks());
  }, [open]);

  if (!open) return null;

  function persist(next: Task[]) {
    setTasks(next);
    saveTasks(next);
  }

  const done = tasks.filter((t) => t.done).length;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <div className="anim-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="modal-content anim-scale-in relative flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-t-2xl border shadow-2xl sm:max-w-md sm:rounded-2xl"
        style={{ borderColor: "var(--border-strong)", background: "var(--surface)", boxShadow: "var(--shadow-pop)" }}
      >
        <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-[15.5px] font-semibold tracking-tight">Tasks</h2>
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--text-dim)" }}>
              {tasks.length === 0 ? "Nothing yet — /todo or save from answers" : `${done}/${tasks.length} done`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.05]" style={{ color: "var(--text-dim)" }}>
            <IconX size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) {
                  persist([{ id: `t-${Date.now().toString(36)}`, text: draft.trim(), done: false, created: Date.now() }, ...tasks]);
                  setDraft("");
                }
              }}
              placeholder="Add a task…"
              className="h-10 min-w-0 flex-1 rounded-xl border px-3.5 text-[13.5px] outline-none placeholder:text-[var(--text-faint)]"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
            />
            <button
              onClick={() => {
                if (draft.trim()) {
                  persist([{ id: `t-${Date.now().toString(36)}`, text: draft.trim(), done: false, created: Date.now() }, ...tasks]);
                  setDraft("");
                }
              }}
              aria-label="Add task"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
              style={{ background: "var(--accent)" }}
            >
              <IconPlus size={16} />
            </button>
          </div>

          {tasks.length === 0 && (
            <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--border-strong)", color: "var(--text-faint)" }}>
              <p className="text-[13.5px]">No tasks yet.</p>
              <p className="mt-1 text-[12.5px]">Type /todo in chat, or tap “Save as tasks” under any checklist answer.</p>
            </div>
          )}

          <ul className="space-y-1.5">
            {tasks.map((task) => (
              <li key={task.id} className="group/task flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
                <button
                  onClick={() => persist(tasks.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)))}
                  aria-label={task.done ? "Mark incomplete" : "Mark done"}
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-colors"
                  style={{
                    borderColor: task.done ? "var(--accent)" : "var(--border-strong)",
                    background: task.done ? "var(--accent)" : "transparent",
                    color: "#fff",
                  }}
                >
                  {task.done && <IconCheck size={11} />}
                </button>
                <span className="min-w-0 flex-1 text-[13.5px]" style={{ color: task.done ? "var(--text-faint)" : "var(--text)", textDecoration: task.done ? "line-through" : "none" }}>
                  {task.text}
                </span>
                <button
                  onClick={() => {
                    persist(tasks.filter((t) => t.id !== task.id));
                    onNotify("Task removed");
                  }}
                  aria-label="Delete task"
                  className="shrink-0 rounded-md p-1 opacity-0 transition-opacity hover:bg-white/[0.06] group-hover/task:opacity-100"
                  style={{ color: "var(--text-faint)" }}
                >
                  <IconTrash size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
