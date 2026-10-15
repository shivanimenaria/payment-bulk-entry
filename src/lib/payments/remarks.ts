// Row Remarks rules (CLAUDE.md Key Rules → Remarks). Pure, immutable updates.
//  - The header Remark is copied into every row that hasn't been overridden.
//  - Editing a row's Remarks marks it overridden; its value wins over later
//    header changes. Clearing it keeps it overridden (empty = no remark).
import type { AllocationRow } from "@/types/payments";

export function applyHeaderRemark(rows: AllocationRow[], headerRemark: string): AllocationRow[] {
  return rows.map((r) => (r.remarkOverridden || r.remark === headerRemark ? r : { ...r, remark: headerRemark }));
}

export function setRowRemark(row: AllocationRow, value: string): AllocationRow {
  return { ...row, remark: value, remarkOverridden: true };
}
