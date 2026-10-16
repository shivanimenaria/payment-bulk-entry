import { useState } from "react";
import { PAYMENT_REQUEST_TABS } from "../../../constants/payment-request.constants";
import { useAppSelector } from "../../../hooks/store";
import useAppParams from "../../../hooks/useAppParams";
import { projectSelector } from "../../../reducers/project.reducer";
import { useGetVendorPaymentRequestAmountsQuery } from "../../../services/payment-request.service";
import { BillIcon, OrderMainIcon, PaymentDoneIcon } from "../../../statics/images";
import {
  getPaymentEntryQueryParams,
  getPaymentRequestModule,
  getVendorPaymentRequestSummaryQueryParams,
} from "../../../utils/payment-request";
import type { IPaymentRequestAmountCardsProps } from "./interface";
import PaymentRequestAmountCard from "./payment-request-amount-card";
import "./style.css";

const VendorPaymentRequestAmountCards = (props: IPaymentRequestAmountCardsProps) => {
  const { projectId = "", vendorId = "", orgId = "" } = useAppParams();
  const [isBreakUpVisible, setIsBreakUpVisible] = useState(false);
  const store = {
    projectImmediateClientId: useAppSelector(projectSelector.immediateClientId),
  };

  const getParam = () => {
    if (props.selectedTab === PAYMENT_REQUEST_TABS.paymentEntries)
      return getPaymentEntryQueryParams({
        filterData: props.paymentEntryFilterData,
        selectedTab: props.selectedTab,
        module: getPaymentRequestModule(),
        projectId,
        vendorId,
        clientId: orgId,
        projectImmediateClientId: store.projectImmediateClientId,
        currencyId: props.i18n?.currency?.id,
      });
    return getVendorPaymentRequestSummaryQueryParams({
      filterData: props.paymentRequestFilterData,
      selectedTab: props.selectedTab,
      module: getPaymentRequestModule(),
      projectId,
      vendorId,
      clientId: orgId,
      projectImmediateClientId: store.projectImmediateClientId,
      currencyId: props.i18n?.currency?.id,
    });
  };

  const { data, isLoading } = useGetVendorPaymentRequestAmountsQuery(
    {
      params: getParam(),
    },
    { refetchOnMountOrArgChange: true }
  );

  if (props.selectedTab === PAYMENT_REQUEST_TABS.paymentEntries) {
    return (
      <div className="bg-white border border-box rounded-6 flex items-center p-15 justify-between text-344054 font-size-18 font-semi-bold">
        <div>Payment Done</div>
        <div>
          {props.i18n.currencySymbol} {props.i18n.number(data?.paymentDone?.totalAmount)}
        </div>
      </div>
    );
  }

  return (
    <div className="display-flex gap-15 flex-wrap">
      {data?.paymentRequested && (
        <PaymentRequestAmountCard
          title="Payment Requested"
          count={data.paymentRequested.count}
          icon={
            <OrderMainIcon
              color="#000"
              height={14}
            />
          }
          value={data.paymentRequested.totalAmount}
          baseAmount={data.paymentRequested.baseAmount}
          taxAmount={data.paymentRequested.taxAmount}
          withAmountBreakUp={data.paymentRequested.baseAmount !== undefined}
          isBreakUpVisible={isBreakUpVisible}
          handleClick={() => setIsBreakUpVisible((prev) => !prev)}
          isLoading={isLoading}
          i18n={props.i18n}
        />
      )}
      {data?.paymentApproved && (
        <PaymentRequestAmountCard
          title="Payment Approved"
          count={data.paymentApproved.count}
          icon={
            <BillIcon
              color="#000"
              height={14}
            />
          }
          value={data.paymentApproved.totalAmount}
          baseAmount={data.paymentApproved.baseAmount}
          taxAmount={data.paymentApproved.taxAmount}
          withAmountBreakUp={data.paymentApproved.baseAmount !== undefined}
          isBreakUpVisible={isBreakUpVisible}
          handleClick={() => setIsBreakUpVisible((prev) => !prev)}
          isLoading={isLoading}
          i18n={props.i18n}
        />
      )}
      {data?.pendingApproval && (
        <PaymentRequestAmountCard
          title="Pending Approval"
          count={data.pendingApproval.count}
          icon={
            <BillIcon
              color="#000"
              height={14}
            />
          }
          value={data.pendingApproval.totalAmount}
          baseAmount={data.pendingApproval.baseAmount}
          taxAmount={data.pendingApproval.taxAmount}
          withAmountBreakUp={data.pendingApproval.baseAmount !== undefined}
          isBreakUpVisible={isBreakUpVisible}
          handleClick={() => setIsBreakUpVisible((prev) => !prev)}
          isLoading={isLoading}
          i18n={props.i18n}
        />
      )}
      {data?.paymentDue && (
        <PaymentRequestAmountCard
          title="Payment Due"
          count={data.paymentDue.count}
          icon={
            <div style={{ transform: "scaleX(-1)" }}>
              <PaymentDoneIcon
                color="#000"
                height={14}
              />
            </div>
          }
          value={data.paymentDue.totalAmount}
          isLoading={isLoading}
          i18n={props.i18n}
        />
      )}
      {data?.paymentDone && (
        <PaymentRequestAmountCard
          title="Payments Done"
          count={data.paymentDone.count}
          icon={
            <PaymentDoneIcon
              color="#000"
              height={14}
            />
          }
          value={data.paymentDone.totalAmount}
          isLoading={isLoading}
          i18n={props.i18n}
        />
      )}
    </div>
  );
};

export default VendorPaymentRequestAmountCards;
