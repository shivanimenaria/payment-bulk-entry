import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  PAYMENT_REQUEST_ACTION_IDS,
  PAYMENT_REQUEST_CREATE_TYPE,
  PAYMENT_REQUEST_MODE,
  PAYMENT_REQUEST_MODULE,
  paymentRequestFileNameLimit,
} from "../../../../constants/payment-request.constants";
import { FILE_TYPE_ENUM } from "../../../../enumerations/file-type.enum";
import { FILE_UPLOAD_PATH } from "../../../../enumerations/file-upload-path.enum";
import { PAYMENT_ENTRY_CONTEXT } from "../../../../enumerations/payment-entry.enum";
import { OBJECT_STATUS_ENUM } from "../../../../enumerations/status.enum";
import { useAppDispatch, useAppSelector } from "../../../../hooks/store";
import useAppParams from "../../../../hooks/useAppParams";
import { useFieldFileUploader } from "../../../../hooks/useFileUpload";
import { useLingui } from "../../../../hooks/useLingui";
import useModal from "../../../../hooks/useModal";
import { useProjectConfig } from "../../../../hooks/useProjectConfig";
import useProjectContextAction from "../../../../hooks/useProjectContextAction";
import type {
  IBaseQueryError,
  ICreatePaymentRequestPayload,
  IPaymentRequest,
  IPaymentRequestAttachmentPayload,
  IPaymentRequestFormAmountData,
} from "../../../../models";
import type { IPaymentEntryListItem } from "../../../../models/payment-entry";
import { projectSelector } from "../../../../reducers/project.reducer";
import {
  paymentRequestApi,
  useCancelPaymentRequestResourceMutation,
  useCreatePaymentRequestMutation,
  useLazyGetPaymentRequestDetailQuery,
  useLazyGetPaymentRequestFormAmountMetaQuery,
  usePaymentRequestApproveMutation,
  usePaymentRequestCancelMutation,
  usePaymentRequestHoldMutation,
  usePaymentRequestRejectMutation,
  useUpdatePaymentRequestMutation,
} from "../../../../services/payment-request.service";
import { bigNumber } from "../../../../utils/big-number";
import { RDToast, getFilledRoute, roundAmount } from "../../../../utils/common-methods";
import { i18nDateBackend } from "../../../../utils/date-conversion";
import { getTrimmedFileNameWithExtension } from "../../../../utils/file-operations";
import { paymentEntryTransformer } from "../../../../utils/payment-entry";
import {
  getPaymentRequestActionItems,
  getPaymentRequestModule,
  getPaymentRequestTableStepperRoute,
  initialPaymentRequestFormError,
  isClientPayment,
  paymentRequestInitialFormData,
} from "../../../../utils/payment-request";
import type { IPaymentRequestDialogFormData, IPaymentRequestFormErrors } from "../interface";
import type { IUsePaymentRequestDialogProps } from "./interface";

