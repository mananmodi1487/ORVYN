"use client";

export function InstallPrompt() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full border border-line bg-surface-raised">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-8 text-ink-muted"
          aria-hidden="true"
        >
          <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
        </svg>
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium text-ink">Run the ORVYN agent</h2>
        <p className="max-w-sm text-sm text-ink-subtle">
          The coding agent runs on your machine as part of the ORVYN
          repository. It runs locally and never sends your code to a
          remote server without your permission.
        </p>
      </div>

      <div className="rounded-md border border-line bg-surface-inset px-4 py-3">
        <code className="text-xs text-ink-muted">
          npx tsx packages/agent-cli/bin/orvyn-agent.ts serve
        </code>
      </div>

      <p className="text-xs text-ink-subtle">
        Run from the ORVYN repository root. Requires Node.js 20.9 or later.
      </p>
    </div>
  );
}
