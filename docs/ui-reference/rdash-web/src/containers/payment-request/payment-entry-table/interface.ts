import type { ILingui } from "../../../hooks/useLingui";

export interface IPaymentEntryFilterDropDownData {
  id: string;
  name: string;
}

export interface IPaymentEntryTableFilterData {
  paymentDate: string;
  requestId: string;
  transactionId: string;
  paymentMethod: IPaymentEntryFilterDropDownData;
  vendors: IPaymentEntryFilterDropDownData[];
  requestType: IPaymentEntryFilterDropDownData;
  uploadedBy: IPaymentEntryFilterDropDownData[];
  status: string;
  paymentDone: string;
  project: IPaymentEntryFilterDropDownData[];
}

export interface IPaymentEntryTableProps {
  selectedTab: string;
  i18n: ILingui;
  paymentEntryFilterData: IPaymentEntryTableFilterData;
  setPaymentEntryFilterData: React.Dispatch<React.SetStateAction<IPaymentEntryTableFilterData>>;
}