const usePaymentRequestDialog = (props: IUsePaymentRequestDialogProps) => {
  const { add, multiply, divide, isGreaterThan, isEqual } = bigNumber;
  const [errors, setErrors] = useState<IPaymentRequestFormErrors>(initialPaymentRequestFormError);
  const [formData, setFormData] = useState<IPaymentRequestDialogFormData>(paymentRequestInitialFormData);
  const [invoicePoCardData, setInvoicePoCardData] = useState<IPaymentRequestFormAmountData | null>(null);

  const adminActionRef = useRef<boolean>(false);

  const [search] = useSearchParams();
  const mode = props.mode ?? search.get("mode") ?? "";
  const type = props.type ?? search.get("type") ?? "";
  const tab = search.get("tab") ?? "";
  const paymentRequestId = props.paymentRequestId ?? search.get("paymentRequestId") ?? "";

  const { projectId = "", vendorId = "", orgId = "" } = useAppParams();

  const navigate = useNavigate();
  const store = {
    projectImmediateClientId: useAppSelector(projectSelector.immediateClientId),
    userOrgId: useAppSelector((store) => store.login.organizationId),
  };
  const module = getPaymentRequestModule();
  const cancelModal = useModal();
  const resourceCancelModal = useModal();
  const approveModal = useModal();
  const rejectModal = useModal();

  const [createPaymentRequest, { isLoading: isCreating }] = useCreatePaymentRequestMutation();
  const [updatePaymentRequest, { isLoading: isUpdating }] = useUpdatePaymentRequestMutation();
  const [getPaymentRequestDetail, requestDetail] = useLazyGetPaymentRequestDetailQuery();
  const [cancelPaymentRequestResource, cancelPaymentRequestResourceState] = useCancelPaymentRequestResourceMutation();
  const [holdPaymentRequest, holdPaymentRequestState] = usePaymentRequestHoldMutation();
  const [cancelPaymentRequest, cancelPaymentRequestState] = usePaymentRequestCancelMutation();
  const [approvePaymentRequest, approvePaymentRequestState] = usePaymentRequestApproveMutation();
  const [rejectPaymentRequest, rejectPaymentRequestState] = usePaymentRequestRejectMutation();
  const [fetchInvoicePoCardMeta] = useLazyGetPaymentRequestFormAmountMetaQuery();

  const projectIdToUse = projectId || formData.project?.id || props.selectedProject.id;
  const projectConfigDetail = useProjectConfig(projectIdToUse, mode !== PAYMENT_REQUEST_MODE.create);

  const { handleAction } = useProjectContextAction(projectIdToUse);

  const dispatch = useAppDispatch();
  const { getModuleFieldState } = useFieldFileUploader({
    moduleName: "payment-request",
    fieldName: "upload-proof",
    uploadFilePath: FILE_UPLOAD_PATH.NON_ORDER_PAYMENT_PROOF,
    allowedFileTypes: [FILE_TYPE_ENUM.PDF, FILE_TYPE_ENUM.JPG, FILE_TYPE_ENUM.XLSX, FILE_TYPE_ENUM.DOC_PDF],
    multiple: true,
  });

  const againstPop = type === PAYMENT_REQUEST_CREATE_TYPE.poAdvance;
  const againstInvoice = type === PAYMENT_REQUEST_CREATE_TYPE.againstInvoice;
  const nonOrder = type === PAYMENT_REQUEST_CREATE_TYPE.nonOrder;
  const isForCreateEditMode = mode === PAYMENT_REQUEST_MODE.create || mode === PAYMENT_REQUEST_MODE.edit;

  const isClientModule = useMemo(() => {
    return isClientPayment(module);
  }, [module]);

  const i18n = useLingui(requestDetail.data?.projectConfig || projectConfigDetail.data);

  const refreshPaymentRequestDetails = () => {
    getPaymentRequestDetailData(paymentRequestId);
  };

  const handleCancelOrDeletePaymentEntry = (id: string) => {
    const paymentEntry = formData.paymentEntries.find((item) => item.id === id);

    if (!paymentEntry) return;

    if (isForCreateEditMode) {
      if (paymentEntry.objectStatus === OBJECT_STATUS_ENUM.ADD) {
        setFormData((prev) => ({ ...prev, paymentEntries: prev.paymentEntries.filter((item) => item.id !== id) }));
      } else {
        setFormData((prev) => ({
          ...prev,
          paymentEntries: prev.paymentEntries.map((item) =>
            item.id === id ? { ...item, isCancelled: true, objectStatus: OBJECT_STATUS_ENUM.UPDATE } : item
          ),
        }));
      }
      setErrors((prev) => ({ ...prev, paymentEntries: "" }));
    } else {
      getPaymentRequestDetailData(paymentRequestId);
      const totalPaidAmount = formData.paymentEntries.reduce(
        (acc, curr) => bigNumber.add(acc, curr.isCancelled ? "0" : curr.amount || "0"),
        "0"
      );
      props.handleUpdatePaidAmountValueInRequestList?.(paymentRequestId, bigNumber.subtract(totalPaidAmount, paymentEntry?.amount || "0"));
    }
  };

  const handlePaymentEntryUpdateSuccess = (data: IPaymentEntryListItem) => {
    const paymentEntry = formData.paymentEntries.find((item) => item.id === data.id);

    if (!paymentEntry) return;

    if (isForCreateEditMode) {
      if (paymentEntry.objectStatus === OBJECT_STATUS_ENUM.ADD) {
        setFormData((prev) => ({ ...prev, paymentEntries: prev.paymentEntries.map((item) => (item.id === data.id ? data : item)) }));
      } else {
        setFormData((prev) => ({
          ...prev,
          paymentEntries: prev.paymentEntries.map((item) =>
            item.id === data.id ? { ...item, ...data, objectStatus: OBJECT_STATUS_ENUM.UPDATE } : item
          ),
        }));
        setErrors((prev) => ({ ...prev, paymentEntries: "" }));
      }
    } else {
      refreshPaymentRequestDetails();
    }
  };

  const handleCreatePaymentEntry = (data: IPaymentEntryListItem) => {
    if (isForCreateEditMode) {
      setFormData((prev) => ({ ...prev, paymentEntries: [...prev.paymentEntries, data] }));
      setErrors((prev) => ({ ...prev, paymentEntries: "" }));
    } else {
      getPaymentRequestDetailData(paymentRequestId);
      const totalPaidAmount = formData.paymentEntries.reduce(
        (acc, curr) => bigNumber.add(acc, curr.isCancelled ? "0" : curr.amount || "0"),
        "0"
      );
      props.handleUpdatePaidAmountValueInRequestList?.(paymentRequestId, bigNumber.add(totalPaidAmount, data.amount || "0"));
    }
  };

  const handleClose = () => {
    navigate(
      getFilledRoute(getPaymentRequestTableStepperRoute(), {
        projectId: projectVendorAndClientId.projectId,
        vendorId: module === PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest ? projectVendorAndClientId.vendorId : "",
        orgId: module === PAYMENT_REQUEST_MODULE.manageClientPaymentRequest ? projectVendorAndClientId.clientId : "",
        tab: tab,
      })
    );
  };

  const getRequestAmounts = () => {
    const remainingBaseAmount = invoicePoCardData?.requestable.baseAmount || "0";
    const remainingTaxAmount = invoicePoCardData?.requestable.taxAmount || "0";

    const baseAmountForPercentageInput = againstInvoice
      ? invoicePoCardData?.invoice.baseAmount || "0"
      : invoicePoCardData?.po.baseAmount || "0";

    const taxAmountForPercentageInput = againstInvoice
      ? invoicePoCardData?.invoice.taxAmount || "0"
      : invoicePoCardData?.po.taxAmount || "0";

    const requestingBaseAmount = formData.requestBaseAmountPercentToggle
      ? roundAmount(multiply(divide(formData.requestBaseAmountPercent || "0", 100), baseAmountForPercentageInput))
      : formData.requestBaseAmount || "0";
    const requestingTaxAmount = formData.gstAmountPercentToggle
      ? roundAmount(multiply(divide(formData.gstAmountPercent || "0", 100), taxAmountForPercentageInput))
      : formData.gstAmount || "0";

    return {
      requestingBaseAmount,
      requestingTaxAmount,
      requestAmount: roundAmount(add(requestingBaseAmount, requestingTaxAmount)),
      remainingBaseAmount,
      remainingTaxAmount,
      remainingTotalAmount: roundAmount(add(remainingBaseAmount, remainingTaxAmount)),
      baseAmountForPercentageInput,
      taxAmountForPercentageInput,
    };
  };

  const validateFormData = () => {
    const errObj = { vendor: "", invoice: "", po: "", requestBaseAmount: "", gstAmount: "", requestAmount: "" };
    const { requestingBaseAmount, requestingTaxAmount, requestAmount, remainingBaseAmount, remainingTaxAmount, remainingTotalAmount } =
      getRequestAmounts();

    if ([PAYMENT_REQUEST_MODULE.orderPaymentRequest].includes(module) && !formData.vendor.id) {
      errObj.vendor = "Vendor is required";
    }
    if (againstInvoice && !formData.invoice.id) {
      errObj.invoice = "Invoice is required";
    }
    if (againstPop && !formData.po.id) {
      errObj.po = "PO is required";
    }

    if (!errObj.po && !errObj.invoice) {
      if (nonOrder) {
        if (!isGreaterThan(requestAmount, "0")) {
          errObj.requestAmount = "At least one field must be filled";
        }
      } else {
        if (!isGreaterThan(requestAmount, "0") && isGreaterThan(remainingTotalAmount, "0")) {
          errObj.requestAmount = "At least one field must be filled";
        } else if (!isGreaterThan(requestAmount, "0")) {
          errObj.requestAmount = "Request amount should be more than 0";
        } else {
          if (isGreaterThan(requestingBaseAmount, remainingBaseAmount)) {
            if (isEqual(remainingBaseAmount, "0")) {
              errObj.requestBaseAmount = "Complete Base amount already requested.";
            } else {
              errObj.requestBaseAmount = `Requested base amount can not be greater than ${i18n.number(remainingBaseAmount)}`;
            }
          }
          if (isGreaterThan(requestingTaxAmount, remainingTaxAmount)) {
            if (isEqual(remainingTaxAmount, "0")) {
              errObj.gstAmount = `Complete ${i18n.tax.name} amount already requested.`;
            } else {
              errObj.gstAmount = `Requested ${i18n.tax.name} amount can not be greater than ${i18n.number(remainingTaxAmount)}`;
            }
          }
        }
      }
    }

    if (Object.values(errObj).join("").length) {
      setErrors(errObj);
      return false;
    }

    return true;
  };

  const paymentEntryContext = useMemo(() => {
    switch (module) {
      case PAYMENT_REQUEST_MODULE.orderPaymentRequest:
        return PAYMENT_ENTRY_CONTEXT.ORDER_PAYMENT_REQUEST;
      case PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest:
        return PAYMENT_ENTRY_CONTEXT.MANAGE_VENDOR_PAYMENT_REQUEST;
      case PAYMENT_REQUEST_MODULE.taskManagerPaymentRequest:
        return PAYMENT_ENTRY_CONTEXT.TASK_MANAGER_PAYMENT_REQUEST;
      case PAYMENT_REQUEST_MODULE.manageClientPaymentRequest:
        return PAYMENT_ENTRY_CONTEXT.MANAGE_CLIENT_PAYMENT_REQUEST;
      case PAYMENT_REQUEST_MODULE.boqPaymentRequest:
      default: {
        return PAYMENT_ENTRY_CONTEXT.BOQ_PAYMENT_REQUEST;
      }
    }
  }, [module]);

  const getProjectVendorAndClientId = () => {
    const obj = { projectId: "", vendorId: "", clientId: "" };
    switch (module) {
      case PAYMENT_REQUEST_MODULE.orderPaymentRequest:
        obj.projectId = projectId;
        obj.vendorId = formData.vendor.id;
        obj.clientId = store.userOrgId;
        break;
      case PAYMENT_REQUEST_MODULE.boqPaymentRequest:
        obj.projectId = projectId;
        obj.vendorId = store.userOrgId;
        obj.clientId = store.projectImmediateClientId || "";
        break;
      case PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest:
        obj.projectId = mode === PAYMENT_REQUEST_MODE.edit ? (formData.project?.id ?? "") : props.selectedProject.id;
        obj.vendorId = vendorId;
        obj.clientId = store.userOrgId;
        break;
      case PAYMENT_REQUEST_MODULE.manageClientPaymentRequest:
        obj.projectId = mode === PAYMENT_REQUEST_MODE.edit ? (formData.project?.id ?? "") : props.selectedProject.id;
        obj.vendorId = store.userOrgId;
        obj.clientId = orgId;
        break;
      case PAYMENT_REQUEST_MODULE.taskManagerPaymentRequest:
        obj.projectId = props.selectedProject.id;
        obj.vendorId = formData.vendor.id;
        obj.clientId = store.userOrgId;
        break;
      default:
        break;
    }
    return obj;
  };

  const projectVendorAndClientId = getProjectVendorAndClientId();
  const projectVendorId = projectVendorAndClientId.vendorId;
  const projectClientId = projectVendorAndClientId.clientId;

  const handleSubmit = () => {
    if (!validateFormData()) return;
    const { requestingTaxAmount, requestAmount } = getRequestAmounts();
    const proofs: IPaymentRequestAttachmentPayload[] = getModuleFieldState().map((item) => ({
      id: null,
      name: getTrimmedFileNameWithExtension(item.name, paymentRequestFileNameLimit),
      file: item.uploadedFileUrl,
    }));

    formData.proofs?.forEach((proof) => {
      if (proof.objectStatus !== OBJECT_STATUS_ENUM.DELETE)
        proofs.push({
          id: proof.id || null,
          name: proof.name,
          file: proof.file,
        });
    });

    const payload: ICreatePaymentRequestPayload = {
      project_id: mode === PAYMENT_REQUEST_MODE.edit ? undefined : projectVendorAndClientId.projectId,
      vendor_id: mode === PAYMENT_REQUEST_MODE.edit ? undefined : projectVendorAndClientId.vendorId || null,
      client_id: mode === PAYMENT_REQUEST_MODE.edit ? undefined : projectVendorAndClientId.clientId,
      request_type: mode === PAYMENT_REQUEST_MODE.edit ? undefined : type || "",
      invoice_id: formData.invoice.id || null,
      // if create request against invoice then purchase_order_id will be null
      purchase_order_id: formData.invoice.id ? null : formData.po.id || null,
      request_amount: requestAmount || "0",
      gst_amount: formData.includeGstPart ? requestingTaxAmount.toString() || "0" : "0",
      remark: formData.remark || null,
      payment_request_entries: paymentEntryTransformer.convertPaymentEntryDataToServicePayloadFormat(formData.paymentEntries),
      base_amount_percent: formData.requestBaseAmountPercent || "0",
      gst_amount_percent: formData.gstAmountPercent || "0",
      base_amount_percent_toggle: formData.requestBaseAmountPercentToggle,
      gst_amount_percent_toggle: formData.gstAmountPercentToggle,
      attachment: proofs || [],
      due_date: formData.dueDate ? i18nDateBackend(formData.dueDate) : null,
    };

    if (mode === PAYMENT_REQUEST_MODE.create) {
      createPaymentRequest(payload)
        .unwrap()
        .then((res) => props.handleCreateUpdateSuccess(true, res))
        .catch(({ error, message }: IBaseQueryError<IPaymentRequestFormErrors>) => {
          if (Object.values(error).join("").length) setErrors(error);
          else RDToast.error(message);
        });
      return;
    }

    updatePaymentRequest({ paymentRequestId, data: payload })
      .unwrap()
      .then((res) => props.handleCreateUpdateSuccess(false, res))
      .catch(({ error, message }: IBaseQueryError<IPaymentRequestFormErrors>) => {
        if (Object.values(error).join("").length) setErrors(error);
        else RDToast.error(message);
      });
  };

  const actionItems = getPaymentRequestActionItems(requestDetail.data?.actions ?? []);

  const actionMenu = (actionId: number) => {
    switch (actionId) {
      case PAYMENT_REQUEST_ACTION_IDS.edit: {
        const onEdit = () =>
          navigate(
            getFilledRoute(getPaymentRequestTableStepperRoute(), {
              projectId: projectVendorAndClientId.projectId,
              vendorId: projectVendorAndClientId.vendorId,
              orgId: projectVendorAndClientId.clientId,
              tab: props.selectedTab ?? "",
              mode: PAYMENT_REQUEST_MODE.edit,
              type: type,
              paymentRequestId: paymentRequestId,
            })
          );

        if (isClientModule) {
          onEdit();
          break;
        }

        handleAction({ context: "vendor-payment-request", action: "edit", contextId: paymentRequestId, callback: onEdit });

        break;
      }
      case PAYMENT_REQUEST_ACTION_IDS.resourceCancel:
        resourceCancelModal.open();
        break;
      case PAYMENT_REQUEST_ACTION_IDS.cancel:
        if (isClientModule) {
          cancelModal.open();
          break;
        }
        handleAction({
          context: "vendor-payment-request",
          action: "cancel",
          contextId: paymentRequestId,
          callback: cancelModal.open,
        });

        break;
      case PAYMENT_REQUEST_ACTION_IDS.cancelAsAdmin:
        cancelModal.open();
        adminActionRef.current = true;
        break;
      case PAYMENT_REQUEST_ACTION_IDS.approve:
        approveModal.open();
        break;
      case PAYMENT_REQUEST_ACTION_IDS.approveAsAdmin:
        approveModal.open();
        adminActionRef.current = true;
        break;
      case PAYMENT_REQUEST_ACTION_IDS.reject:
        rejectModal.open();
        break;
      case PAYMENT_REQUEST_ACTION_IDS.rejectAsAdmin:
        rejectModal.open();
        adminActionRef.current = true;
        break;
      case PAYMENT_REQUEST_ACTION_IDS.hold:
        handleHoldPaymentRequest(false);
        break;
      case PAYMENT_REQUEST_ACTION_IDS.holdAsAdmin:
        handleHoldPaymentRequest(true);
        break;
      default:
        break;
    }
  };

  const refreshAmountsData = () => {
    dispatch(paymentRequestApi.util.invalidateTags(["PaymentRequestAmounts"]));
  };

  const getPaymentRequestDetailData = (id: string) => {
    getPaymentRequestDetail({
      requestId: id,
      source: module === PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest ? "manage-vendor" : undefined,
    })
      .unwrap()
      .then((res) => {
        setFormData(res);
      });
  };

  const handleActionSuccess = (id: string, data: IPaymentRequest) => {
    refreshAmountsData();
    getPaymentRequestDetailData(id);
    props.handleUpdatePaymentRequestData?.(data);
  };

  const handleHoldPaymentRequest = (isAdmin: boolean) => {
    holdPaymentRequest({
      paymentRequestId,
      requestId: requestDetail.data?.requestId ?? "",
      isAdminAction: isAdmin,
    })
      .unwrap()
      .then((res) => handleActionSuccess(paymentRequestId, res));
  };

  const handleCloseCancelPaymentRequestResource = () => {
    resourceCancelModal.close();
  };

  const handleCancelPaymentRequestResource = () => {
    cancelPaymentRequestResource(paymentRequestId)
      .unwrap()
      .then((res) => {
        handleActionSuccess(paymentRequestId, res);
        handleCloseCancelPaymentRequestResource();
      });
  };

  const handleCloseCancelPaymentRequest = () => {
    cancelModal.close();
    adminActionRef.current = false;
  };

  const handleCancelPaymentRequest = () => {
    cancelPaymentRequest({
      paymentRequestId,
      requestId: requestDetail.data?.requestId ?? "",
      isAdminAction: adminActionRef.current,
    })
      .unwrap()
      .then((res) => {
        handleActionSuccess(paymentRequestId, res);
        handleCloseCancelPaymentRequest();
      });
  };

  const handleCloseApprovePaymentRequest = () => {
    approveModal.close();
    adminActionRef.current = false;
  };

  const handleApprovePaymentRequest = (remark: string) => {
    approvePaymentRequest({
      paymentRequestId,
      remark: remark,
      requestId: requestDetail.data?.requestId ?? "",
      isAdminAction: adminActionRef.current,
    })
      .unwrap()
      .then((res) => {
        handleActionSuccess(paymentRequestId, res);
        handleCloseApprovePaymentRequest();
      });
  };

  const handleCloseRejectPaymentRequest = () => {
    rejectModal.close();
    adminActionRef.current = false;
  };

  const handleRejectPaymentRequest = (remark: string) => {
    rejectPaymentRequest({
      paymentRequestId,
      remark: remark,
      requestId: requestDetail.data?.requestId ?? "",
      isAdminAction: adminActionRef.current,
    })
      .unwrap()
      .then((res) => {
        handleActionSuccess(paymentRequestId, res);
        handleCloseRejectPaymentRequest();
      });
  };

  useEffect(() => {
    if ((formData.invoice.id || formData.po.id) && mode !== PAYMENT_REQUEST_MODE.detail) {
      fetchInvoicePoCardMeta({
        type,
        invoice_id: againstInvoice ? formData.invoice.id : null,
        purchase_order_id: againstPop ? formData.po.id : null,
        payment_request_id: paymentRequestId || null,
      })
        .unwrap()
        .then(setInvoicePoCardData);
      return;
    }

    setInvoicePoCardData(null);
  }, [formData.invoice.id, formData.po.id, mode]);

  useEffect(() => {
    if (paymentRequestId && [PAYMENT_REQUEST_MODE.detail, PAYMENT_REQUEST_MODE.edit].includes(mode)) {
      getPaymentRequestDetailData(paymentRequestId);
    }
  }, []);

  return {
    state: {
      formData,
      invoicePoCardData,
      setFormData,
      errors,
      setErrors,
      requestDetail,
      isCreating,
      isUpdating,
      cancelPaymentRequestState,
      store,
      isResourceCancelModalOpen: resourceCancelModal.isOpen,
      isCancelModalOpen: cancelModal.isOpen,
      isApproveModalOpen: approveModal.isOpen,
      isRejectModalOpen: rejectModal.isOpen,
      approvePaymentRequestState,
      rejectPaymentRequestState,
      cancelPaymentRequestResourceState,
      holdPaymentRequestState,
      projectConfigDetail,
    },
    otherData: {
      mode,
      actionItems,
      paymentRequestId,
      requestType: type,
      projectClientId,
      projectVendorId,
      paymentEntryContext,
    },
    handlers: {
      handleSubmit,
      handleCancelPaymentRequest,
      handleCloseCancelPaymentRequest,
      actionMenu,
      handleClose,
      setErrors,
      setFormData,
      getProjectVendorAndClientId,
      handleCancelPaymentRequestResource,
      handleCloseCancelPaymentRequestResource,
      handleCloseApprovePaymentRequest,
      handleApprovePaymentRequest,
      handleCloseRejectPaymentRequest,
      handleRejectPaymentRequest,
      approveModal,
      rejectModal,
      handleHoldPaymentRequest,
      handleCancelOrDeletePaymentEntry,
      handlePaymentEntryUpdateSuccess,
      handleCreatePaymentEntry,
      getRequestAmounts,
      refreshPaymentRequestDetails,
    },
    i18n,
  };
};

export type getRequestAmountsType = ReturnType<typeof usePaymentRequestDialog>["handlers"]["getRequestAmounts"];
export default usePaymentRequestDialog;
