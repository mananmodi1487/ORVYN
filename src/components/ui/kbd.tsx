import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type KbdProps = HTMLAttributes<HTMLElement>;

export function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line",
        "bg-surface-raised px-1.5 font-mono text-[11px] leading-none text-ink-subtle",
        className,
      )}
      {...props}
    />
  );
}
