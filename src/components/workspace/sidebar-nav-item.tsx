"use client";

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import type { IconProps } from "./icons";

export type SidebarNavItemProps = {
  label: string;
  icon: ComponentType<IconProps>;
  collapsed: boolean;
  isCurrent: boolean;
  onSelect: () => void;
};

export function SidebarNavItem({
  label,
  icon: Icon,
  collapsed,
  isCurrent,
  onSelect,
}: SidebarNavItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isCurrent ? "page" : undefined}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-[13px]",
        "text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink",
        isCurrent && "bg-active text-ink",
        collapsed && "lg:justify-center lg:px-0",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className={cn("truncate", collapsed && "lg:hidden")}>{label}</span>
    </button>
  );
}