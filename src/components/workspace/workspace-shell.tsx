"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  conversationActionErrorMessage,
  defaultResponseMode,
  type ResponseMode,
} from "@/config/workspace";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { useAccountUsage, useConversation, useIsClient, useMediaQuery } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useAgent } from "@/lib/agent/use-agent";
import type { ConversationItem } from "./app-sidebar";
import { CodingPanel } from "./coding/coding-panel";
import { InstallPrompt } from "./coding/install-prompt";
import { AppSidebar } from "./app-sidebar";
import { ConversationTranscript } from "./conversation-transcript";
import { MessageComposer } from "./message-composer";
import { TopBar } from "./top-bar";
import { WelcomePanel } from "./welcome-panel";

const DESKTOP_QUERY = "(min-width: 1024px)";
const SIDEBAR_ID = "orvyn-sidebar";
const MAIN_ID = "orvyn-main";

/**
 * The sidebar's ordering: pinned conversations first —
 * newest pin first — then the rest by recency. The list
 * endpoint answers in this order; the optimistic pin
 * update re-applies it locally so a reorder is
 * immediate, and a rollback restores the previous
 * order the same way.
 */
function sortConversations(
  items: readonly ConversationItem[],
): ConversationItem[] {
  return [...items].sort((a, b) => {
    if ((a.pinnedAt !== null) !== (b.pinnedAt !== null)) {
      return a.pinnedAt !== null ? -1 : 1;
    }
    if (a.pinnedAt !== null && b.pinnedAt !== null) {
      const pinnedOrder = b.pinnedAt.localeCompare(a.pinnedAt);
      if (pinnedOrder !== 0) return pinnedOrder;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export type WorkspaceShellProps = {
  readonly user: AuthenticatedUser;
};

export function WorkspaceShell({ user }: WorkspaceShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<ResponseMode>(defaultResponseMode);
  const [draft, setDraft] = useState("");
  const [workspace, setWorkspace] = useState<"chat" | "code">("chat");
  const [conversations, setConversations] = useState<readonly ConversationItem[]>([]);
  // A mirror of the list, so the pin and archive
  // handlers can read the pre-mutation list
  // synchronously — the state an optimistic update
  // rolls back to — without depending on state that
  // may be stale inside a long-lived callback. The
  // effect keeps it in step with every committed
  // change.
  const conversationsRef = useRef<readonly ConversationItem[]>([]);
  // Bumped whenever a conversation is created, so the list
  // effect reloads and the sidebar shows it immediately.
  const [listVersion, setListVersion] = useState(0);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const handleConversationCreated = useCallback(() => {
    setListVersion((version) => version + 1);
  }, []);

  // Reads the sidebar list. `null` means the list could
  // not be read; callers decide what that means for them.
  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/conversations");
      if (!response.ok) return null;
      const data = (await response.json()) as { conversations: ConversationItem[] };
      return data.conversations ?? [];
    } catch {
      // Non-blocking: the empty state is a fine fallback.
      return null;
    }
  }, []);

  const handleStreamComplete = useCallback(
    (id: string) => {
      // A completed response may have produced an automatic
      // title for the conversation that just streamed in: the
      // title is generated while the answer streams, and the
      // sidebar list is the one place titles show. Reading the
      // list here is what makes the title appear without
      // Realtime.
      //
      // The title call runs concurrently with the answer, so a
      // short answer can finish first. The list is re-checked a
      // couple of times before giving up — the next open reloads
      // it anyway.
      const refresh = (attemptsLeft: number) => {
        void loadConversations().then((items) => {
          if (items === null) return;
          const active = items.find((item) => item.id === id);
          if (active === undefined) return;
          if (active.title === "") {
            if (attemptsLeft > 0) {
              window.setTimeout(() => refresh(attemptsLeft - 1), 1500);
            }
            return;
          }
          setConversations(items);
        });
      };
      refresh(2);
    },
    [loadConversations],
  );

  const conversation = useConversation({
    onConversationCreated: handleConversationCreated,
    onStreamComplete: handleStreamComplete,
  });
  // Usage figures change only when a reply with reported
  // usage completes. Historical turns loaded from a
  // conversation carry no usage of their own, so keying on
  // the turn count would refetch on every conversation
  // opened.
  const usageRefreshKey = conversation.turns.filter(
    (turn) => turn.usage !== undefined,
  ).length;
  const usage = useAccountUsage(usageRefreshKey);

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const isClient = useIsClient();

  const { agent, status: agentStatus } = useAgent();

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const drawerActive = drawerOpen && !isDesktop;

  useEffect(() => {
    const list = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      if (list.matches) setDrawerOpen(false);
    };
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (drawerActive) sidebarRef.current?.focus();
  }, [drawerActive]);

  // Loads the sidebar list on mount and again whenever a
  // conversation is created, so a new chat shows up in the
  // sidebar immediately instead of on the next page load.
  useEffect(() => {
    let cancelled = false;

    void loadConversations().then((items) => {
      if (!cancelled && items !== null) {
        setConversations(items);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [listVersion, loadConversations]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    if (!isDesktop) drawerTriggerRef.current?.focus();
  }, [isDesktop]);

  const handleNewConversation = async () => {
    conversation.reset();
    setDraft("");
    if (!isDesktop) setDrawerOpen(false);
    composerRef.current?.focus();

    try {
      // createConversation notifies onConversationCreated, which
      // refreshes the sidebar list.
      await conversation.createConversation();
    } catch {
      // Non-blocking: the user can still type and send.
    }
  };

  /**
   * Renames a conversation and reflects the new
   * title in the sidebar the moment the request
   * succeeds. The hook owns the request; the shell
   * owns the list, so a successful rename updates
   * the list item in place.
   */
  const handleRenameConversation = useCallback(
    async (id: string, title: string): Promise<string | null> => {
      const result = await conversation.renameConversation(id, title);
      if (result.ok) {
        setConversations((items) =>
          items.map((item) => (item.id === id ? { ...item, title } : item)),
        );
        return null;
      }
      return conversationActionErrorMessage(result.error);
    },
    [conversation],
  );

  /**
   * Pins or unpins a conversation. The list is
   * reordered optimistically — the pinned
   * conversation leads the sidebar the moment the
   * menu action is chosen — and a failed request
   * rolls the previous order back. The hook owns
   * the request; the shell owns the list.
   */
  const handlePinConversation = useCallback(
    async (id: string, pinned: boolean): Promise<string | null> => {
      const previous = conversationsRef.current.find(
        (item) => item.id === id,
      );
      setConversations((items) =>
        sortConversations(
          items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  pinnedAt: pinned ? new Date().toISOString() : null,
                }
              : item,
          ),
        ),
      );

      const result = await conversation.pinConversation(id, pinned);
      if (result.ok) {
        return null;
      }

      // The server refused the change: put the
      // conversation back the way the list held it.
      if (previous !== undefined) {
        setConversations((items) =>
          sortConversations(
            items.map((item) =>
              item.id === id
                ? { ...item, pinnedAt: previous.pinnedAt }
                : item,
            ),
          ),
        );
      }
      return conversationActionErrorMessage(result.error);
    },
    [conversation],
  );

  /**
   * Archives a conversation: it leaves the sidebar
   * immediately and stays hidden — the list endpoint
   * no longer returns it — unless the request fails,
   * which puts it back where it was.
   */
  const handleArchiveConversation = useCallback(
    async (id: string): Promise<string | null> => {
      const items = conversationsRef.current;
      const index = items.findIndex((item) => item.id === id);
      const previous = index === -1 ? null : (items[index] ?? null);
      setConversations(items.filter((item) => item.id !== id));

      const result = await conversation.archiveConversation(id);
      if (result.ok) {
        return null;
      }

      // The server refused the archive: restore the
      // conversation at its previous position.
      if (previous !== null) {
        setConversations((items) => {
          const restored = [...items];
          restored.splice(Math.min(index, restored.length), 0, previous);
          return restored;
        });
      }
      return conversationActionErrorMessage(result.error);
    },
    [conversation],
  );

  /**
   * Deletes a conversation. The hook evicts its
   * cache entry and returns the view to the empty
   * state when the open conversation is the one
   * deleted; the shell drops it from the list.
   */
  const handleDeleteConversation = useCallback(
    async (id: string): Promise<string | null> => {
      const result = await conversation.deleteConversation(id);
      if (result.ok) {
        setConversations((items) => items.filter((item) => item.id !== id));
        return null;
      }
      return conversationActionErrorMessage(result.error);
    },
    [conversation],
  );

  const handleSelectConversation = useCallback(
    async (id: string) => {
      await conversation.loadConversation(id);
      if (!isDesktop) setDrawerOpen(false);
      composerRef.current?.focus();
    },
    [conversation, isDesktop],
  );

  const handleSelectPrompt = (prompt: string) => {
    setDraft(prompt);
    composerRef.current?.focus();
  };

  const handleSend = (text: string) => {
    conversation.send(text);
    composerRef.current?.focus();
  };

  const chatScrollArea = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {conversation.turns.length === 0 ? (
        <WelcomePanel onSelectPrompt={handleSelectPrompt} />
      ) : (
        <ConversationTranscript
          turns={conversation.turns}
          isStreaming={conversation.isStreaming}
          error={conversation.error}
          conversationUsage={conversation.conversationUsage}
        />
      )}
    </div>
  );

  const messageComposer = (
    <div className="shrink-0 border-t border-line bg-canvas">
      <div className="mx-auto w-full max-w-3xl px-5 py-4 sm:px-8 sm:py-5">
        <MessageComposer
          value={draft}
          onValueChange={setDraft}
          mode={mode}
          onModeChange={setMode}
          inputRef={composerRef}
          onSend={handleSend}
          isStreaming={conversation.isStreaming}
          onStop={conversation.stop}
        />
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas text-ink">
      <a
        href={`#${MAIN_ID}`}
        className={cn(
          "sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50",
          "focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-canvas",
        )}
      >
        Skip to content
      </a>

      {drawerActive ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={closeDrawer}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      ) : null}

      <aside
        id={SIDEBAR_ID}
        ref={sidebarRef}
        tabIndex={-1}
        aria-label="Sidebar"
        inert={isClient && !isDesktop && !drawerOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[272px] shrink-0 border-r border-line",
          "transition-transform duration-200 ease-out",
          "lg:relative lg:inset-y-auto lg:z-auto lg:translate-x-0",
          drawerActive ? "translate-x-0" : "-translate-x-full",
          collapsed ? "lg:w-[68px]" : "lg:w-[272px]",
        )}
      >
        <AppSidebar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((previous) => !previous)}
          onCloseDrawer={closeDrawer}
          onNavigate={() => {
            if (!isDesktop) setDrawerOpen(false);
          }}
          onNewConversation={handleNewConversation}
          usage={usage}
          user={user}
          conversations={conversations}
          onSelectConversation={handleSelectConversation}
          onPrefetchConversation={conversation.prefetchConversation}
          onRenameConversation={handleRenameConversation}
          onPinConversation={handlePinConversation}
          onArchiveConversation={handleArchiveConversation}
          onDeleteConversation={handleDeleteConversation}
          activeConversationId={conversation.conversationId}
        />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex">
          <TopBar
            mode={mode}
            onModeChange={setMode}
            onOpenDrawer={() => setDrawerOpen(true)}
            triggerRef={drawerTriggerRef}
          />
          <button
            type="button"
            onClick={() =>
              setWorkspace((previous) =>
                previous === "chat" ? "code" : "chat",
              )
            }
            aria-pressed={workspace === "code"}
            className={cn(
              "h-14 shrink-0 border-l border-line px-3 text-xs font-medium",
              workspace === "code"
                ? "bg-ink text-canvas"
                : "text-ink-muted hover:bg-hover hover:text-ink",
            )}
          >
            {workspace === "code" ? "Chat" : "Code"}
          </button>
        </div>

        <main id={MAIN_ID} className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!isDesktop && (
              <div className="flex shrink-0 border-b border-line">
                <button
                  type="button"
                  onClick={() => setWorkspace("chat")}
                  className={cn(
                    "flex-1 px-4 py-2 text-xs font-medium",
                    workspace === "chat"
                      ? "border-b-2 border-accent text-ink"
                      : "text-ink-muted",
                  )}
                >
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspace("code")}
                  className={cn(
                    "flex-1 px-4 py-2 text-xs font-medium",
                    workspace === "code"
                      ? "border-b-2 border-accent text-ink"
                      : "text-ink-muted",
                  )}
                >
                  Code
                </button>
              </div>
            )}

            {workspace === "chat" ? (
              <>
                {chatScrollArea}
                {messageComposer}
              </>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                {agentStatus === "available" ? (
                  <CodingPanel agent={agent} />
                ) : (
                  <InstallPrompt />
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
