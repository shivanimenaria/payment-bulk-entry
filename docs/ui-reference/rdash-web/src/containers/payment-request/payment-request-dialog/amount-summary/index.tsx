import type { ILingui } from "../../../../hooks/useLingui";
import type { getRequestAmountsType } from "../hooks/usePaymentRequestDialog";

interface IAmountSummaryProps {
  getRequestAmounts: getRequestAmountsType;
  i18n: ILingui;
}

const AmountSummary = ({ i18n, getRequestAmounts }: IAmountSummaryProps) => {
  const { requestAmount } = getRequestAmounts();

  return (
    <div className="display-flex justify-between items-center border-b  border-secondary px-20 py-10">
      <div className="font-size-12 text-3f3f50">Total Request Amount </div>
      <div className="font-size-14 font-semi-bold">
        {i18n.currencySymbol} {i18n.number(requestAmount)}
      </div>
    </div>
  );
};

export default AmountSummary;
