"use client";

import { useState } from "react";
import { useAgent } from "@/lib/agent/use-agent";
import { CodingPanel } from "./coding-panel";
import { InstallPrompt } from "./install-prompt";

export function CodingTab() {
  const [showCoding, setShowCoding] = useState(false);
  const { agent, status, connected } = useAgent();

  if (!showCoding) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => setShowCoding(true)}
          className="flex flex-col items-center gap-2 rounded-lg border border-line bg-surface-raised px-6 py-4 hover:bg-hover"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-6 text-ink-muted"
            aria-hidden="true"
          >
            <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
          </svg>
          <span className="text-sm font-medium text-ink">Open coding agent</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-sm font-medium text-ink">ORVYN coding</span>
        <button
          type="button"
          onClick={() => setShowCoding(false)}
          className="text-xs text-ink-muted hover:text-ink"
        >
          Close
        </button>
      </div>

      {status === "available" && connected ? (
        <CodingPanel agent={agent} />
      ) : (
        <InstallPrompt />
      )}
    </div>
  );
}
