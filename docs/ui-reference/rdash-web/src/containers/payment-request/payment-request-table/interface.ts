import type { Dispatch, SetStateAction } from "react";
import type { ILingui } from "../../../hooks/useLingui";
import type { IDateRangeFilterValue } from "../../../models/common.interface";

export interface IPaymentRequestFilterDropDownData {
  id: string;
  name: string;
}
export type IPaymentRequestSelectedProject = IPaymentRequestFilterDropDownData;

export interface IPaymentRequestTableFilterData {
  requestId: string;
  vendors: IPaymentRequestFilterDropDownData[];
  requestDate: string;
  requestType: IPaymentRequestFilterDropDownData;
  requestedBy: IPaymentRequestFilterDropDownData[];
  status: string;
  requestedAmount: string;
  paymentDone: string;
  project: IPaymentRequestFilterDropDownData[];
  paymentDue: string;
  dueDate: IDateRangeFilterValue;
}

export interface IPaymentRequestTableProps {
  selectedTab: string;
  i18n: ILingui;
  filterData: IPaymentRequestTableFilterData;
  setFilterData: Dispatch<SetStateAction<IPaymentRequestTableFilterData>>;
}
