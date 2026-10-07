"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultResponseMode, type ResponseMode } from "@/config/workspace";
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

export type WorkspaceShellProps = {
  readonly user: AuthenticatedUser;
};

export function WorkspaceShell({ user }: WorkspaceShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<ResponseMode>(defaultResponseMode);
  const [draft, setDraft] = useState("");
  const [codingOpen, setCodingOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"chat" | "code">("code");
  const [conversations, setConversations] = useState<readonly ConversationItem[]>([]);

  const conversation = useConversation();
  const usage = useAccountUsage(conversation.turns.length);

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

  useEffect(() => {
    let cancelled = false;

    async function loadConversations() {
      try {
        const response = await fetch("/api/conversations");
        if (!response.ok) return;
        const data = (await response.json()) as { conversations: ConversationItem[] };
        if (!cancelled) {
          setConversations(data.conversations ?? []);
        }
      } catch {
        // Non-blocking: the empty state is a fine fallback.
      }
    }

    loadConversations();

    return () => {
      cancelled = true;
    };
  }, []);

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
      await conversation.createConversation();
      const response = await fetch("/api/conversations");
      if (response.ok) {
        const data = (await response.json()) as { conversations: ConversationItem[] };
        setConversations(data.conversations ?? []);
      }
    } catch {
      // Non-blocking: the user can still type and send.
    }
  };

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

  const toggleCoding = useCallback(() => {
    setCodingOpen((previous) => {
      const next = !previous;
      if (next && !isDesktop) setMobileTab("code");
      return next;
    });
  }, [isDesktop]);

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
            onClick={toggleCoding}
            className={cn(
              "h-14 shrink-0 border-l border-line px-3 text-xs font-medium",
              codingOpen
                ? "bg-ink text-canvas"
                : "text-ink-muted hover:bg-hover hover:text-ink",
            )}
          >
            {codingOpen ? "Chat" : "Code"}
          </button>
        </div>

        <main id={MAIN_ID} className="flex min-h-0 flex-1">
          <div
            className={cn(
              "flex min-w-0 flex-col",
              isDesktop ? "flex-1" : codingOpen ? "hidden" : "flex-1",
            )}
          >
            {chatScrollArea}
            {messageComposer}
          </div>

          {codingOpen && (
            <div
              className={cn(
                "flex flex-col",
                isDesktop ? "w-[420px] shrink-0 border-l" : "flex-1",
              )}
            >
              {!isDesktop && (
                <div className="flex border-b border-line">
                  <button
                    type="button"
                    onClick={() => setMobileTab("chat")}
                    className={cn(
                      "flex-1 px-4 py-2 text-xs font-medium",
                      mobileTab === "chat"
                        ? "border-b-2 border-accent text-ink"
                        : "text-ink-muted",
                    )}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileTab("code")}
                    className={cn(
                      "flex-1 px-4 py-2 text-xs font-medium",
                      mobileTab === "code"
                        ? "border-b-2 border-accent text-ink"
                        : "text-ink-muted",
                    )}
                  >
                    Code
                  </button>
                </div>
              )}

              <div className="min-h-0 flex-1">
                {(mobileTab === "code" || isDesktop) &&
                agentStatus === "available" ? (
                  <CodingPanel agent={agent} />
                ) : (mobileTab === "code" || isDesktop) ? (
                  <InstallPrompt />
                ) : (
                  <div className="flex h-full flex-col">
                    {chatScrollArea}
                    {messageComposer}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
