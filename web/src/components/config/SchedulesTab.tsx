"use client";

import { useState } from "react";
import type { TaskDTO } from "@/lib/api";
import { endpoints } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card } from "@/components/ui/Card";
import cronstrue from "cronstrue";

function parseCron(expr: string): string {
  try {
    return cronstrue.toString(expr, { throwExceptionOnParseError: true });
  } catch {
    return "";
  }
}

export function SchedulesTab({
  tasks,
  tasksLoading,
  refreshTasks,
  setTasks,
  setError,
}: {
  tasks: TaskDTO[];
  tasksLoading: boolean;
  refreshTasks: () => void;
  setTasks: React.Dispatch<React.SetStateAction<TaskDTO[]>>;
  setError: (e: string | null) => void;
}) {
  const [newTask, setNewTask] = useState({
    description: "",
    prompt: "",
    executeAt: "",
    cronExpression: "",
  });
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newTask.prompt || !newTask.executeAt) return;
    setCreating(true);
    try {
      await endpoints.createTask({
        description: newTask.description || newTask.prompt.slice(0, 80),
        prompt: newTask.prompt,
        executeAt: newTask.executeAt,
        cronExpression: newTask.cronExpression || null,
      });
      setNewTask({ description: "", prompt: "", executeAt: "", cronExpression: "" });
      refreshTasks();
    } catch {
      setError("Failed to create task");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await endpoints.deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch {
      setError("Failed to delete task");
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const cronHint = parseCron(newTask.cronExpression);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Schedules"
        description="Scheduled tasks and cron jobs -- managed by the assistant or created manually"
        action={
          <Button variant="secondary" size="sm" onClick={refreshTasks} loading={tasksLoading}>
            Refresh
          </Button>
        }
      />

      {/* Create form */}
      <Card title="New Schedule">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Description (optional)"
              value={newTask.description}
              onChange={(e) => setNewTask((p) => ({ ...p, description: e.target.value }))}
            />
            <Input
              label="Execute At (one-shot)"
              value={newTask.executeAt}
              onChange={(e) => setNewTask((p) => ({ ...p, executeAt: e.target.value }))}
              placeholder="2026-04-20T09:00:00Z"
            />
            <div>
              <Input
                label="Cron Expression (optional)"
                value={newTask.cronExpression}
                onChange={(e) => setNewTask((p) => ({ ...p, cronExpression: e.target.value }))}
                placeholder="0 9 * * 1-5"
              />
              {cronHint && <p className="mt-1 text-xs text-cyan/80">{cronHint}</p>}
            </div>
          </div>
          <TextArea
            label="Prompt"
            value={newTask.prompt}
            onChange={(e) => setNewTask((p) => ({ ...p, prompt: e.target.value }))}
            rows={2}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={handleCreate}
            loading={creating}
            disabled={!newTask.prompt || !newTask.executeAt}
          >
            Create Schedule
          </Button>
        </div>
      </Card>

      {/* Existing tasks */}
      <div className="space-y-2">
        {tasks.map((task) => {
          const cronDesc = task.cronExpression ? parseCron(task.cronExpression) : null;
          const statusColor =
            task.status === "PENDING"
              ? "text-cyan"
              : task.status === "FAILED"
                ? "text-error"
                : "text-on-surface-variant";
          return (
            <div
              key={task.id}
              className="rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm px-4 py-3 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-on-surface truncate">
                    {task.description || task.prompt.slice(0, 60)}
                  </span>
                  <span className={`text-xs font-mono ${statusColor}`}>{task.status}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-on-surface-variant">
                  <span>{formatDate(task.executeAt)}</span>
                  {task.cronExpression && (
                    <span>
                      <code className="font-mono text-cyan">{task.cronExpression}</code>
                      {cronDesc && (
                        <span className="ml-1 text-on-surface-variant/70">-- {cronDesc}</span>
                      )}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(task.id)}
                className="text-xs text-on-surface-variant/50 hover:text-error transition-colors shrink-0"
                title="Delete task"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      {tasks.length === 0 && !tasksLoading && (
        <p className="text-on-surface-variant text-sm">
          No scheduled tasks. The assistant can create them, or use the form above.
        </p>
      )}
    </div>
  );
}
