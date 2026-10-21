import { RdashPreviewFrame } from "./RdashPreviewFrame";

// App frame: rDash page background (#f9fafb), Gilroy, black text. No sidebar
// of its own — PBE runs inside rDash's Vendor Payments sub-tab, which draws the
// sidebar, breadcrumb, tabs and currency around the iframe. Mock mode only
// adds a static copy of that chrome (RdashPreviewFrame) for previewing.
// Fills exactly the viewport / iframe height (html/body/this: 100%) with no
// page-level scroll; every level below is a flex column with min-h-0 so the
// table rows are the only thing that scrolls.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-rd-page font-gilroy text-rd-black">
      <RdashPreviewFrame>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </RdashPreviewFrame>
    </div>
  );
}
