import type { IPaymentEntry } from "../../../../models";

export interface IPaymentEntryRowProps {
  data: IPaymentEntry;
  index: number;
  handleCancel: (id: string) => void;
  handleEdit: (id: string) => void;
  openPaymentEntryDetail: (id: string) => void;
}
