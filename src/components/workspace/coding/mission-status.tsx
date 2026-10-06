"use client";

import { cn } from "@/lib/utils";
import type { MissionStatus } from "@/lib/agent/protocol";

export function MissionStatus({ status }: { readonly status: MissionStatus }) {
  const config = {
    idle: { label: "Idle", className: "text-ink-subtle" },
    starting: { label: "Starting...", className: "text-ink-muted" },
    running: { label: "Coding...", className: "text-accent" },
    cancelling: { label: "Cancelling...", className: "text-ink-muted" },
    done: { label: "Done", className: "text-ink-subtle" },
    error: { label: "Error", className: "text-danger" },
  }[status] ?? { label: status, className: "text-ink-subtle" };

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", config.className)}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "running" && "animate-pulse bg-accent",
          status === "error" && "bg-danger",
          status === "done" && "bg-ink-subtle",
          (status === "idle" || status === "starting" || status === "cancelling") &&
            "bg-ink-muted",
        )}
      />
      {config.label}
    </span>
  );
}
