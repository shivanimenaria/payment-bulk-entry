"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** RFQ filter-row control size: `h-7 text-xs border-gray-200 rounded bg-white px-2`. */
export const rfqFilterInput = "h-7 w-full rounded border border-gray-200 bg-white px-2 text-xs";

// "Select Option" multi-select filter, like the RFQ list's MultiSelectFilter
// (that component is not in docs/ui-reference; look taken from
// rfq-table/target-table.png): an h-7 white field with a grey "Select Option"
// placeholder and a chevron; the popover lists the options with checkboxes.
// One option picked → its name; several → "N selected".
export function SelectOptionFilter({
  label,
  options,
  selected,
  onChange,
}: {
  /** Accessible name, e.g. "Status filter". */
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const text = selected.length === 0 ? "Select Option" : selected.length === 1 ? selected[0] : `${selected.length} selected`;
  const toggle = (o: string) => onChange(selected.includes(o) ? selected.filter((s) => s !== o) : [...selected, o]);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          data-filter={label}
          className={cn(rfqFilterInput, "flex items-center justify-between gap-1 text-left font-normal")}
        >
          <span className={cn("truncate", selected.length === 0 ? "text-gray-400" : "text-gray-900")}>{text}</span>
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 max-h-64 min-w-[180px] overflow-y-auto rounded-md border border-gray-200 bg-white p-1 font-gilroy shadow-md"
        >
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-gray-400">No options</p>
          ) : (
            <ul role="listbox" aria-label={label} aria-multiselectable="true">
              {options.map((o) => {
                const on = selected.includes(o);
                return (
                  <li key={o} role="option" aria-selected={on}>
                    <button
                      type="button"
                      onClick={() => toggle(o)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
                    >
                      <span
                        className={cn(
                          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                          on ? "border-rd-red bg-rd-red text-white" : "border-gray-300 bg-white",
                        )}
                      >
                        {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                      </span>
                      <span className="truncate">{o}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
