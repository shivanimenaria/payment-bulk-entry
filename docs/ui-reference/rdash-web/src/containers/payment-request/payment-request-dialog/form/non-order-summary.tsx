import { PAYMENT_REQUEST_MODULE } from "../../../../constants/payment-request.constants";
import { useLingui } from "../../../../hooks/useLingui";
import { useGetClientPaymentAmountDataQuery, useGetVendorPaymentAmountDataQuery } from "../../../../services/payment-request.service";
import { getPaymentRequestModule } from "../../../../utils/payment-request";

interface INonOrderSummaryProps {
  vendorId: string;
  clientId: string;
  projectId: string;
}

const NonOrderSummary = (props: INonOrderSummaryProps) => {
  const module = getPaymentRequestModule();
  const vendorPaymentRequest =
    module === PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest || module === PAYMENT_REQUEST_MODULE.orderPaymentRequest;
  const clientPaymentRequest =
    module === PAYMENT_REQUEST_MODULE.manageClientPaymentRequest || module === PAYMENT_REQUEST_MODULE.boqPaymentRequest;

  const { data: vendorPaymentData } = useGetVendorPaymentAmountDataQuery(
    {
      id: props.vendorId,
      projectId: props.projectId,
    },
    {
      skip: !vendorPaymentRequest || !props.vendorId,
      refetchOnMountOrArgChange: true,
    }
  );
  const { data: clientPaymentData } = useGetClientPaymentAmountDataQuery(
    {
      id: props.clientId,
      projectId: props.projectId,
    },
    {
      skip: !clientPaymentRequest || !props.clientId,
      refetchOnMountOrArgChange: true,
    }
  );
  const i18n = useLingui();

  if (!vendorPaymentData && !clientPaymentData) return null;
  const requestedAmount = vendorPaymentRequest ? vendorPaymentData?.requestedAmount : clientPaymentData?.requestedAmount;
  const paidAmount = vendorPaymentRequest ? vendorPaymentData?.paidAmount : clientPaymentData?.paidAmount;

  return (
    <div>
      <div
        className="payment-request-amount-summary no-order font-size-12 items-center grid grid-cols-2"
        style={{
          height: "auto",
          padding: 0,
        }}
      >
        <div className="px-10 py-5">
          <div>Already Requested</div>
          <div className="font-gilroy-semi-bold">
            {i18n.currencySymbol}
            {i18n.number(requestedAmount || "0")}
          </div>
        </div>
        <div
          className="px-10 py-5"
          style={{
            borderLeft: "dashed 1px rgba(236, 34, 39, 0.3)",
          }}
        >
          <div>Paid Amount</div>
          <div className="font-gilroy-semi-bold">
            {i18n.currencySymbol}
            {i18n.number(paidAmount || "0")}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NonOrderSummary;
