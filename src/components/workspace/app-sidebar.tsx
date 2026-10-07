"use client";

import type { ComponentType } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import {
  brand,
  conversationEmptyState,
  conversationsSection,
  sidebarNav,
  type SidebarNavId,
} from "@/config/workspace";
import { signOut } from "@/lib/auth/actions";
import type { AuthenticatedUser } from "@/lib/auth/session";
import type { UseAccountUsage } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import {
  BrandMark,
  CloseIcon,
  PanelCollapseIcon,
  PlusIcon,
  SettingsIcon,
  SignOutIcon,
  UniverseIcon,
  UserIcon,
  type IconProps,
} from "./icons";
import { SidebarNavItem } from "./sidebar-nav-item";
import { UsageMeter } from "./usage-meter";

const navIcons: Readonly<Record<SidebarNavId, ComponentType<IconProps>>> = {
  universe: UniverseIcon,
  settings: SettingsIcon,
};

export type ConversationItem = {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
};

export type AppSidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCloseDrawer: () => void;
  onNavigate: () => void;
  onNewConversation: () => void;
  usage: UseAccountUsage;
  /** `null` only while the session is still being resolved. */
  user: AuthenticatedUser | null;
  conversations: readonly ConversationItem[];
  onSelectConversation: (id: string) => void;
  /** Warms the conversation cache without navigating. */
  onPrefetchConversation?: (id: string) => void;
  activeConversationId: string | null;
};

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  onCloseDrawer,
  onNavigate,
  onNewConversation,
  usage,
  user,
  conversations,
  onSelectConversation,
  onPrefetchConversation,
  activeConversationId,
}: AppSidebarProps) {
  const today = usage.summary?.userDaily ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 px-4",
          collapsed && "lg:justify-center lg:px-0",
        )}
      >
        <BrandMark className="size-5 shrink-0 text-ink" />
        <span
          className={cn(
            "truncate text-[13px] font-semibold tracking-[0.14em] text-ink uppercase",
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

      <div className={cn("shrink-0 px-3 pb-5", collapsed && "lg:px-2")}>
        <Button
          variant="outline"
          onClick={onNewConversation}
          aria-label="New conversation"
          title={collapsed ? "New conversation" : undefined}
          className={cn("w-full justify-start", collapsed && "lg:justify-center lg:px-0")}
        >
          <PlusIcon />
          <span className={cn(collapsed && "lg:hidden")}>New conversation</span>
        </Button>
      </div>

      <nav
        aria-label="Workspace"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4"
      >
        <div className="flex flex-col">
          <p
            className={cn(
              "px-2 pt-1 pb-2.5 text-[11px] font-medium tracking-[0.08em] text-ink-subtle uppercase",
              collapsed && "lg:hidden",
            )}
          >
            {conversationsSection.label}
          </p>
          {conversations.length === 0 ? (
            <>
              <p className={cn("px-2 text-[13px] text-ink-muted", collapsed && "lg:hidden")}>
                {conversationEmptyState.title}
              </p>
              <p
                className={cn("mt-0.5 px-2 text-xs leading-relaxed text-ink-subtle", collapsed && "lg:hidden")}
              >
                {conversationEmptyState.description}
              </p>
            </>
          ) : (
            <div className="flex flex-col gap-0.5">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => onSelectConversation(conversation.id)}
                  onMouseEnter={() => onPrefetchConversation?.(conversation.id)}
                  onFocus={() => onPrefetchConversation?.(conversation.id)}
                  className={cn(
                    "w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150",
                    activeConversationId === conversation.id
                      ? "bg-hover text-ink"
                      : "text-ink-muted hover:bg-hover hover:text-ink",
                    collapsed && "lg:justify-center lg:px-0",
                  )}
                  title={conversation.title || "New conversation"}
                >
                  {conversation.title || "New conversation"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-0.5">
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

      <div className="shrink-0 border-t border-line p-3">
        <UsageMeter usage={usage} collapsed={collapsed} />

        {user === null ? null : (
          <div className={cn("mt-2", collapsed && "lg:justify-center lg:px-0")}>
            <AccountButton user={user} collapsed={collapsed} todayTokens={today?.totalTokens ?? null} />
          </div>
        )}

        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="orvyn-sidebar"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "mt-1 hidden w-full items-center gap-3 rounded-md px-2 py-2 text-[13px] lg:flex",
            "text-ink-subtle transition-colors duration-150 hover:bg-hover hover:text-ink",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <PanelCollapseIcon
            className={cn(
              "size-3.5 shrink-0 transition-transform duration-200",
              collapsed && "rotate-180",
            )}
          />
          <span className={cn("truncate", collapsed && "lg:hidden")}>Collapse</span>
        </button>
      </div>
    </div>
  );
}

/**
 * The signed-in account and its sign-out control.
 *
 * The email is the whole address rather than a shortened form: truncating it in
 * the DOM would change what a user copies on paste, and this is the one place
 * where being sure which account is active matters.
 */
function AccountButton({
  user,
  collapsed,
  todayTokens,
}: {
  readonly user: AuthenticatedUser;
  readonly collapsed: boolean;
  readonly todayTokens: number | null;
}) {
  const { pending } = useFormStatus();

  return (
    <div className="flex items-center gap-1">
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-2",
          collapsed && "lg:justify-center lg:px-0",
        )}
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line text-ink-subtle">
          <UserIcon className="size-3" />
        </span>
        <span className={cn("flex min-w-0 flex-col", collapsed && "lg:hidden")}>
          <span className="truncate text-[13px] text-ink">{user.email}</span>
          <span className="truncate text-[11px] text-ink-subtle">
            {todayTokens === null ? "Usage unavailable" : "Active"}
          </span>
        </span>
      </div>

      <form action={signOut} className="shrink-0">
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          title="Sign out"
          aria-label="Sign out"
          className={cn("text-ink-subtle", collapsed && "lg:hidden")}
        >
          <SignOutIcon />
        </Button>
      </form>
    </div>
  );
}