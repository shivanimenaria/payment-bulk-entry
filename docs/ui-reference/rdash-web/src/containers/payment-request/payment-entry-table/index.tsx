import { RDPromptDelete, RDTableBody } from "@rdash-tech/web-ui-components";
import { useState } from "react";
import InfiniteVirtualScrollList from "../../../components/infinite-virtual-scroll-list";
import CreatePaymentEntry from "../../../components/payment-entry/create-payment-entry";
import PaymentEntryDetail from "../../../components/payment-entry/payment-entry-detail";
import { ModalEnum } from "../../../enumerations/modal.enum";
import { PAYMENT_ENTRY_MODULE } from "../../../enumerations/payment-entry.enum";
import NoPaymentEntry from "../no-payment-entry";
import PaymentEntryTableHeader from "./header";
import usePaymentEntryTable from "./hooks/usePaymentEntryTable";
import type { IPaymentEntryTableProps } from "./interface";
import PaymentEntryRowsLoader from "./loader";
import PaymentEntryTableRow from "./row";
import "./style.css";

const PaymentEntryTable = (props: IPaymentEntryTableProps) => {
  const { state, handlers } = usePaymentEntryTable({
    selectedTab: props.selectedTab,
    i18n: props.i18n,
    paymentEntryFilterData: props.paymentEntryFilterData,
  });
  const [paymentEntryDetailId, setPaymentEntryDetailId] = useState("");

  const closePaymentEntryDetail = () => {
    setPaymentEntryDetailId("");
  };

  const openPaymentEntryDetail = (id: string) => {
    setPaymentEntryDetailId(id);
  };

  return (
    <>
      <div className="h-full border-box display-flex flex-column flex-1 overflow-hidden">
        <PaymentEntryTableHeader
          filterData={props.paymentEntryFilterData}
          setFilterData={props.setPaymentEntryFilterData}
          selectedTab={props.selectedTab}
          i18n={props.i18n}
        />
        <RDTableBody className="bg-white display-flex flex-1 overflow-hidden">
          <div className="h-full w-full">
            {!state.isPaymentEntryListFetching && !state.isPaymentEntryListLoading && state.paymentEntryList.length === 0 && (
              <NoPaymentEntry />
            )}
            {(state.isPaymentEntryListFetching || state.isPaymentEntryListLoading) && state.paymentEntryList.length === 0 ? (
              <PaymentEntryRowsLoader noOfRows={10} />
            ) : (
              <InfiniteVirtualScrollList
                defaultHight={66}
                itemsCount={state.paymentEntryList.length}
                hasMoreItems={state.hasMorePaymentEntries}
                fetchMoreItems={handlers.fetchMorePaymentEntries}
                rowRenderer={({ index }) => {
                  return (
                    <PaymentEntryTableRow
                      key={index}
                      data={state.paymentEntryList[index]}
                      index={index}
                      handleCancel={handlers.handleCancel}
                      handleEdit={handlers.handleEdit}
                      openPaymentEntryDetail={openPaymentEntryDetail}
                    />
                  );
                }}
                listClassName="vertical-scrollbar"
                isLoading={state.isPaymentEntryListFetching}
                rowLoadingComponent={<PaymentEntryRowsLoader noOfRows={1} />}
              />
            )}
          </div>
        </RDTableBody>
      </div>
      {state.cancelPaymentEntryId && (
        <RDPromptDelete
          open={!!state.cancelPaymentEntryId}
          title="Are you sure you want to cancel this payment entry?"
          containedBtnText="Yes"
          outlinedBtnText="No"
          containedBtnOnClick={handlers.handleCancelPaymentEntry}
          close={handlers.handleCloseCancelPaymentEntry}
          containedBtnLoading={state.cancelPaymentEntryState.isLoading}
        />
      )}
      {paymentEntryDetailId && (
        <PaymentEntryDetail
          paymentEntryId={paymentEntryDetailId}
          close={closePaymentEntryDetail}
          i18n={props.i18n}
          module={PAYMENT_ENTRY_MODULE.PAYMENT_REQUEST}
          handleCancel={handlers.handleCancel}
          handleEdit={handlers.handleEdit}
        />
      )}
      {state.editPaymentEntryId && (
        <CreatePaymentEntry
          handleClose={() => handlers.setEditPaymentEntryid("")}
          i18n={props.i18n}
          module={PAYMENT_ENTRY_MODULE.PAYMENT_REQUEST}
          mode={ModalEnum.EDIT}
          paymentEntryId={state.editPaymentEntryId}
        />
      )}
    </>
  );
};

export default PaymentEntryTable;
