import { PAYMENT_REQUEST_MODULE } from "../../../constants/payment-request.constants";
import { getPaymentRequestModule } from "../../../utils/payment-request";
import ClientPaymentRequestAmountCards from "./client-payment-request-amount-cards";
import type { IPaymentRequestAmountCardsProps } from "./interface";
import VendorPaymentRequestAmountCards from "./vendor-payment-request-amount-cards";

const PaymentRequestAmountCards = (props: IPaymentRequestAmountCardsProps) => {
  const module = getPaymentRequestModule();

  const isVendorPayments = [PAYMENT_REQUEST_MODULE.orderPaymentRequest, PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest].includes(module);

  if (isVendorPayments) {
    return <VendorPaymentRequestAmountCards {...props} />;
  }

  return <ClientPaymentRequestAmountCards {...props} />;
};

export default PaymentRequestAmountCards;
