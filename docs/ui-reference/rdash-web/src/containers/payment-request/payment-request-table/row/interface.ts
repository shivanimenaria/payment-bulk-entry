import type { Dispatch, SetStateAction } from "react";
import type { IPaymentRequest } from "../../../../models";

export interface IPaymentRequestRowProps {
  data: IPaymentRequest;
  index: number;
  selectedTab: string;
  setCancelPaymentRequestId: Dispatch<SetStateAction<string>>;
  className?: string;
}
