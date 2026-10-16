import { useSearchParams } from "react-router-dom";
import { ApprovalRequestTimeLine } from "../../../../components/approval-request";
import { PAYMENT_REQUEST_MODE } from "../../../../constants/payment-request.constants";
import type { IPaymentRequestTimelineProps } from "./interface";

const PaymentRequestTimeline = (props: IPaymentRequestTimelineProps) => {
  const [search] = useSearchParams();
  const mode = search.get("mode");

  if (mode !== PAYMENT_REQUEST_MODE.detail) return null;

  return (
    <div className="mt-20">
      <ApprovalRequestTimeLine
        i18n={props.i18n}
        requestId={props.requestId}
        accordion={{
          className: "border rounded-6",
          summaryClassName: "align-center px-20",
          summaryContentClassName: "py-10",
          detailsClassName: "px-20 border-t",
        }}
      />
    </div>
  );
};

export default PaymentRequestTimeline;
