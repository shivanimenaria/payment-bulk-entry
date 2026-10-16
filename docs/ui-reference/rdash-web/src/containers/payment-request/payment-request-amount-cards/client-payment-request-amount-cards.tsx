import useAppParams from "../../../hooks/useAppParams";
import { useGetClientPaymentRequestAmountsQuery } from "../../../services/payment-request.service";
import { BillIcon, OrderMainIcon, PaymentDoneIcon } from "../../../statics/images";
import type { IPaymentRequestAmountCardsProps } from "./interface";
import PaymentRequestAmountCard from "./payment-request-amount-card";
import "./style.css";

const ClientPaymentRequestAmountCards = (props: IPaymentRequestAmountCardsProps) => {
  const { projectId, orgId } = useAppParams();

  const { data, isLoading } = useGetClientPaymentRequestAmountsQuery(
    {
      params: {
        project_id: projectId,
        client_id: orgId,
        currency_id: props.i18n?.currency?.id,
      },
    },
    { refetchOnMountOrArgChange: true }
  );

  return (
    <div className="display-flex gap-15 flex-wrap">
      <PaymentRequestAmountCard
        title="Payment Requested"
        count={data?.paymentRequestedCount || 0}
        icon={
          <OrderMainIcon
            color="#000"
            height={14}
          />
        }
        value={data?.paymentRequested || "0"}
        isLoading={isLoading}
        i18n={props.i18n}
      />
      <PaymentRequestAmountCard
        title="Payment Approved"
        count={data?.paymentApprovedCount || 0}
        icon={
          <BillIcon
            color="#000"
            height={14}
          />
        }
        value={data?.paymentApproved || "0"}
        isLoading={isLoading}
        i18n={props.i18n}
      />
      <PaymentRequestAmountCard
        title="Pending Approval"
        count={data?.pendingApprovalCount || 0}
        icon={
          <BillIcon
            color="#000"
            height={14}
          />
        }
        value={data?.pendingApproval || "0"}
        isLoading={isLoading}
        i18n={props.i18n}
      />
      <PaymentRequestAmountCard
        title="Payment Due"
        icon={
          <div style={{ transform: "scaleX(-1)" }}>
            <PaymentDoneIcon
              color="#000"
              height={14}
            />
          </div>
        }
        value={data?.paymentDue || "0"}
        isLoading={isLoading}
        i18n={props.i18n}
      />
      <PaymentRequestAmountCard
        title="Payments Done"
        count={data?.paymentDoneCount || 0}
        icon={
          <PaymentDoneIcon
            color="#000"
            height={14}
          />
        }
        value={data?.paymentDone || "0"}
        isLoading={isLoading}
        i18n={props.i18n}
      />
    </div>
  );
};

export default ClientPaymentRequestAmountCards;
