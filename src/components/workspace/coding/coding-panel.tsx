"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAgentMission } from "@/lib/agent/use-agent-mission";
import type { AgentBridge } from "@/lib/agent/bridge";
import type { AgentEvent } from "@/lib/agent/protocol";
import { MissionStatus } from "./mission-status";

export function CodingPanel({ agent }: { readonly agent: AgentBridge }) {
  const [prompt, setPrompt] = useState("");
  const { status, events, error, start, cancel, reset } = useAgentMission(agent);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (status === "done" || status === "error") {
      inputRef.current?.focus();
    }
  }, [status]);

  const handleSend = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    start(trimmed);
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
          <span className="text-sm font-medium text-ink">ORVYN coding</span>
          <MissionStatus status={status} />
        </div>
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
