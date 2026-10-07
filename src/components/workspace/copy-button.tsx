"use client";

import { useEffect, useRef, useState } from "react";
import { responseCopy } from "@/config/workspace";
import { cn } from "@/lib/utils";
import { CheckIcon, CopyIcon } from "./icons";

export type CopyButtonProps = {
  /** The exact text the button places on the clipboard. */
  readonly text: string;
  readonly label?: string | undefined;
  readonly copiedLabel?: string | undefined;
  readonly className?: string | undefined;
};

const COPIED_DELAY_MS = 2000;

/**
 * Copies `text` to the clipboard and confirms briefly.
 *
 * The confirmation resets its timer on repeat clicks and is
 * cleared on unmount, so a button can never stay stuck in its
 * "Copied" state. When the async clipboard API is unavailable —
 * older engines, non-secure contexts — a hidden textarea and
 * `execCommand` carry the copy instead, and a failure leaves
 * the button unchanged rather than claiming success.
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const succeeded = await copyText(text);
    if (!succeeded) return;
    setCopied(true);
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setCopied(false), COPIED_DELAY_MS);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-ink-subtle transition-colors hover:bg-hover hover:text-ink-muted active:bg-active",
        className,
      )}
    >
      {copied ? (
        <CheckIcon className="size-3" />
      ) : (
        <CopyIcon className="size-3" />
      )}
      {copied ? (copiedLabel ?? responseCopy.copied) : (label ?? responseCopy.copyCode)}
    </button>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard != null) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the synchronous fallback below.
  }

  try {
    if (typeof document === "undefined") return false;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
