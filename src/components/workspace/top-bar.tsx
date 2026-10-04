"use client";

import type { RefObject } from "react";
import { Badge, Button } from "@/components/ui";
import { getResponseMode, missionView, type ResponseMode } from "@/config/workspace";
import { MenuIcon, UsersIcon } from "./icons";
import { ModeSegmented } from "./mode-segmented";

export type TopBarProps = {
  mode: ResponseMode;
  onModeChange: (mode: ResponseMode) => void;
  onOpenDrawer: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export function TopBar({ mode, onModeChange, onOpenDrawer, triggerRef }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas px-3 sm:px-4">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenDrawer}
        aria-label="Open navigation"
        aria-controls="orvyn-sidebar"
      >
        <MenuIcon />
      </Button>

      <p className="hidden truncate text-sm text-ink-muted lg:block">New conversation</p>

      <div className="ml-auto flex items-center gap-2">
        <ModeSegmented mode={mode} onChange={onModeChange} className="hidden sm:flex" />

        <Badge variant="accent" className="sm:hidden">
          {getResponseMode(mode).label}
        </Badge>

        <Button
          variant="outline"
          size="sm"
          title={missionView.description}
          className="px-2 sm:px-3"
        >
          <UsersIcon />
          <span className="hidden sm:inline">{missionView.label}</span>
          <span className="sr-only sm:hidden">{missionView.label}</span>
        </Button>
      </div>
    </header>
  );
}