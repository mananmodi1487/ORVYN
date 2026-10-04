"use client";

import {
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Button, Kbd } from "@/components/ui";
import type { ResponseMode } from "@/config/workspace";
import { cn } from "@/lib/utils";
import { ComposerModeMenu } from "./composer-mode-menu";
import { ArrowUpIcon, PaperclipIcon } from "./icons";

const MAX_TEXTAREA_HEIGHT = 200;
const COMPOSER_ID = "orvyn-composer";

const notices = {
  send: "Sending is not connected in this build — no model is wired up yet.",
  attach: "Attachments are not connected in this build.",
} as const;

export type MessageComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  mode: ResponseMode;
  onModeChange: (mode: ResponseMode) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

export function MessageComposer({
  value,
  onValueChange,
  mode,
  onModeChange,
  inputRef,
}: MessageComposerProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const canSend = value.trim().length > 0;

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [inputRef, value]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) return;
    setNotice(notices.send);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <form onSubmit={onSubmit} className="w-full" aria-label="Message ORVYN">
      <div className="rounded-2xl border border-line bg-surface-raised transition-colors duration-150 focus-within:border-line-strong">
        <label htmlFor={COMPOSER_ID} className="sr-only">
          Message ORVYN
        </label>
        <textarea
          id={COMPOSER_ID}
          ref={inputRef}
          rows={1}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            setNotice(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="Ask ORVYN anything"
          className={cn(
            "block w-full resize-none overflow-y-auto bg-transparent px-4 pt-4 pb-1",
            "text-[15px] leading-6 text-ink outline-none",
            "placeholder:text-ink-subtle",
          )}
        />

        <div className="flex items-center justify-between gap-3 px-3 pt-1 pb-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Attach a file"
              onClick={() => setNotice(notices.attach)}
            >
              <PaperclipIcon />
            </Button>
            <ComposerModeMenu mode={mode} onChange={onModeChange} />
          </div>

          <div className="flex items-center gap-3">
            <p className="hidden items-center gap-1 text-xs text-ink-subtle sm:flex">
              <Kbd>Enter</Kbd>
              <span>to send</span>
              <span aria-hidden="true">·</span>
              <Kbd>Shift</Kbd>
              <span>+</span>
              <Kbd>Enter</Kbd>
              <span>for a new line</span>
            </p>
            <Button type="submit" variant="accent" size="icon" aria-label="Send message" disabled={!canSend}>
              <ArrowUpIcon />
            </Button>
          </div>
        </div>
      </div>

      <p role="status" className="mt-2 min-h-4 px-1 text-xs text-ink-subtle">
        {notice}
      </p>
    </form>
  );
}