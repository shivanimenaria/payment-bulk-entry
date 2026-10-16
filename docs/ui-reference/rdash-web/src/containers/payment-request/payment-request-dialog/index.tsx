import { RDButtonV2, RDDropdownWithButton } from "@rdash-tech/web-ui-components";
import { RequestApproveModal, RequestCancelModal, RequestRejectModal } from "../../../components/approval-request";
import {
  SidePanel,
  SidePanelBody,
  SidePanelFooter,
  SidePanelHeader,
  SidePanelHeaderCloseIcon,
  SidePanelHeaderLeft,
  SidePanelHeaderRight,
  SidePanelHeaderTitle,
} from "../../../components/side-panel";
import { PAYMENT_REQUEST_BACKEND_ACTIONS, PAYMENT_REQUEST_MODE } from "../../../constants/payment-request.constants";
import { useFormFileUploader } from "../../../hooks/useFileUpload";
import { CircularCrossIcon, CircularTickIcon, HoldIcon, MoreVertIcon } from "../../../statics/images";
import { getPaymentRequestDetailTitle } from "../../../utils/payment-request";
import AmountSummary from "./amount-summary";
import PaymentRequestDetail from "./detail";
import CreateEditPaymentRequestForm from "./form";
import usePaymentRequestDialog from "./hooks/usePaymentRequestDialog";
import type { IPaymentRequestCreateEditDetailDialogProps } from "./interface";
import "./style.css";

