"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultResponseMode, type ResponseMode } from "@/config/workspace";
import { useIsClient, useMediaQuery } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { AppSidebar } from "./app-sidebar";
import { MessageComposer } from "./message-composer";
import { TopBar } from "./top-bar";
import { WelcomePanel } from "./welcome-panel";

const DESKTOP_QUERY = "(min-width: 1024px)";
const SIDEBAR_ID = "orvyn-sidebar";
const MAIN_ID = "orvyn-main";

export function WorkspaceShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<ResponseMode>(defaultResponseMode);
  const [draft, setDraft] = useState("");

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const isClient = useIsClient();

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

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    if (!isDesktop) drawerTriggerRef.current?.focus();
  }, [isDesktop]);

  const handleNewConversation = () => {
    setDraft("");
    if (!isDesktop) setDrawerOpen(false);
    composerRef.current?.focus();
  };

  const handleSelectPrompt = (prompt: string) => {
    setDraft(prompt);
    composerRef.current?.focus();
  };

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
        />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          mode={mode}
          onModeChange={setMode}
          onOpenDrawer={() => setDrawerOpen(true)}
          triggerRef={drawerTriggerRef}
        />

        <main id={MAIN_ID} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <WelcomePanel onSelectPrompt={handleSelectPrompt} />
          </div>

          <div className="shrink-0 border-t border-line bg-canvas">
            <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6 sm:py-5">
              <MessageComposer
                value={draft}
                onValueChange={setDraft}
                mode={mode}
                onModeChange={setMode}
                inputRef={composerRef}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}