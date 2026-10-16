import type { ILingui } from "../../../../../hooks/useLingui";

export interface IPOPaidTillDate {
  poNumber: string;
  amount: string;
}

export interface IInvoicePaidTillDate {
  invoiceNumber: string;
  amount: string;
}

export interface IPaidTillDateDetails {
  summaryText: string;
  poPaidTillDate: IPOPaidTillDate[];
  invoicePaidTillDate: IInvoicePaidTillDate[];
}

export interface IPaidTillDateProps {
  isLoading?: boolean;
  paymentRequestId: string;
  paidTillDateAmount?: string;
  i18n: ILingui;
}

export interface IPaidTillDateInfoProps {
  paymentRequestId: string;
  i18n: ILingui;
}
