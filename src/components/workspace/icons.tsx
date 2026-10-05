import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

function Stroke({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function BrandMark({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <circle cx="16" cy="16" r="10.5" stroke="currentColor" strokeWidth={2.25} opacity={0.85} />
      <circle cx="16" cy="16" r="3.75" fill="currentColor" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 5v14M5 12h14" />
    </Stroke>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5Z" />
    </Stroke>
  );
}

export function UniverseIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5c4.7 0 8.5 3.8 8.5 8.5s-3.8 8.5-8.5 8.5" />
      <path d="M12 3.5C7.3 3.5 3.5 7.3 3.5 12s3.8 8.5 8.5 8.5" />
    </Stroke>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="12" r="2.75" />
      <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4M17.9 17.9l-1.4-1.4M7.5 7.5 6.1 6.1" />
    </Stroke>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="8.5" r="3.25" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Stroke>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Stroke>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Stroke>
  );
}

export function PanelCollapseIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M10 4.5v15M15 10l-2.5 2 2.5 2" />
    </Stroke>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M17.5 10.5 11 17a3.5 3.5 0 0 1-5-5l7-7a2.5 2.5 0 0 1 3.5 3.5l-7 7a1.5 1.5 0 0 1-2-2l6-6" />
    </Stroke>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M6.5 9.5 12 15l5.5-5.5" />
    </Stroke>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Stroke>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="9.5" cy="8.5" r="2.75" />
      <path d="M3.5 19.5a6 6 0 0 1 12 0" />
      <path d="M16 6.2a2.75 2.75 0 0 1 0 5.2M17.5 14.4a6 6 0 0 1 3 5.1" />
    </Stroke>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M5.5 12.5 10 17l8.5-10" />
    </Stroke>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 3.5 21 8l-9 4.5L3 8Z" />
      <path d="M3 12.5 12 17l9-4.5M3 16.5 12 21l9-4.5" />
    </Stroke>
  );
}

export function CompassIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.5 8.5l-2 5-5 2 2-5Z" />
    </Stroke>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />
    </Stroke>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.75v4.75M12 15.75h.01" />
    </Stroke>
  );
}

export function LightbulbIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M9.5 17.5h5M10 20.5h4" />
      <path d="M12 3.5a5.5 5.5 0 0 1 3.4 9.8c-.6.5-.9 1.1-.9 1.7v.5h-5v-.5c0-.6-.3-1.2-.9-1.7A5.5 5.5 0 0 1 12 3.5Z" />
    </Stroke>
  );
}
