"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { currencyLabel, filterCurrencyOptions, type CurrencyOption } from "@/lib/payments/currency";
import { cn } from "@/lib/utils";
import { rdCard, rdInputCls } from "./styles";

// rDash "Currency : INR ▾" selector (Vendor Payments screen): 14px label,
// click opens a dropdown with a "Search Currency" box (matches name or code)
// and "<name> - <code>" options. Options / search come from
// lib/payments/currency.ts; this component only renders and reports a pick.
export function CurrencyFilter({
  options,
  selected,
  onSelect,
  disabled,
}: {
  options: CurrencyOption[];
  /** Selected currency code, or null = nothing selected ("Select"). */
  selected: string | null;
  onSelect: (code: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => filterCurrencyOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Currency filter"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || options.length === 0}
        onClick={() => {
          setQuery("");
          setOpen((o) => !o);
        }}
        className="flex items-center gap-1 text-[14px] text-rd-black disabled:cursor-not-allowed disabled:text-rd-placeholder"
      >
        Currency : <span className={cn(!selected && "text-rd-placeholder")}>{selected ?? "Select"}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-rd-placeholder" />
      </button>
      {open ? (
        <div className={cn(rdCard, "absolute right-0 top-[calc(100%+6px)] z-30 w-[280px] p-2 shadow-[0_4px_8px_0_rgba(0,0,0,0.12)]")}>
          <div className="relative mb-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-rd-placeholder" />
            <input
              autoFocus
              aria-label="Search Currency"
              placeholder="Search Currency"
              className={rdInputCls(false, "pl-6")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ul role="listbox" aria-label="Currencies" className="max-h-60 overflow-y-auto">
            {visible.map((o) => {
              const active = o.code === selected;
              return (
                <li key={o.code} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!active) onSelect(o.code);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-[3px] px-2 py-1.5 text-left text-[13px] text-rd-black hover:bg-rd-fill",
                      active && "font-semibold",
                    )}
                  >
                    {currencyLabel(o)}
                    {active ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-rd-red" /> : null}
                  </button>
                </li>
              );
            })}
            {visible.length === 0 ? <li className="px-2 py-1.5 text-[12px] text-rd-placeholder">No currency matches</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
