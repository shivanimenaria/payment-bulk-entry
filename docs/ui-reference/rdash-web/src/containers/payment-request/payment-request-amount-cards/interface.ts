import type { ILingui } from "../../../hooks/useLingui";
import type { IPaymentEntryTableFilterData } from "../payment-entry-table/interface";
import type { IPaymentRequestTableFilterData } from "../payment-request-table/interface";

export interface IPaymentRequestAmountCardsProps {
  i18n: ILingui;
  selectedTab: string;
  paymentRequestFilterData: IPaymentRequestTableFilterData;
  paymentEntryFilterData: IPaymentEntryTableFilterData;
}
