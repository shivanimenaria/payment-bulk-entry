import { cn } from "@/lib/utils";

export interface RdStepperItem {
  key: string;
  label: React.ReactNode;
  active?: boolean;
}

// rDash RDStepper look (navigation-stepper-container): 42px bar, white,
// inset 1px #c7c8c9 bottom border, 20px left padding; 14px items separated by
// 20px-tall #c7c8c9 rules; the active item is semibold with a 2px red
// underline extending 8px beyond its text. Measured from
// 01-rdash-payment-entries.png. Purely visual — items are not links.
export function RdStepper({
  items,
  right,
  className,
}: {
  items: RdStepperItem[];
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-[42px] min-h-[42px] items-stretch justify-between bg-white pl-5 pr-5 shadow-[inset_0_-1px_0_var(--rd-border)]",
        className,
      )}
    >
      <div className="flex items-stretch">
        {items.map((it, i) => (
          <div key={it.key} className="flex items-stretch">
            {i > 0 ? <span aria-hidden="true" className="my-auto h-5 w-px bg-rd-border" /> : null}
            <div
              className={cn(
                "relative flex items-center whitespace-nowrap text-[14px] text-rd-black",
                i === 0 ? "pl-[9px] pr-[21px]" : "px-[21px]",
                it.active && "font-semibold",
              )}
            >
              {it.label}
              {it.active ? (
                <span
                  aria-hidden="true"
                  className={cn("absolute bottom-0 h-[2px] bg-rd-red", i === 0 ? "left-[1px] right-[13px]" : "left-[13px] right-[13px]")}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {right ? <div className="flex items-center">{right}</div> : null}
    </div>
  );
}
