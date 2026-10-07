"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  detectLocalRoot,
  persistProjectRoot,
  projectLabel,
  type ProjectContext,
} from "@/lib/agent/project-context";

export type ProjectSelectorProps = {
  readonly value: ProjectContext;
  readonly onChange: (next: ProjectContext) => void;
};

/**
 * The project root a Code mission runs against.
 *
 * The header shows the current root's basename; clicking it opens a
 * small inline editor where the user can type a path, accept the
 * detected local root, or clear it. Nothing here invents a project
 * list — the only roots on offer are the one the user types and the
 * one the browser can detect from its own origin.
 */
export function ProjectSelector({ value, onChange }: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  // The input is uncontrolled and re-mounts whenever the
  // dialog opens, seeded from the committed value via its `key`.
  // An uncontrolled input owns its text: typing, backspacing,
  // selecting and replacing all work, and nothing in render can
  // overwrite a keystroke. The value is read from the ref when
  // the user commits.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const commit = (root: string | null) => {
    onChange({ root, resolved: true });
    persistProjectRoot(root);
    setOpen(false);
  };

  const commitDraft = () => {
    const current = inputRef.current?.value ?? "";
    commit(current === "" ? null : current);
  };

  const detect = () => {
    const detected = detectLocalRoot();
    if (detected !== null && inputRef.current) {
      inputRef.current.value = detected;
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex max-w-[220px] items-center gap-1.5 rounded-md px-2 py-1 text-xs",
          "text-ink-subtle transition-colors duration-150 hover:bg-hover hover:text-ink",
        )}
        title={value.root ?? "No project selected"}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3.5 shrink-0"
          aria-hidden="true"
        >
          <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
          <path d="M5 7h14l-.5 12a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1L5 7Z" />
          <path d="M9 11v5M15 11v5" />
        </svg>
        <span className="truncate">{projectLabel(value.root)}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Project root"
          className={cn(
            "absolute right-0 top-full z-50 mt-1 w-[280px] rounded-md border border-line",
            "bg-surface-raised p-3 shadow-lg",
          )}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          <p className="mb-1.5 text-xs font-medium text-ink">Project root</p>
          <input
            // The key carries the committed value, so reopening
            // the dialog re-mounts the input seeded with it.
            key={open ? (value.root ?? "") : "closed"}
            ref={inputRef}
            type="text"
            defaultValue={value.root ?? ""}
            placeholder="/path/to/repository"
            className={cn(
              "w-full rounded-md border border-line bg-surface-inset px-2 py-1.5 text-xs",
              "text-ink placeholder:text-ink-muted",
              "focus:outline-none focus:ring-2 focus:ring-accent",
            )}
          />
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={detect}
              className="text-xs text-ink-muted hover:text-ink"
            >
              Use detected
            </button>
            <button
              type="button"
              onClick={() => commit(null)}
              className="text-xs text-ink-muted hover:text-ink"
            >
              Clear
            </button>
          </div>
          <div className="mt-3 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs",
                "text-ink-muted hover:bg-hover hover:text-ink",
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commitDraft}
              className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-canvas hover:bg-ink/88"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}