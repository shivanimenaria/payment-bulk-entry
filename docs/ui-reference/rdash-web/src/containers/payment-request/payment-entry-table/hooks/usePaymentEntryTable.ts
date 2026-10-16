import { useEffect, useState } from "react";
import { PAYMENT_ENTRY_MODULE } from "../../../../enumerations/payment-entry.enum";
import { useAppDispatch, useAppSelector } from "../../../../hooks/store";
import useAppParams from "../../../../hooks/useAppParams";
import type { ILingui } from "../../../../hooks/useLingui";
import type { IPaymentEntry } from "../../../../models";
import { projectSelector } from "../../../../reducers/project.reducer";
import { paymentEntryApi } from "../../../../services/payment-entry.service";
import { paymentRequestApi, useLazyGetPaymentEntryListQuery } from "../../../../services/payment-request.service";
import { getPaymentEntryListApiEndpoint, getPaymentEntryQueryParams, getPaymentRequestModule } from "../../../../utils/payment-request";
import type { IPaymentEntryTableFilterData } from "../interface";

interface IUsePaymentEntryTableProps {
  selectedTab: string;
  i18n?: ILingui;
  paymentEntryFilterData: IPaymentEntryTableFilterData;
}

const usePaymentEntryTable = (props: IUsePaymentEntryTableProps) => {
  const [paymentEntryList, setPaymentEntryList] = useState<IPaymentEntry[]>([]);
  const [hasMorePaymentEntries, setHasMorePaymentEntries] = useState(false);
  const [cancelPaymentEntryId, setCancelPaymentEntryId] = useState("");
  const [editPaymentEntryId, setEditPaymentEntryid] = useState("");

  const { projectId = "", vendorId = "", orgId = "" } = useAppParams();
  const paymentEntrymodule = getPaymentRequestModule();

  const dispatch = useAppDispatch();

  const store = {
    projectImmediateClientId: useAppSelector(projectSelector.immediateClientId),
  };
  const [cancelPaymentEntry, cancelPaymentEntryState] = paymentEntryApi.useCancelPaymentEntryMutation();
  const [fetchPaymentEntryList, { isLoading: isPaymentEntryListLoading, isFetching: isPaymentEntryListFetching }] =
    useLazyGetPaymentEntryListQuery();

  const fetchMorePaymentEntries = (offset: number) => {
    fetchPaymentEntryList({
      apiEndpoint: getPaymentEntryListApiEndpoint(),
      params: getPaymentEntryQueryParams(
        {
          filterData: props.paymentEntryFilterData,
          module: paymentEntrymodule,
          selectedTab: props.selectedTab,
          projectId,
          vendorId,
          clientId: orgId,
          projectImmediateClientId: store.projectImmediateClientId,
          currencyId: props.i18n?.currency?.id,
        },
        offset
      ),
    })
      .unwrap()
      .then((data) => {
        setHasMorePaymentEntries(data.next !== null);
        if (offset === 0) {
          setPaymentEntryList(data.results);
        } else {
          setPaymentEntryList((prev) => [...prev, ...data.results]);
        }
      });
  };

  useEffect(() => {
    fetchMorePaymentEntries(0);
  }, [props.selectedTab, props.paymentEntryFilterData, props.i18n?.currency.id]);

  const handleCloseCancelPaymentEntry = () => {
    setCancelPaymentEntryId("");
  };

  const handleCancelPaymentEntry = () => {
    cancelPaymentEntry({ module: PAYMENT_ENTRY_MODULE.PAYMENT_REQUEST, paymentEntryId: cancelPaymentEntryId })
      .unwrap()
      .then(() => {
        setPaymentEntryList((prev) => prev.map((item) => (item.id === cancelPaymentEntryId ? { ...item, isCancelled: true } : item)));
        handleCloseCancelPaymentEntry();
        dispatch(paymentRequestApi.util.invalidateTags(["PaymentRequestAmounts"]));
        dispatch(paymentRequestApi.util.invalidateTags(["PaymentEntryList"]));
      });
  };

  const handleUpdateListData = (id: string, data: IPaymentEntry) => {
    setPaymentEntryList((prev) => prev.map((item) => (item.id === id ? data : item)));
  };

  const handleCancel = (id: string) => {
    setCancelPaymentEntryId(id);
  };

  const handleEdit = (id: string) => {
    setEditPaymentEntryid(id);
  };

  return {
    state: {
      paymentEntryList,
      cancelPaymentEntryId,
      isPaymentEntryListFetching,
      isPaymentEntryListLoading,
      hasMorePaymentEntries,
      cancelPaymentEntryState,
      module: paymentEntrymodule,
      editPaymentEntryId,
    },
    handlers: {
      handleCloseCancelPaymentEntry,
      handleCancelPaymentEntry,
      fetchMorePaymentEntries,
      setCancelPaymentEntryId,
      handleUpdateListData,
      handleCancel,
      handleEdit,
      setEditPaymentEntryid,
    },
  };
};

export default usePaymentEntryTable;
