"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui";
import { getResponseMode, responseModeOrder, type ResponseMode } from "@/config/workspace";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon } from "./icons";

const MENU_ITEM_SELECTOR = '[role="menuitemradio"]';

export type ComposerModeMenuProps = {
  mode: ResponseMode;
  onChange: (mode: ResponseMode) => void;
};

export function ComposerModeMenu({ mode, onChange }: ComposerModeMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const active = getResponseMode(mode);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const items = containerRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR);
    items?.[0]?.focus();
  }, [open]);

  const closeAndRefocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRefocus();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();
    const items = Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR) ?? [],
    );
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + offset + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Response mode: ${active.label}`}
        className="text-ink-muted"
      >
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", open ? "bg-ink" : "bg-ink-subtle")}
        />
        {active.label}
        <ChevronDownIcon
          className={cn("size-3 transition-transform duration-150", open && "rotate-180")}
        />
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label="Response mode"
          onKeyDown={onMenuKeyDown}
          className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-lg border border-line bg-surface-raised p-1 shadow-xl shadow-black/60"
        >
          {responseModeOrder.map((id) => {
            const option = getResponseMode(id);
            const selected = id === mode;

            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={-1}
                onClick={() => {
                  onChange(id);
                  closeAndRefocus();
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left",
                  "transition-colors duration-150 hover:bg-hover",
                  selected && "bg-active",
                )}
              >
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center text-ink">
                  {selected ? <CheckIcon className="size-3.5" /> : null}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] text-ink">{option.label}</span>
                  <span className="text-[11px] leading-relaxed text-ink-subtle">{option.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}