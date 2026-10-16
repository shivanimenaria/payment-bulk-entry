import { type IRDStepperOption, RDStepper } from "@rdash-tech/web-ui-components";
import { useNavigate } from "react-router-dom";
import { PAYMENT_REQUEST_TABS } from "../../../constants/payment-request.constants";
import useAppParams from "../../../hooks/useAppParams";
import { getFilledRoute, getSearchParamValue } from "../../../utils/common-methods";
import { getPaymentRequestTableStepperRoute } from "../../../utils/payment-request";
import type { IPaymentRequestTableStepperProps } from "./interface";

const PaymentRequestTableStepper = (props: IPaymentRequestTableStepperProps) => {
  const navigate = useNavigate();
  const { projectId = "", vendorId = "", orgId = "" } = useAppParams();
  const tab = getSearchParamValue("tab") || "";
  const options: IRDStepperOption[] = [
    {
      id: PAYMENT_REQUEST_TABS.allRequests,
      name: "All Requests",
    },
    {
      id: PAYMENT_REQUEST_TABS.pendingRequests,
      name: "Pending Requests",
    },
    {
      id: PAYMENT_REQUEST_TABS.approvedRequests,
      name: "Approved Requests",
    },
    {
      id: PAYMENT_REQUEST_TABS.paymentDue,
      name: "Payment Due",
    },
    {
      id: PAYMENT_REQUEST_TABS.paymentEntries,
      name: "Payment Entries",
    },
  ];

  const onStepperClick = (id: string) => {
    props.setSelectedTab(id);
    navigate(getFilledRoute(getPaymentRequestTableStepperRoute(), { projectId, vendorId, orgId, tab: id }));
  };

  return (
    <div className="navigation-stepper-container">
      <RDStepper
        options={options}
        onStepperClick={onStepperClick}
        selectedTabId={tab}
      />
    </div>
  );
};

export default PaymentRequestTableStepper;
