import { RDLabel } from "@rdash-tech/web-ui-components";
import clsx from "clsx";
import useMousePointerHint from "../../../../hooks/useMousePointerHint";
import { Skeleton } from "../../../../mui-imports";
import type { IPaymentRequestAmountCardProps } from "./interface";
import "./style.css";

const PaymentRequestAmountCard = (props: IPaymentRequestAmountCardProps) => {
  const hasBreakUp = props.withAmountBreakUp && props.baseAmount !== undefined;
  const { pointerPosition, handleMouseEnter, handleMouseLeave, handleMouseMove } = useMousePointerHint({
    isEnabled: !!props.withAmountBreakUp,
  });

  if (props.isLoading) {
    return (
      <div className="bg-white p-15 display-flex flex-column payment-request-amount-card border-box border rounded-6 gap-10 flex-1">
        <div className="display-flex items-center gap-5">
          {props.icon}
          <Skeleton
            height={16}
            width={100}
            variant="rounded"
          />
          <Skeleton
            height={16}
            width={20}
            variant="rounded"
          />
        </div>
        <Skeleton
          height={24}
          width={115}
          variant="rounded"
        />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "bg-white p-15 display-flex flex-column payment-request-amount-card border-box border rounded-6 gap-10 flex-1 text-344054",
        {
          "cursor-pointer": hasBreakUp,
        }
      )}
      onClick={hasBreakUp ? props.handleClick : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
    >
      <div className="display-flex justify-between items-center gap-10">
        <div className="display-flex items-center gap-5 white-space-no-wrap">
          {props.icon}
          <div className="font-semi-bold font-size-16">{props.title}</div>
          {props.count !== undefined && (
            <RDLabel
              variant="contained"
              color="grey"
            >
              {props.count}
            </RDLabel>
          )}
        </div>
        <div className="display-flex items-center gap-5">
          {hasBreakUp && !props.isBreakUpVisible && (
            <span className="text-98a2b3 font-size-10 font-medium white-space-no-wrap">{`With ${props.i18n.tax.name}`}</span>
          )}
        </div>
      </div>
      <div className="display-flex flex-column gap-5">
        <div className="font-semi-bold font-size-20 display-flex align-center max-w-fit white-space-no-wrap">
          {props.i18n.currencySymbol} {props.i18n.number(props.value)}
        </div>
        {hasBreakUp && props.isBreakUpVisible && (
          <div className="flex gap-5 items-center font-size-12 font-medium max-w-fit white-space-no-wrap">
            <span>
              {props.i18n.currencySymbol} {props.i18n.number(props.baseAmount || "0")}
            </span>
            <span>+</span>
            <span>{props.i18n.tax.name}</span>
            <span>
              {props.i18n.currencySymbol} {props.i18n.number(props.taxAmount || "0")}
            </span>
          </div>
        )}
      </div>
      {props.withAmountBreakUp && pointerPosition && (
        <span
          className="payment-header-card-breakup-hint font-medium font-size-12 px-6 py-4 text-white"
          style={{ left: pointerPosition.x, top: pointerPosition.y }}
        >
          {props.isBreakUpVisible ? "Hide Breakup" : "View Breakup"}
        </span>
      )}
    </div>
  );
};

export default PaymentRequestAmountCard;
