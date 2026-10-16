import { useEffect, useState } from "react";
import { PAYMENT_REQUEST_TABS } from "../../constants/payment-request.constants";
import { APP_ROUTE_PATH } from "../../enumerations/common.enum";
import { type ILingui, useLingui, useProjectLingui } from "../../hooks/useLingui";
import { getSearchParamValue, isRouteMatched } from "../../utils/common-methods";
import { initialFilterData, initialPaymentEntryFilterData } from "../../utils/payment-request";
import PaymentEntryTable from "./payment-entry-table";
import type { IPaymentEntryTableFilterData } from "./payment-entry-table/interface";
import PaymentRequestAmountCards from "./payment-request-amount-cards";
import PaymentRequestTable from "./payment-request-table";
import PaymentRequestTableStepper from "./payment-request-table-stepper";
import type { IPaymentRequestTableFilterData } from "./payment-request-table/interface";

interface IPaymentRequestProps {
  i18n?: ILingui;
}

const PaymentRequest = (props: IPaymentRequestProps) => {
  const tab = getSearchParamValue("tab") || "";
  const [selectedTab, setSelectedTab] = useState(tab || PAYMENT_REQUEST_TABS.allRequests);
  const [paymentRequestFilterData, setPaymentRequestFilterData] = useState<IPaymentRequestTableFilterData>(initialFilterData);
  const [paymentEntryFilterData, setPaymentEntryFilterData] = useState<IPaymentEntryTableFilterData>(initialPaymentEntryFilterData);

  const i18n =
    isRouteMatched(APP_ROUTE_PATH.BoqPaymentsFromClientViewWithoutQuery) ||
    isRouteMatched(APP_ROUTE_PATH.OrderVendorPaymentsViewWithoutQuery)
      ? useProjectLingui({ ...props.i18n })
      : useLingui({ ...props.i18n });

  useEffect(() => {
    setSelectedTab(tab || PAYMENT_REQUEST_TABS.allRequests);
  }, [tab]);

  useEffect(() => {
    setPaymentRequestFilterData(initialFilterData);
  }, [selectedTab]);

  return (
    <div className="p-20 display-flex flex-column h-full overflow-hidden border-box">
      <PaymentRequestAmountCards
        i18n={i18n}
        selectedTab={selectedTab}
        paymentRequestFilterData={paymentRequestFilterData}
        paymentEntryFilterData={paymentEntryFilterData}
      />
      <div className="border rounded-6 mt-20 display-flex flex-column flex-1 overflow-hidden">
        <PaymentRequestTableStepper setSelectedTab={setSelectedTab} />
        {selectedTab === PAYMENT_REQUEST_TABS.paymentEntries ? (
          <PaymentEntryTable
            selectedTab={selectedTab}
            i18n={i18n}
            paymentEntryFilterData={paymentEntryFilterData}
            setPaymentEntryFilterData={setPaymentEntryFilterData}
          />
        ) : (
          <PaymentRequestTable
            selectedTab={selectedTab}
            i18n={i18n}
            filterData={paymentRequestFilterData}
            setFilterData={setPaymentRequestFilterData}
          />
        )}
      </div>
    </div>
  );
};

export default PaymentRequest;
