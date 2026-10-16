import { RDDropdownWithButton, RDTableBody, RDTableFooter } from "@rdash-tech/web-ui-components";
import { useMemo } from "react";
import { RequestCancelModal } from "../../../components/approval-request";
import SelectProject from "../../../components/approval-request/select-project-modal";
import InfiniteVirtualScrollList from "../../../components/infinite-virtual-scroll-list";
import { PAYMENT_REQUEST_MODULE, PAYMENT_REQUEST_TABS } from "../../../constants/payment-request.constants";
import { APPROVAL_HIERARCHY_RESOURCE_TYPE } from "../../../enumerations/approval-hierarchy.enum";
import { API_ORDER_TYPE_ENUM } from "../../../enumerations/order-expenses.enum";
import { getPaymentRequestModule, getPaymentRequestTableGridColumnsClass } from "../../../utils/payment-request";
import NoPaymentRequest from "../no-payment-request";
import PaymentRequestCreateEditDetailDialog from "../payment-request-dialog";
import PaymentRequestTableHeader from "./header";
import usePaymentRequestTable from "./hooks/usePaymentRequestTable";
import type { IPaymentRequestTableProps } from "./interface";
import PaymentRequestRowsLoader from "./loader";
import PaymentRequestTableRow from "./row";
import "./style.css";

const PaymentRequestTable = (props: IPaymentRequestTableProps) => {
  const { state, otherData, handlers } = usePaymentRequestTable({
    selectedTab: props.selectedTab,
    i18n: props.i18n,
    filterData: props.filterData,
    setFilterData: props.setFilterData,
  });
  const module = getPaymentRequestModule();

  const tableClassName = useMemo(() => {
    let className = getPaymentRequestTableGridColumnsClass();
    if (props.selectedTab === PAYMENT_REQUEST_TABS.paymentDue) className += "-payment-due";
    return className;
  }, [props.selectedTab]);

  return (
    <>
      <div className="h-full border-box display-flex flex-column flex-1 overflow-hidden">
        <PaymentRequestTableHeader
          filterData={state.filterData}
          setFilterData={handlers.setFilterData}
          selectedTab={props.selectedTab}
          i18n={props.i18n}
          className={tableClassName}
        />
        <RDTableBody className="bg-white display-flex flex-1 overflow-hidden">
          <div className="h-full w-full">
            {!state.isRequestListLoading && !state.isRequestListFetching && state.requestList.length === 0 && <NoPaymentRequest />}
            {(state.isRequestListLoading || state.isRequestListFetching) && state.requestList.length === 0 ? (
              <PaymentRequestRowsLoader noOfRows={10} />
            ) : (
              <InfiniteVirtualScrollList
                defaultHight={66}
                itemsCount={state.requestList.length}
                hasMoreItems={state.hasMoreRequests}
                fetchMoreItems={handlers.fetchMoreRequests}
                rowRenderer={({ index }) => {
                  return (
                    <PaymentRequestTableRow
                      key={index}
                      data={state.requestList[index]}
                      index={index}
                      selectedTab={props.selectedTab}
                      setCancelPaymentRequestId={handlers.setCancelPaymentRequestId}
                      className={tableClassName}
                    />
                  );
                }}
                listClassName="vertical-scrollbar"
                isLoading={state.isRequestListFetching}
                rowLoadingComponent={<PaymentRequestRowsLoader noOfRows={1} />}
              />
            )}
          </div>
        </RDTableBody>
        <RDTableFooter className="bg-white display-grid items-center create-payment-request-btn">
          <div />
          <RDDropdownWithButton
            actionItems={otherData.actionItems}
            actionMenu={handlers.actionMenu}
            buttonTitle={"+ Create Payment Request"}
            buttonVariant="text-red"
            buttonSize="medium"
            isLoading={state.isPaymentConfigLoading}
          />
        </RDTableFooter>
      </div>
      {!!otherData.mode && (
        <PaymentRequestCreateEditDetailDialog
          selectedProject={state.selectedProject}
          selectedTab={props.selectedTab}
          handleCreateUpdateSuccess={handlers.handleCreateUpdateSuccess}
          handleUpdatePaymentRequestData={handlers.handleUpdatePaymentRequestData}
          handleUpdatePaidAmountValueInRequestList={handlers.handleUpdatePaidAmountValueInRequestList}
        />
      )}
      {state.requestCreateTypeId && (
        <SelectProject
          handleNext={handlers.handleNext}
          handleClose={() => handlers.setRequestCreateTypeId(undefined)}
          requestType={APPROVAL_HIERARCHY_RESOURCE_TYPE.PAYMENT_REQUEST}
          orderType={
            module === PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest ? API_ORDER_TYPE_ENUM.OUTGOING : API_ORDER_TYPE_ENUM.INCOMING
          }
          action={handlers.getSelectProjectContextAction()}
          contextId={otherData.orgId}
        />
      )}
      {state.cancelPaymentRequestId && (
        <RequestCancelModal
          handleProceed={handlers.handleCancelPaymentRequest}
          handleClose={handlers.handleCloseCancelRequest}
          isLoading={state.cancelPaymentRequestState.isLoading}
        />
      )}
    </>
  );
};

export default PaymentRequestTable;
