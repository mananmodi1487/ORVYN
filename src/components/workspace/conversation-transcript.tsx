"use client";

import { useEffect, useRef } from "react";
import type { ChatStreamError, ChatStreamMeta, ChatTurn } from "@/lib/ai/chat-protocol";
import { cn } from "@/lib/utils";
import { AlertIcon } from "./icons";

export type ConversationTranscriptProps = {
  readonly turns: readonly ChatTurn[];
  readonly isStreaming: boolean;
  readonly error: ChatStreamError | null;
  readonly activeModel: ChatStreamMeta | null;
};

/**
 * Renders the conversation and keeps the newest turn in view.
 *
 * The scroll is driven from an effect rather than a ref callback so it runs once
 * per render with the current content, instead of firing during commit and
 * forcing a second layout pass.
 */
export function ConversationTranscript({
  turns,
  isStreaming,
  error,
  activeModel,
}: ConversationTranscriptProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  return (
    <section
      aria-label="Conversation"
      aria-busy={isStreaming}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"
    >
      {turns.map((turn, index) => {
        const isLast = index === turns.length - 1;
        const pending = isLast && turn.role === "assistant" && turn.text === "";
        if (pending) return <PendingAnswer key={turn.id} model={activeModel} />;

        return (
          <Turn
            key={turn.id}
            turn={turn}
            model={turn.role === "assistant" ? activeModel : null}
            streaming={isLast && isStreaming}
          />
        );
      })}

      {error !== null ? <FailureNotice error={error} /> : null}

      <div ref={endRef} />
    </section>
  );
}

function Turn({
  turn,
  model,
  streaming,
}: {
  readonly turn: ChatTurn;
  readonly model: ChatStreamMeta | null;
  readonly streaming: boolean;
}) {
  const isUser = turn.role === "user";
  return (
    <article
      className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}
      aria-label={isUser ? "Your message" : "ORVYN reply"}
    >
      {!isUser && model !== null ? (
        <p className="px-1 text-xs text-ink-subtle">
          {model.displayName}
          <span aria-hidden="true"> · </span>
          <span className="text-ink-subtle/80">{model.provider}</span>
        </p>
      ) : null}

      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap break-words",
          isUser ? "bg-accent-muted text-ink" : "bg-surface-raised text-ink",
        )}
      >
        {turn.text}
        {streaming ? (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent"
          />
        ) : null}
      </div>
    </article>
  );
}

function PendingAnswer({ model }: { readonly model: ChatStreamMeta | null }) {
  return (
    <div className="flex flex-col gap-1.5" aria-label="ORVYN is replying">
      {model !== null ? <p className="px-1 text-xs text-ink-subtle">{model.displayName}</p> : null}
      <div className="flex items-center gap-1.5 rounded-2xl bg-surface-raised px-4 py-3">
        <span className="sr-only">ORVYN is replying</span>
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            aria-hidden="true"
            className="size-1.5 animate-pulse rounded-full bg-ink-subtle"
            style={{ animationDelay: `${dot * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function FailureNotice({ error }: { readonly error: ChatStreamError }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm text-danger-ink"
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0">
        <p>{error.message}</p>
        {error.detail !== null ? (
          <p className="mt-1 font-mono text-xs break-words text-danger-ink/70">{error.detail}</p>
        ) : null}
        {error.retryable ? <p className="mt-1 text-xs text-danger-ink/70">You can try again.</p> : null}
      </div>
    </div>
  );
}
