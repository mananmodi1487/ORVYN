"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAgentMission } from "@/lib/agent/use-agent-mission";
import { useMissionHistory } from "@/lib/agent/use-mission-history";
import { useProjectContext } from "@/lib/hooks/use-project-context";
import type { AgentBridge } from "@/lib/agent/bridge";
import type { AgentEvent } from "@/lib/agent/protocol";
import { MissionStatus } from "./mission-status";
import { ProjectSelector } from "./project-selector";

export function CodingPanel({ agent }: { readonly agent: AgentBridge }) {
  const { root, resolved, setRoot } = useProjectContext();
  const {
    status,
    events,
    error,
    activeMissionId,
    start,
    cancel,
    reset,
  } = useAgentMission(agent);
  const {
    recordMission,
    finishMission,
  } = useMissionHistory();
  const [prompt, setPrompt] = useState("");
  // The id of the mission currently being recorded. The hook
  // clears its own `activeMissionId` in `finally` before this
  // effect can run, so this ref is what the finish effect reads.
  const recordedMissionIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (status === "done" || status === "error") {
      inputRef.current?.focus();
    }
  }, [status]);

  // Records the mission the moment it starts. A new mission
  // re-runs this and records its own entry; the history is
  // local state only, with no UI reading it yet.
  useEffect(() => {
    if (activeMissionId === null) return;
    recordedMissionIdRef.current = activeMissionId;
    recordMission({
      id: activeMissionId,
      prompt,
      projectRoot: root,
    });
    // Intentionally keyed on the active mission id: a new
    // mission re-runs this and records its own entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMissionId]);

  // Marks the recorded mission finished when the stream ends,
  // on success, cancellation, or error.
  useEffect(() => {
    const id = recordedMissionIdRef.current;
    if (id === null) return;
    if (status === "idle" || status === "starting") return;

    const terminalStatus =
      status === "done"
        ? "done"
        : status === "cancelling"
          ? "cancelled"
          : "error";
    finishMission(id, terminalStatus, events.length);
    recordedMissionIdRef.current = null;
  }, [status, events.length, finishMission]);

  const handleSend = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    start(trimmed, root ?? undefined);
    setPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
  };

  const isStreaming = status === "starting" || status === "running";

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-ink">ORVYN Code</span>
          <MissionStatus status={status} />
        </div>
        <div className="flex items-center gap-3">
          {resolved && <ProjectSelector value={{ root, resolved }} onChange={(next) => setRoot(next.root)} />}
          {isStreaming && (
            <button
              type="button"
              onClick={cancel}
              className="text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {events.length === 0 ? (
          <p className="text-sm text-ink-subtle">
            Describe a coding task and ORVYN will work on it locally.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {events.map((event, index) => (
              <EventCard key={index} event={event} />
            ))}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-line bg-surface-raised px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-canvas px-4 py-3">
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          placeholder="Describe a coding task..."
          rows={2}
          className={cn(
            "w-full resize-none rounded-md border border-line bg-surface-inset px-3 py-2 text-sm",
            "text-ink placeholder:text-ink-muted",
            "focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-canvas",
            "disabled:opacity-50",
          )}
        />
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={reset}
            className="text-xs text-ink-muted hover:text-ink"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={isStreaming || !prompt.trim()}
            className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-canvas hover:bg-ink/88 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function EventCard({ event }: { readonly event: AgentEvent }) {
  switch (event.t) {
    case "status":
      return null;
    case "tool":
      return (
        <div className="rounded-md border border-line bg-surface-raised px-3 py-2">
          <span className="text-xs font-medium text-ink">Tool:</span>{" "}
          <span className="text-xs text-ink-muted">{event.name}</span>
          <pre className="mt-1 max-h-40 overflow-y-auto text-xs text-ink-subtle whitespace-pre-wrap">
            {JSON.stringify(event.args, null, 2)}
          </pre>
        </div>
      );
    case "result":
      return (
        <div className="rounded-md border border-line bg-surface-raised px-3 py-2">
          <span className="text-xs font-medium text-ink">Result:</span>
          <pre className="mt-1 max-h-40 overflow-y-auto text-xs text-ink-subtle whitespace-pre-wrap">
            {event.output}
          </pre>
        </div>
      );
    case "diff":
      return (
        <div className="rounded-md border border-line bg-surface-raised px-3 py-2">
          <span className="text-xs font-medium text-ink">Diff:</span>{" "}
          <span className="text-xs text-ink-muted">{event.file}</span>
          <pre className="mt-1 max-h-40 overflow-y-auto text-xs text-ink-subtle whitespace-pre-wrap">
            {event.patch}
          </pre>
        </div>
      );
    case "terminal":
      return (
        <div className="rounded-md border border-line bg-surface-raised px-3 py-2">
          <span className="text-xs font-medium text-ink">Terminal:</span>{" "}
          <span className="text-xs text-ink-muted">{event.cmd}</span>
          <pre className="mt-1 max-h-40 overflow-y-auto text-xs text-ink-subtle whitespace-pre-wrap">
            {event.output}
          </pre>
        </div>
      );
    case "error":
      return (
        <div className="rounded-md border border-line bg-surface-raised px-3 py-2">
          <span className="text-xs font-medium text-danger">
            Error ({event.code}):
          </span>{" "}
          <span className="text-xs text-ink-subtle">{event.message}</span>
        </div>
      );
    case "done":
      return (
        <div className="rounded-md border border-line bg-surface-raised px-3 py-2">
          <span className="text-xs font-medium text-ink">Done:</span>{" "}
          <span className="text-xs text-ink-subtle">
            {event.summary.filesChanged} file(s) changed,{" "}
            {event.summary.testsRun} test(s) run
          </span>
        </div>
      );
    default:
      return null;
  }
}
