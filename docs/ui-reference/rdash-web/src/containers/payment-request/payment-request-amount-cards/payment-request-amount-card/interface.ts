import type { ILingui } from "../../../../hooks/useLingui";

export interface IPaymentRequestAmountCardProps {
  icon: React.ReactNode;
  title: string;
  value: string;
  count?: number;
  baseAmount?: string;
  taxAmount?: string;
  withAmountBreakUp?: boolean;
  isBreakUpVisible?: boolean;
  handleClick?: () => void;
  isLoading: boolean;
  i18n: ILingui;
}
