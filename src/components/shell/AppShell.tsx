import { RdashPreviewFrame } from "./RdashPreviewFrame";

// App frame: rDash page background (#f9fafb), Gilroy, black text. No sidebar
// of its own — PBE runs inside rDash's Vendor Payments sub-tab, which draws the
// sidebar, breadcrumb, tabs and currency around the iframe. Mock mode only
// adds a static copy of that chrome (RdashPreviewFrame) for previewing.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen min-w-0 bg-rd-page font-gilroy text-rd-black">
      <RdashPreviewFrame>
        <div className="flex min-h-full min-w-0 flex-col">{children}</div>
      </RdashPreviewFrame>
    </div>
  );
}