const PaymentRequestCreateEditDetailDialog = (props: IPaymentRequestCreateEditDetailDialogProps) => {
  const { state, otherData, handlers, i18n } = usePaymentRequestDialog({
    handleCreateUpdateSuccess: props.handleCreateUpdateSuccess,
    handleUpdatePaymentRequestData: props.handleUpdatePaymentRequestData,
    selectedProject: props.selectedProject,
    selectedTab: props.selectedTab,
    mode: props.mode,
    type: props.type,
    paymentRequestId: props.paymentRequestId,
    handleUpdatePaidAmountValueInRequestList: props.handleUpdatePaidAmountValueInRequestList,
  });

  const { isUploading: isFileUploadInProgress } = useFormFileUploader({
    moduleName: "payment-request",
  });

  return (
    <>
      <SidePanel open={!!otherData.mode}>
        <>
          <SidePanelHeader className="display-flex items-center justify-between gap-20">
            <SidePanelHeaderLeft className="display-flex items-center gap-20">
              <SidePanelHeaderCloseIcon onClick={props.handleClose ?? handlers.handleClose} />
              <SidePanelHeaderTitle>{getPaymentRequestDetailTitle(otherData.mode)}</SidePanelHeaderTitle>
            </SidePanelHeaderLeft>
            {otherData.mode === PAYMENT_REQUEST_MODE.detail && (
              <SidePanelHeaderRight className="display-flex gap-10">
                {state.requestDetail.data?.actions?.includes(PAYMENT_REQUEST_BACKEND_ACTIONS.approve) && (
                  <RDButtonV2
                    color="black"
                    variant="text"
                    size="small"
                    onClick={handlers.approveModal.open}
                    leadingVisual={<CircularTickIcon height="14px" />}
                    disabled={state.approvePaymentRequestState.isLoading}
                  >
                    Approve
                  </RDButtonV2>
                )}
                {state.requestDetail.data?.actions?.includes(PAYMENT_REQUEST_BACKEND_ACTIONS.reject) && (
                  <RDButtonV2
                    color="black"
                    variant="text"
                    size="small"
                    onClick={handlers.rejectModal.open}
                    leadingVisual={<CircularCrossIcon height="14px" />}
                    disabled={state.rejectPaymentRequestState.isLoading}
                  >
                    Reject
                  </RDButtonV2>
                )}
                {state.requestDetail.data?.actions?.includes(PAYMENT_REQUEST_BACKEND_ACTIONS.hold) && (
                  <RDButtonV2
                    leadingVisual={<HoldIcon height="14px" />}
                    variant="text"
                    onClick={() => handlers.handleHoldPaymentRequest(false)}
                    disabled={state.holdPaymentRequestState.isLoading}
                    size="small"
                    color="black"
                  >
                    Hold
                  </RDButtonV2>
                )}
                <RDDropdownWithButton
                  actionItems={otherData.actionItems}
                  actionMenu={handlers.actionMenu}
                  icon={<MoreVertIcon fontSize="small" />}
                  buttonVariant="icon"
                  disabled={state.requestDetail.isLoading || state.requestDetail.isFetching || otherData.actionItems.length === 0}
                />
              </SidePanelHeaderRight>
            )}
          </SidePanelHeader>
          <SidePanelBody className="px-0 vertical-scrollbar-v2 pb-0">
            {otherData.mode === PAYMENT_REQUEST_MODE.detail ? (
              <PaymentRequestDetail
                formData={state.formData}
                isLoading={state.requestDetail.isLoading || state.requestDetail.isFetching || state.requestDetail.isUninitialized}
                status={state.requestDetail.status}
                handleCancelOrDeletePaymentEntry={handlers.handleCancelOrDeletePaymentEntry}
                handlePaymentEntryUpdateSuccess={handlers.handlePaymentEntryUpdateSuccess}
                handleCreatePaymentEntry={handlers.handleCreatePaymentEntry}
                i18n={i18n}
                paymentRequestId={otherData.paymentRequestId}
                clientId={otherData.projectClientId}
                refreshPaymentRequestDetail={handlers.refreshPaymentRequestDetails}
                paymentEntryContext={otherData.paymentEntryContext}
              />
            ) : (
              <CreateEditPaymentRequestForm
                formData={state.formData}
                setFormData={handlers.setFormData}
                invoicePoCardData={state.invoicePoCardData}
                getRequestAmounts={handlers.getRequestAmounts}
                errors={state.errors}
                setErrors={handlers.setErrors}
                project={props.selectedProject}
                getProjectVendorAndClientId={handlers.getProjectVendorAndClientId}
                isLoading={state.requestDetail.isLoading || state.requestDetail.isFetching || state.projectConfigDetail.isLoading}
                mode={props.mode}
                type={otherData.requestType}
                handleCancelOrDeletePaymentEntry={handlers.handleCancelOrDeletePaymentEntry}
                handlePaymentEntryUpdateSuccess={handlers.handlePaymentEntryUpdateSuccess}
                handleCreatePaymentEntry={handlers.handleCreatePaymentEntry}
                projectClientId={otherData.projectClientId}
                projectVendorId={otherData.projectVendorId}
                paymentEntryContext={otherData.paymentEntryContext}
                i18n={i18n}
              />
            )}
          </SidePanelBody>
          {otherData.mode !== PAYMENT_REQUEST_MODE.detail && (
            <SidePanelFooter className="display-flex flex-col p-0 shadow-none">
              <AmountSummary
                getRequestAmounts={handlers.getRequestAmounts}
                i18n={i18n}
              />
              <div className="display-flex gap-10 px-20 py-20">
                <RDButtonV2
                  onClick={handlers.handleSubmit}
                  isLoading={state.isCreating || state.isUpdating}
                  disabled={
                    state.requestDetail.isLoading ||
                    state.requestDetail.isFetching ||
                    state.isCreating ||
                    state.isUpdating ||
                    isFileUploadInProgress
                  }
                  size="medium"
                >
                  {otherData.mode === PAYMENT_REQUEST_MODE.edit ? "Update Request" : "Submit request"}
                </RDButtonV2>
                <RDButtonV2
                  variant="outlined"
                  color="black"
                  onClick={props.handleClose ?? handlers.handleClose}
                  size="medium"
                >
                  Cancel
                </RDButtonV2>
              </div>
            </SidePanelFooter>
          )}
        </>
      </SidePanel>
      {state.isResourceCancelModalOpen && (
        <RequestCancelModal
          handleProceed={handlers.handleCancelPaymentRequestResource}
          handleClose={handlers.handleCloseCancelPaymentRequestResource}
          isLoading={state.cancelPaymentRequestResourceState.isLoading}
        />
      )}
      {state.isCancelModalOpen && (
        <RequestCancelModal
          handleProceed={handlers.handleCancelPaymentRequest}
          handleClose={handlers.handleCloseCancelPaymentRequest}
          isLoading={state.cancelPaymentRequestState.isLoading}
        />
      )}
      {state.isApproveModalOpen && (
        <RequestApproveModal
          isLoading={state.approvePaymentRequestState.isLoading}
          handleProceed={handlers.handleApprovePaymentRequest}
          handleClose={handlers.handleCloseApprovePaymentRequest}
        />
      )}
      {state.isRejectModalOpen && (
        <RequestRejectModal
          isLoading={state.rejectPaymentRequestState.isLoading}
          handleProceed={handlers.handleRejectPaymentRequest}
          handleClose={handlers.handleCloseRejectPaymentRequest}
        />
      )}
    </>
  );
};

export default PaymentRequestCreateEditDetailDialog;
