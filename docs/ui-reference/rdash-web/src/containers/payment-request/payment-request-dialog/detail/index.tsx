import { RDInputReadonly, RDToolTip } from "@rdash-tech/web-ui-components";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  setFilePreviewEditorFiles,
  setPreviewEditorBreadCrumb,
  setPreviewEditorSelectedFile,
} from "../../../../actions/file-marking-editor.action";
import { openFilePreview } from "../../../../actions/file-preview.action";
import { InvoiceAmountExceedAlert } from "../../../../components/invoice";
import PaymentEntry from "../../../../components/payment-entry";
import {
  PAYMENT_REQUEST_CREATE_TYPE,
  PAYMENT_REQUEST_MODULE,
  PAYMENT_REQUEST_STATUS,
  REQUEST_TYPE_DROPDOWN_VALUES,
} from "../../../../constants/payment-request.constants";
import { APP_ROUTE_PATH } from "../../../../enumerations/common.enum";
import { INVOICE_V2_FORM_MODE } from "../../../../enumerations/invoice-v2.enum";
import { INVOICE_FIELDS } from "../../../../enumerations/invoice.enum";
import { PAYMENT_ENTRY_ACTION } from "../../../../enumerations/payment-entry.enum";
import { PERMISSION, PERMISSION_TYPE } from "../../../../enumerations/permission-context.enum";
import { useAppDispatch } from "../../../../hooks/store";
import usePermissions from "../../../../hooks/usePermissions";
import type { IFileMarkingEditorFile } from "../../../../models";
import { EditRedIcon, OpenInNewIcon } from "../../../../statics/images";
import { bigNumber } from "../../../../utils/big-number";
import { getFilledRoute } from "../../../../utils/common-methods";
import { getEditorFileType } from "../../../../utils/file-marking-editor";
import { getFileIcon } from "../../../../utils/file-operations";
import { getPaymentRequestModule } from "../../../../utils/payment-request";
import FileMarkingEditorView from "../../../file-marking-editor";
import { FILE_MARKING_EDITOR_HIDDEN_ACTIONS } from "../../../file-marking-editor/enum";
import OtherExpenseProofAttachment from "../../../other-expense/expense-edit/proof";
import Reply from "../reply";
import PaymentRequestTimeline from "../timeline";
import type { IPaymentRequestDetailProps } from "./interface";
import PaidTillDate from "./paid-till-date";
import "./style.css";

