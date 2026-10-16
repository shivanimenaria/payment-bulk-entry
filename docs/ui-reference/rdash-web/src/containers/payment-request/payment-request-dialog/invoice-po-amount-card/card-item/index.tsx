import clsx from "clsx";
import type { ICardItemProps } from "../interface";

const CardItem = ({ i18n, ...props }: ICardItemProps) => {
  return (
    <div
      className={clsx(
        "form-amount-card p-10 rounded-6 display-flex gap-5 flex-col min-w-0 overflow-hidden",
        { "form-amount-card-stretched": props.isStretched },
        props.className
      )}
    >
      <div className="display-flex justify-between items-center min-w-0">
        <div className="font-size-12 font-semi-bold display-flex gap-5 items-center min-w-0">
          <span className="form-amount-card-header text-7f8ea4 text-truncate">{props.title}</span>
          {props.infoNode && props.infoNode}
        </div>
        <div
          className="font-size-14 font-medium max-width-50 min-w-0 text-truncate text-right"
          title={props.amount}
        >
          {props.amount}
        </div>
      </div>
      {props?.taxAmount && props.baseAmount && (
        <div className="display-flex justify-end items-center font-size-12 font-medium text-333C48">
          <div
            className="text-truncate min-w-0 max-w-full text-right"
            title={`${props.baseAmount} + ${props.taxAmount} ${i18n.tax.name}`}
          >
            {props.baseAmount} + {props.taxAmount} {i18n.tax.name}
          </div>
        </div>
      )}
    </div>
  );
};

export default CardItem;
