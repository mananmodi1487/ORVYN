"use client";

import { cn } from "@/lib/utils";
import { getResponseMode, responseModeOrder, type ResponseMode } from "@/config/workspace";

export type ModeSegmentedProps = {
  mode: ResponseMode;
  onChange: (mode: ResponseMode) => void;
  className?: string | undefined;
};

export function ModeSegmented({ mode, onChange, className }: ModeSegmentedProps) {
  return (
    <fieldset
      className={cn(
        "flex items-center gap-0.5 rounded-md border border-line bg-surface-inset p-0.5",
        className,
      )}
    >
      <legend className="sr-only">Response mode</legend>
      {responseModeOrder.map((id) => (
        <label key={id} className="relative cursor-pointer">
          <input
            type="radio"
            name="orvyn-response-mode"
            value={id}
            checked={mode === id}
            onChange={() => onChange(id)}
            className="peer sr-only"
          />
          <span
            className={cn(
              "flex h-7 cursor-pointer items-center rounded-[5px] px-2.5 text-xs font-medium",
              "text-ink-subtle transition-colors duration-150",
              "peer-checked:bg-ink peer-checked:text-canvas",
              "peer-focus-visible:outline peer-focus-visible:outline-2",
              "peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
            )}
          >
            {getResponseMode(id).label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}