const PaymentRequestDetail = (props: IPaymentRequestDetailProps) => {
  const [filePreviewFile, setFilePreviewFile] = useState<IFileMarkingEditorFile>();

  const { isActionPermitted } = usePermissions();

  const dispatch = useAppDispatch();
  const [search] = useSearchParams();
  const type = search.get("type");

  const paymentRequestId = search.get("paymentRequestId") ?? "";
  const module = getPaymentRequestModule();

  const requestType = REQUEST_TYPE_DROPDOWN_VALUES.find((item) => item.id === type) || REQUEST_TYPE_DROPDOWN_VALUES[0];

  const canEditTds = isActionPermitted(PERMISSION_TYPE.ORG, PERMISSION.CAN_EDIT_TDS_AMOUNT);

  const isAddPaymentEntryDisable = useMemo(() => {
    return !props.formData.actions?.includes(PAYMENT_ENTRY_ACTION.ADD);
  }, [props.formData]);

  const handleCloseFilePreview = () => {
    setFilePreviewFile(undefined);
  };

  const handleOpenFilePreview = (file: IFileMarkingEditorFile, fileName: string) => {
    setFilePreviewFile(file);
    dispatch(setPreviewEditorSelectedFile(file));
    dispatch(setFilePreviewEditorFiles([file]));
    dispatch(setPreviewEditorBreadCrumb(fileName));
  };

  const openProofPreviewImage = (id: string | null) => {
    if (!id) return;
    dispatch(
      openFilePreview(
        props.formData.proofs.map((proof) => ({
          file: proof.file,
          fileNameToShow: proof.name,
        })),
        props.formData.proofs.findIndex((proof) => proof.id === id)
      )
    );
  };

  const isNonOrderRequest = requestType.id === PAYMENT_REQUEST_CREATE_TYPE.nonOrder;

  const requestAmount = bigNumber.add(props.formData.requestBaseAmount || "0", props.formData.gstAmount || "0");

  const navigateToOrder = () => {
    if (!props.formData.project?.id || !props.formData.order?.id) return;
    const route = getFilledRoute(APP_ROUTE_PATH.OutgoingOrderDetailView, {
      projectId: props.formData.project.id,
      orderId: props.formData.order.id,
    });
    window.open(route, "_blank");
  };

  const handleEditTdsAmount = () => {
    if (!props.formData.project?.id || !props.formData.invoice?.id) return;
    const url = getFilledRoute(APP_ROUTE_PATH.OrderVendorInvoicesInvoiceDetailView, {
      projectId: props.formData.project.id,
      invoiceId: props.formData.invoice.id,
      mode: INVOICE_V2_FORM_MODE.EDIT,
      returnUrl: "",
    });
    window.open(url, "_blank");
  };

  return (
    <>
      <div className="h-full display-flex flex-col">
        <div className="flex-1 overflow-y-auto">
          {props.formData.hasAlert && (
            <div className="px-20 pb-20">
              <InvoiceAmountExceedAlert alert={props.formData.alert} />
            </div>
          )}
          <div className="display-flex flex-wrap payment-request-detail gap-20 px-20">
            <RDInputReadonly
              label="Request ID"
              isLoading={props.isLoading}
            >
              {props.formData.requestNumber}
            </RDInputReadonly>
            {[PAYMENT_REQUEST_MODULE.manageClientPaymentRequest, PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest].includes(module) && (
              <RDInputReadonly
                label="Project Name"
                isLoading={props.isLoading}
                className="payment-request-detail-project-name"
              >
                <RDToolTip title={`${props.formData.project?.name} (${props.formData.project?.jobId})`}>
                  <div className="text-truncate">
                    {props.formData.project?.name} ({props.formData.project?.jobId})
                  </div>
                </RDToolTip>
                <OpenInNewIcon
                  className="cursor-pointer"
                  sx={{
                    width: "18px",
                    height: "18px",
                  }}
                  onClick={() =>
                    window.open(getFilledRoute(APP_ROUTE_PATH.ProjectDetailView, { projectId: props.formData.project?.id ?? "" }), "_blank")
                  }
                />
              </RDInputReadonly>
            )}
            {[PAYMENT_REQUEST_MODULE.orderPaymentRequest].includes(module) && (
              <RDInputReadonly
                label="Vendor Name"
                isLoading={props.isLoading}
              >
                {props.formData.vendor?.name}
              </RDInputReadonly>
            )}
            <RDInputReadonly
              label="Request Type"
              isLoading={props.isLoading}
            >
              {requestType.name}
            </RDInputReadonly>
            {requestType.id === PAYMENT_REQUEST_CREATE_TYPE.againstInvoice && (
              <>
                <RDInputReadonly
                  label="Invoice Number"
                  isLoading={props.isLoading}
                >
                  <div className="display-flex items-center gap-5">
                    <img
                      src={getFileIcon(props.formData?.invoice?.file ?? "")}
                      alt={props.formData?.invoice?.fileName}
                      className="payment-request-detail-file-icon cursor-pointer"
                      onClick={() =>
                        handleOpenFilePreview(
                          {
                            fileUrl: props.formData?.invoice?.file ?? "",
                            fileType: getEditorFileType(props.formData?.invoice?.file ?? ""),
                            id: props.formData.invoice.id ?? "",
                          },
                          props.formData.invoice.fileName ?? ""
                        )
                      }
                    />{" "}
                    <RDToolTip title={props.formData.invoice.invoiceNumber}>
                      <div className="text-truncate">{props.formData.invoice.invoiceNumber}</div>
                    </RDToolTip>
                  </div>
                </RDInputReadonly>
                <RDInputReadonly
                  label="Invoice Amount"
                  isLoading={props.isLoading}
                >
                  {props.i18n.number(props.formData.invoice.invoiceAmount)}
                </RDInputReadonly>
                {!props.formData.invoice.hiddenFields.includes(INVOICE_FIELDS.TDS_AMOUNT) && (
                  <RDInputReadonly
                    label={`${props.i18n.tds?.name || ""} Amount`}
                    isLoading={props.isLoading}
                  >
                    <div className="display-flex gap-4 items-center">
                      <span>{props.formData.invoice.tdsAmount ? props.i18n.number(props.formData.invoice.tdsAmount) : "-"}</span>
                      {canEditTds && (
                        <EditRedIcon
                          height="14px"
                          className="cursor-pointer"
                          onClick={handleEditTdsAmount}
                        />
                      )}
                    </div>
                  </RDInputReadonly>
                )}
              </>
            )}
            {!isNonOrderRequest && (
              <>
                <RDInputReadonly
                  label="PO Number"
                  isLoading={props.isLoading}
                >
                  <div className="display-flex items-center gap-5">
                    {props.formData?.po?.file && (
                      <img
                        src={getFileIcon(props.formData?.po?.file ?? "")}
                        alt={props.formData?.po?.fileName}
                        className="payment-request-detail-file-icon cursor-pointer"
                        onClick={() =>
                          handleOpenFilePreview(
                            {
                              fileUrl: props.formData?.po?.file ?? "",
                              fileType: getEditorFileType(props.formData?.po?.file ?? ""),
                              id: props.formData.po.id ?? "",
                            },
                            props.formData.po.fileName ?? ""
                          )
                        }
                      />
                    )}
                    <RDToolTip title={props.formData.po.poNumber}>
                      <div className="text-truncate">{props.formData.po.poNumber || "-"}</div>
                    </RDToolTip>
                  </div>
                </RDInputReadonly>
                <RDInputReadonly
                  label="PO Amount"
                  isLoading={props.isLoading}
                >
                  {props.formData.po.poAmount ? props.i18n.number(props.formData.po.poAmount) : "-"}
                </RDInputReadonly>
              </>
            )}
            {!isNonOrderRequest && (
              <RDInputReadonly
                label="Order Number"
                isLoading={props.isLoading}
              >
                {props.formData.orderNumber ? (
                  <div className="display-flex gap-5">
                    <div className="text-truncate">{props.formData.orderNumber}</div>
                    <OpenInNewIcon
                      className="cursor-pointer"
                      sx={{
                        width: "16px",
                        height: "16px",
                      }}
                      onClick={navigateToOrder}
                    />
                  </div>
                ) : (
                  "-"
                )}
              </RDInputReadonly>
            )}
            {!isNonOrderRequest && (
              <RDInputReadonly
                label="Order Type"
                isLoading={props.isLoading}
              >
                {props.formData.orderType}
              </RDInputReadonly>
            )}
            {!isNonOrderRequest && (
              <RDInputReadonly
                label="Order Amount"
                isLoading={props.isLoading}
              >
                {props.formData.order?.amount ? props.i18n.number(props.formData.order?.amount) : "-"}
              </RDInputReadonly>
            )}
            <RDInputReadonly
              label={`Request Amount (w/o ${props.i18n.tax.name})`}
              isLoading={props.isLoading}
            >
              {props.i18n.number(props.formData.requestBaseAmount || "0")}
            </RDInputReadonly>
            <RDInputReadonly
              label={`${props.i18n.tax.name} Amount`}
              isLoading={props.isLoading}
            >
              {props.i18n.number(props.formData.gstAmount)}
            </RDInputReadonly>
            <RDInputReadonly
              label="Total Request Amount"
              isLoading={props.isLoading}
            >
              {props.i18n.number(requestAmount)}
            </RDInputReadonly>
            <PaidTillDate
              isLoading={props.isLoading}
              paidTillDateAmount={props.formData.paidTillDate}
              paymentRequestId={paymentRequestId}
              i18n={props.i18n}
            />
            <RDInputReadonly
              label="Payment Due"
              isLoading={props.isLoading}
            >
              {props.i18n.number(props.formData.paymentDue)}
            </RDInputReadonly>
            <RDInputReadonly
              label="Due Date"
              isLoading={props.isLoading}
            >
              {props.formData.dueDate ? props.i18n.date(props.formData.dueDate, { dateOnly: true }) : "-"}
            </RDInputReadonly>
            <RDInputReadonly
              label="Remark"
              className="request-detail-remark"
              isLoading={props.isLoading}
            >
              {props.formData.remark}
            </RDInputReadonly>
          </div>
          {!!props.formData.proofs?.length && (
            <>
              <div className="font-size-14 font-semi-bold text-dark-grey-blue px-20 pt-20 pb-10">Proof</div>
              <div className="display-flex flex-col gap-10 px-20">
                {props.formData.proofs.map((proof) => {
                  return (
                    <OtherExpenseProofAttachment
                      key={proof.id}
                      proof={{
                        id: proof.id,
                        name: proof.name,
                        file: proof.file,
                        uploadedAt: proof.uploadedAt,
                      }}
                      isViewMode
                      isUploading={false}
                      progress={0}
                      blob={false}
                      error={false}
                      onClick={() => openProofPreviewImage(proof.id)}
                    />
                  );
                })}
              </div>
            </>
          )}
          {!props.isLoading && (
            <div className="mt-20 px-20">
              <PaymentEntry
                list={props.formData.paymentEntries}
                handleCancelOrDelete={props.handleCancelOrDeletePaymentEntry}
                requestAmount={props.formData.maxPaymentEntryAllowed?.toString()}
                handleCreate={props.handleCreatePaymentEntry}
                isForCreateEditMode={false}
                isAddPaymentEntryDisabled={isAddPaymentEntryDisable}
                projectId={props.formData.project?.id || ""}
                i18n={props.i18n}
                contextId={props.paymentRequestId}
                context={props.paymentEntryContext}
                handleUpdateSuccess={props.handlePaymentEntryUpdateSuccess}
              />
            </div>
          )}

          {props.status !== PAYMENT_REQUEST_STATUS.submitted && !props.isLoading && props.formData.requestId && (
            <div className="px-20">
              <PaymentRequestTimeline
                i18n={props.i18n}
                requestId={props.formData.requestId}
              />
            </div>
          )}
          {props.formData.requestId && (
            <div className="px-20">
              <Reply
                paymentRequestId={paymentRequestId}
                requestId={props.formData.requestId ?? ""}
              />
            </div>
          )}
        </div>
      </div>
      {filePreviewFile?.fileUrl && (
        <FileMarkingEditorView
          handleCloseFilePreview={handleCloseFilePreview}
          hiddenActions={[
            FILE_MARKING_EDITOR_HIDDEN_ACTIONS.COMMENT,
            FILE_MARKING_EDITOR_HIDDEN_ACTIONS.INFO,
            FILE_MARKING_EDITOR_HIDDEN_ACTIONS.PIN,
          ]}
        />
      )}
    </>
  );
};

export default PaymentRequestDetail;
