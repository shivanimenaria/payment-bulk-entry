import type { Dispatch, SetStateAction } from "react";
import type { PAYMENT_ENTRY_CONTEXT } from "../../../../enumerations/payment-entry.enum";
import type { ILingui } from "../../../../hooks/useLingui";
import type { IPaymentRequestFormAmountData } from "../../../../models";
import type { IPaymentEntryListItem } from "../../../../models/payment-entry";
import type { IPaymentRequestSelectedProject } from "../../payment-request-table/interface";
import type { getRequestAmountsType } from "../hooks/usePaymentRequestDialog";
import type { IPaymentRequestDialogFormData, IPaymentRequestFormErrors } from "../interface";

export interface ICreateEditPaymentRequestFormProps {
  isLoading: boolean;
  formData: IPaymentRequestDialogFormData;
  setFormData: Dispatch<SetStateAction<IPaymentRequestDialogFormData>>;
  errors: IPaymentRequestFormErrors;
  setErrors: Dispatch<SetStateAction<IPaymentRequestFormErrors>>;
  project: IPaymentRequestSelectedProject;
  getProjectVendorAndClientId: () => {
    projectId: string;
    vendorId: string;
    clientId: string;
  };
  mode?: string;
  type?: string;
  handleCancelOrDeletePaymentEntry: (id: string) => void;
  handleCreatePaymentEntry: (data: IPaymentEntryListItem) => void;
  projectVendorId: string;
  projectClientId: string;
  i18n: ILingui;
  getRequestAmounts: getRequestAmountsType;
  invoicePoCardData: IPaymentRequestFormAmountData | null;
  paymentEntryContext: PAYMENT_ENTRY_CONTEXT;
  handlePaymentEntryUpdateSuccess: (data: IPaymentEntryListItem) => void;
}
