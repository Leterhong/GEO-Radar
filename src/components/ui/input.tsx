import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm text-foreground shadow-[0_1px_1px_rgba(16,24,40,0.02)] transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-quaternary focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/12 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "flex min-h-[78px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-[0_1px_1px_rgba(16,24,40,0.02)] transition-colors placeholder:text-quaternary focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/12 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export { Input, Textarea };
