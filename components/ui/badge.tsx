import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  const variants: Record<BadgeVariant, string> = {
    default: "bg-surface text-textSecondary",
    success: "bg-[rgba(48,209,88,0.12)] text-[#16a34a]",
    warning: "bg-[rgba(255,159,10,0.12)] text-[#c97400]",
    danger: "bg-[rgba(255,59,48,0.12)] text-danger",
    info: "bg-[rgba(0,113,227,0.12)] text-accent",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
