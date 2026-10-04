"use client";

import type { ComponentType } from "react";
import { Button } from "@/components/ui";
import {
  account,
  brand,
  conversationEmptyState,
  conversationsSection,
  sidebarNav,
  type SidebarNavId,
} from "@/config/workspace";
import { cn } from "@/lib/utils";
import {
  BrandMark,
  CloseIcon,
  PanelCollapseIcon,
  PlusIcon,
  SettingsIcon,
  UniverseIcon,
  UserIcon,
  type IconProps,
} from "./icons";
import { SidebarNavItem } from "./sidebar-nav-item";

const navIcons: Readonly<Record<SidebarNavId, ComponentType<IconProps>>> = {
  universe: UniverseIcon,
  settings: SettingsIcon,
};

export type AppSidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCloseDrawer: () => void;
  onNavigate: () => void;
  onNewConversation: () => void;
};

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  onCloseDrawer,
  onNavigate,
  onNewConversation,
}: AppSidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 px-3",
          collapsed && "lg:justify-center lg:px-0",
        )}
      >
        <BrandMark className="size-6 shrink-0 text-accent" />
        <span
          className={cn(
            "truncate text-sm font-semibold tracking-tight text-ink",
            collapsed && "lg:hidden",
          )}
        >
          {brand.name}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto lg:hidden"
          onClick={onCloseDrawer}
          aria-label="Close navigation"
        >
          <CloseIcon />
        </Button>
      </div>

      <div className={cn("shrink-0 px-3 pb-4", collapsed && "lg:px-2")}>
        <Button
          variant="primary"
          onClick={onNewConversation}
          aria-label="New conversation"
          title={collapsed ? "New conversation" : undefined}
          className={cn("w-full", collapsed && "lg:px-0")}
        >
          <PlusIcon />
          <span className={cn(collapsed && "lg:hidden")}>New conversation</span>
        </Button>
      </div>

      <nav
        aria-label="Workspace"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3"
      >
        <div className="flex flex-col">
          <p
            className={cn(
              "px-2.5 pt-1 pb-2 text-xs font-medium text-ink-subtle",
              collapsed && "lg:hidden",
            )}
          >
            {conversationsSection.label}
          </p>
          <p className={cn("px-2.5 text-xs text-ink-subtle", collapsed && "lg:hidden")}>
            {conversationEmptyState.title}
          </p>
          <p
            className={cn("mt-0.5 px-2.5 text-xs text-ink-subtle/70", collapsed && "lg:hidden")}
          >
            {conversationEmptyState.description}
          </p>
        </div>

        <div className="mt-3 flex flex-col gap-0.5">
          {sidebarNav.map((item) => (
            <SidebarNavItem
              key={item.id}
              label={item.label}
              icon={navIcons[item.id]}
              collapsed={collapsed}
              isCurrent={false}
              onSelect={onNavigate}
            />
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-line p-2">
        <button
          type="button"
          aria-label={account.name}
          title={collapsed ? account.name : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left",
            "transition-colors duration-150 hover:bg-hover",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-surface-raised text-ink-subtle">
            <UserIcon className="size-3.5" />
          </span>
          <span className={cn("flex min-w-0 flex-col", collapsed && "lg:hidden")}>
            <span className="truncate text-sm text-ink">{account.name}</span>
            <span className="truncate text-xs text-ink-subtle">{account.status}</span>
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="orvyn-sidebar"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "mt-1 hidden w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm lg:flex",
            "text-ink-subtle transition-colors duration-150 hover:bg-hover hover:text-ink",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <PanelCollapseIcon
            className={cn(
              "size-4 shrink-0 transition-transform duration-200",
              collapsed && "rotate-180",
            )}
          />
          <span className={cn("truncate", collapsed && "lg:hidden")}>Collapse sidebar</span>
        </button>
      </div>
    </div>
  );
}