import type { PAYMENT_ENTRY_CONTEXT } from "../../../../enumerations/payment-entry.enum";
import type { ILingui } from "../../../../hooks/useLingui";
import type { IPaymentEntryListItem } from "../../../../models/payment-entry";
import type { IPaymentRequestDialogFormData } from "../interface";

export interface IPaymentRequestDetailProps {
  formData: IPaymentRequestDialogFormData;
  isLoading: boolean;
  status: string;
  handleCancelOrDeletePaymentEntry: (id: string) => void;
  handleCreatePaymentEntry: (data: IPaymentEntryListItem) => void;
  i18n: ILingui;
  paymentRequestId: string;
  clientId: string;
  refreshPaymentRequestDetail: () => void;
  paymentEntryContext: PAYMENT_ENTRY_CONTEXT;
  handlePaymentEntryUpdateSuccess: (data: IPaymentEntryListItem) => void;
}
