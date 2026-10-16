import type { IRDActionItem } from "@rdash-tech/web-ui-components";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PAYMENT_REQUEST_CREATE_TYPE, PAYMENT_REQUEST_MODE, PAYMENT_REQUEST_MODULE } from "../../../../constants/payment-request.constants";
import { PAYMENT_REQUEST_CONTEXT_ACTIONS, PAYMENT_REQUEST_TYPES } from "../../../../enumerations/payment-request.enum";
import { useAppSelector } from "../../../../hooks/store";
import useAppParams from "../../../../hooks/useAppParams";
import type { ILingui } from "../../../../hooks/useLingui";
import useProjectContextAction from "../../../../hooks/useProjectContextAction";
import type { IPaymentRequest, ITaskManagerProjectListItem } from "../../../../models";
import { projectSelector } from "../../../../reducers/project.reducer";
import {
  paymentRequestApi,
  useCancelPaymentRequestResourceMutation,
  useLazyGetPaymentRequestListQuery,
} from "../../../../services/payment-request.service";
import { getFilledRoute } from "../../../../utils/common-methods";
import {
  checkIfThisPaymentRequestTypeAllowed,
  getPaymentRequestConfigOrgId,
  getPaymentRequestListApiEndpoint,
  getPaymentRequestListQueryParams,
  getPaymentRequestModule,
  getPaymentRequestTableStepperRoute,
} from "../../../../utils/payment-request";
import type { IPaymentRequestFilterDropDownData, IPaymentRequestTableFilterData } from "../interface";

interface IUserPaymentRequestTableProps {
  selectedTab: string;
  i18n?: ILingui;
  filterData: IPaymentRequestTableFilterData;
  setFilterData: Dispatch<SetStateAction<IPaymentRequestTableFilterData>>;
}

