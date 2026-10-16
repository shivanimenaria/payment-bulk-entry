import type { ReactNode } from "react";
import type { ILingui } from "../../../../hooks/useLingui";
import type {
  IPaymentRequestFormAmountData,
  IPaymentRequestInvoiceDropdownData,
  IPaymentRequestInvoiceTotalData,
  IPaymentRequestPoDropdownData,
} from "../../../../models";

export interface IInvoicePoAmountCardProps {
  i18n: ILingui;
  po: IPaymentRequestPoDropdownData;
  requestType: string;
  invoicePoCardData: IPaymentRequestFormAmountData | null;
  invoice: IPaymentRequestInvoiceDropdownData;
}

export interface ICardItemProps {
  amount: string;
  baseAmount?: string;
  taxAmount?: string;
  i18n: ILingui;
  title: string;
  className?: string;
  isStretched?: boolean;
  infoNode?: ReactNode;
}

export interface ICreditNoteToolTipSectionProps {
  title: string;
  amount: string;
  taxAmount: string;
  baseAmount: string;
  i18n: ILingui;
}

export interface ICreditNoteToolTipProps {
  getFormattedAmount: (amount: string) => string;
  i18n: ILingui;
  invoiceTotalData?: IPaymentRequestInvoiceTotalData;
}
