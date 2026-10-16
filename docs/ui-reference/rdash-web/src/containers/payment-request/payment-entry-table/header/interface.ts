import type { Dispatch, SetStateAction } from "react";
import type { ILingui } from "../../../../hooks/useLingui";
import type { IPaymentEntryTableFilterData } from "../interface";

export interface IPaymentEntryTableHeaderProps {
  filterData: IPaymentEntryTableFilterData;
  setFilterData: Dispatch<SetStateAction<IPaymentEntryTableFilterData>>;
  selectedTab: string;
  i18n: ILingui;
}