const usePaymentRequestTable = (props: IUserPaymentRequestTableProps) => {
  const [requestCreateTypeId, setRequestCreateTypeId] = useState<number>();
  const [hasMoreRequests, setHasMoreRequests] = useState(false);
  const [requestList, setRequestList] = useState<IPaymentRequest[]>([]);
  const [selectedProject, setSelectedProject] = useState<IPaymentRequestFilterDropDownData>({ id: "", name: "" });
  const [cancelPaymentRequestId, setCancelPaymentRequestId] = useState("");
  const { handleAction } = useProjectContextAction();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { projectId = "", vendorId = "", orgId = "" } = useAppParams();
  const mode = search.get("mode");
  const store = {
    projectImmediateClientId: useAppSelector(projectSelector.immediateClientId),
    orgId: useAppSelector((store) => store.login.organizationId),
  };

  const [fetchRequestList, { isLoading: isRequestListLoading, isFetching: isRequestListFetching }] = useLazyGetPaymentRequestListQuery();
  const [cancelPaymentRequest, cancelPaymentRequestState] = useCancelPaymentRequestResourceMutation();

  const module = getPaymentRequestModule();

  const orgIdForConfig = useMemo(
    () =>
      getPaymentRequestConfigOrgId(module, {
        clientOrgId: orgId,
        projectImmediateClientId: store.projectImmediateClientId,
        userOrgId: store.orgId,
      }),
    [module, orgId, store.projectImmediateClientId, store.orgId]
  );

  const { data: paymentRequestConfig, isLoading: isPaymentConfigLoading } = paymentRequestApi.useVendortPaymentsConfigQuery(
    orgIdForConfig,
    {
      skip: !orgIdForConfig,
    }
  );

  const fetchMoreRequests = (offset: number) => {
    fetchRequestList({
      projectId: projectId,
      apiEndpoint: getPaymentRequestListApiEndpoint(),
      params: getPaymentRequestListQueryParams({
        filterData: props.filterData,
        selectedTab: props.selectedTab,
        module,
        projectId,
        vendorId,
        clientId: orgId,
        projectImmediateClientId: store.projectImmediateClientId,
        currencyId: props.i18n?.currency?.id,
        offset,
      }),
    })
      .unwrap()
      .then((data) => {
        setHasMoreRequests(data.next !== null);
        if (offset === 0) {
          setRequestList(data.results);
        } else {
          setRequestList((prev) => [...prev, ...data.results]);
        }
      });
  };

  const handleCreateUpdateSuccess = (isCreate: boolean, data?: IPaymentRequest) => {
    if (isCreate) {
      fetchMoreRequests(0);
    } else if (data) {
      setRequestList((prev) => prev.map((item) => (item.id === data.id ? data : item)));
    }
    if (module === PAYMENT_REQUEST_MODULE.taskManagerPaymentRequest) {
      return;
    }
    navigate(
      getFilledRoute(getPaymentRequestTableStepperRoute(), {
        projectId: projectId,
        vendorId: vendorId,
        orgId: orgId,
        tab: props.selectedTab ?? "",
      })
    );
  };

  const handleUpdatePaidAmountValueInRequestList = (id: string, value: string) => {
    setRequestList((prev) => prev.map((item) => (item.id === id ? { ...item, paidAmount: value } : item)));
  };

  useEffect(() => {
    fetchMoreRequests(0);
  }, [props.selectedTab, props.filterData, props.i18n?.currency.id]);

  const actionItems: IRDActionItem[] = useMemo(
    () => [
      {
        id: 1,
        name: "PO Advance",
        isHidden: !checkIfThisPaymentRequestTypeAllowed(PAYMENT_REQUEST_TYPES.PO_ADVANCE, paymentRequestConfig),
      },
      {
        id: 2,
        name: "Against Invoice",
        isHidden: !checkIfThisPaymentRequestTypeAllowed(PAYMENT_REQUEST_TYPES.AGAINST_INVOICE, paymentRequestConfig),
      },
      {
        id: 3,
        name: "Non Order",
        isHidden: !checkIfThisPaymentRequestTypeAllowed(PAYMENT_REQUEST_TYPES.NON_ORDER, paymentRequestConfig),
      },
    ],
    [checkIfThisPaymentRequestTypeAllowed, paymentRequestConfig]
  );

  const checkContextActionAndOpenModal = (actionId: number) => {
    // this function is only called when user is inside project
    if (module === PAYMENT_REQUEST_MODULE.orderPaymentRequest) {
      switch (actionId) {
        case 1: {
          handleAction({
            context: "vendor-payment-request",
            contextId: vendorId || orgId,
            action: "create_po_advance",
            callback: () => {
              handleOpenCreateModal(actionId);
            },
          });
          break;
        }
        case 2: {
          handleAction({
            context: "vendor-payment-request",
            contextId: vendorId || orgId,
            action: "create_invoice",
            callback: () => {
              handleOpenCreateModal(actionId);
            },
          });
          break;
        }
        case 3: {
          handleAction({
            context: "vendor-payment-request",
            contextId: vendorId || orgId,
            action: "create_non_order",
            callback: () => {
              handleOpenCreateModal(actionId);
            },
          });
          break;
        }
      }
      return;
    } else if (module === PAYMENT_REQUEST_MODULE.boqPaymentRequest) {
      switch (actionId) {
        case 1: {
          handleAction({
            context: "client-payment-request",
            contextId: vendorId || orgId,
            action: "create_po_advance",
            callback: () => {
              handleOpenCreateModal(actionId);
            },
          });
          break;
        }
        case 2: {
          handleAction({
            context: "client-payment-request",
            contextId: vendorId || orgId,
            action: "create_invoice",
            callback: () => {
              handleOpenCreateModal(actionId);
            },
          });
          break;
        }
        case 3: {
          handleAction({
            context: "client-payment-request",
            contextId: vendorId || orgId,
            action: "create_non_order",
            callback: () => {
              handleOpenCreateModal(actionId);
            },
          });
          break;
        }
      }
    }
  };

  const handleOpenCreateModal = (actionId: number) => {
    switch (actionId) {
      case 1:
        navigate(
          getFilledRoute(getPaymentRequestTableStepperRoute(), {
            projectId,
            vendorId,
            orgId,
            tab: props.selectedTab,
            mode: PAYMENT_REQUEST_MODE.create,
            type: PAYMENT_REQUEST_CREATE_TYPE.poAdvance,
          })
        );
        break;
      case 2:
        navigate(
          getFilledRoute(getPaymentRequestTableStepperRoute(), {
            projectId,
            vendorId,
            orgId,
            tab: props.selectedTab,
            mode: PAYMENT_REQUEST_MODE.create,
            type: PAYMENT_REQUEST_CREATE_TYPE.againstInvoice,
          })
        );
        break;
      case 3:
        navigate(
          getFilledRoute(getPaymentRequestTableStepperRoute(), {
            projectId,
            vendorId,
            orgId,
            tab: props.selectedTab,
            mode: PAYMENT_REQUEST_MODE.create,
            type: PAYMENT_REQUEST_CREATE_TYPE.nonOrder,
          })
        );
        break;
      default:
        break;
    }
  };

  const handleNext = (project: ITaskManagerProjectListItem) => {
    setSelectedProject({ id: project.id, name: project.name });
    requestCreateTypeId && handleOpenCreateModal(requestCreateTypeId);
    setRequestCreateTypeId(undefined);
  };

  const actionMenu = (actionId: number) => {
    if ([PAYMENT_REQUEST_MODULE.manageClientPaymentRequest, PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest].includes(module)) {
      setRequestCreateTypeId(actionId);
      return;
    }
    checkContextActionAndOpenModal(actionId);
  };

  const handleUpdatePaymentRequestData = (data: IPaymentRequest) => {
    setRequestList((prev) => prev.map((item) => (item.id === data.id ? data : item)));
  };

  const handleCloseCancelRequest = () => {
    setCancelPaymentRequestId("");
  };

  const handleCancelPaymentRequest = () => {
    cancelPaymentRequest(cancelPaymentRequestId)
      .unwrap()
      .then((res) => {
        handleUpdatePaymentRequestData(res);
        handleCloseCancelRequest();
      });
  };

  const getSelectProjectContextAction = () => {
    switch (requestCreateTypeId) {
      case 1:
        return PAYMENT_REQUEST_CONTEXT_ACTIONS.CREATE_PO_REQUEST;
      case 2:
        return PAYMENT_REQUEST_CONTEXT_ACTIONS.CREATE_INVOICE_REQUEST;
      case 3:
        return PAYMENT_REQUEST_CONTEXT_ACTIONS.CREATE_NON_ORDER_REQUEST;
      default:
        return "";
    }
  };

  return {
    state: {
      filterData: props.filterData,
      requestList,
      cancelPaymentRequestId,
      isRequestListFetching,
      isRequestListLoading,
      hasMoreRequests,
      selectedProject,
      requestCreateTypeId,
      cancelPaymentRequestState,
      isPaymentConfigLoading,
    },
    otherData: { actionItems, mode, orgId },
    handlers: {
      setFilterData: props.setFilterData,
      handleCloseCancelRequest,
      handleCreateUpdateSuccess,
      handleCancelPaymentRequest,
      handleUpdatePaymentRequestData,
      actionMenu,
      handleNext,
      handleOpenCreateModal,
      fetchMoreRequests,
      setCancelPaymentRequestId,
      setSelectedProject,
      setRequestCreateTypeId,
      handleUpdatePaidAmountValueInRequestList,
      getSelectProjectContextAction,
    },
  };
};

export default usePaymentRequestTable;
