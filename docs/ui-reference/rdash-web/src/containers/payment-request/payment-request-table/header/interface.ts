import type { Dispatch, SetStateAction } from "react";
import type { ILingui } from "../../../../hooks/useLingui";
import type { IPaymentRequestTableFilterData } from "../interface";

export interface IRequestTableHeaderProps {
  filterData: IPaymentRequestTableFilterData;
  setFilterData: Dispatch<SetStateAction<IPaymentRequestTableFilterData>>;
  selectedTab: string;
  i18n: ILingui;
  className?: string;
}
