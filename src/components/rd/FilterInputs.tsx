"use client";

import { forwardRef } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { rdInputCls } from "./styles";

// rDash filter-input variants (RDTableHeaderDate / RDTableHeaderSingleSelect
// look): same 22px grey field with a 12px icon — calendar on the left for
// dates (#98a2b3), chevron on the right for selects (#c3c3c3).

type DateProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };
export const RdDateInput = forwardRef<HTMLInputElement, DateProps>(function RdDateInput(
  { invalid, className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <CalendarDays aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-rd-placeholder" />
      <input
        ref={ref}
        type="date"
        {...props}
        className={cn(rdInputCls(invalid, "rd-date relative pl-6"), !props.value && "text-rd-placeholder", className)}
      />
    </div>
  );
});

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; placeholderShown?: boolean };
export const RdSelect = forwardRef<HTMLSelectElement, SelectProps>(function RdSelect(
  { invalid, placeholderShown, className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        {...props}
        className={cn(rdInputCls(invalid, "appearance-none pr-6"), placeholderShown && "text-rd-placeholder", className)}
      >
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-rd-chevron" />
    </div>
  );
});
