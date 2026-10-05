import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "text-sm font-medium transition-colors duration-150",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        // White on near-black. The one high-contrast surface in the product,
        // reserved for the primary action so it stays the only thing that
        // shouts.
        primary: "bg-ink text-canvas hover:bg-ink/88 active:bg-ink/80",
        accent: "bg-accent text-accent-ink hover:bg-accent-strong",
        secondary: "bg-surface-raised text-ink hover:bg-line-strong/40",
        outline: "border border-line text-ink hover:bg-hover hover:border-line-strong",
        ghost: "text-ink-muted hover:bg-hover hover:text-ink",
        danger: "bg-danger text-danger-ink hover:bg-danger/90",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-3.5",
        lg: "h-11 px-5",
        icon: "size-9 p-0",
        "icon-sm": "size-8 p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export type ButtonProps = ComponentPropsWithRef<"button"> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
