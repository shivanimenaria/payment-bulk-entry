import { RDInputDate, RDInputDropdownSingleSelect, RDInputError, RDTextArea, RDTextInput, RDToolTip } from "@rdash-tech/web-ui-components";
import { useMemo } from "react";
import { VendorInputDropDownSingleSelect } from "../../../../components/generic-drop-down";
import { InvoiceAmountExceedAlert } from "../../../../components/invoice";
import PaymentEntry from "../../../../components/payment-entry";
import {
  PAYMENT_REQUEST_CREATE_TYPE,
  PAYMENT_REQUEST_MODE,
  PAYMENT_REQUEST_MODULE,
  REQUEST_TYPE_DROPDOWN_VALUES,
} from "../../../../constants/payment-request.constants";
import { useAppSelector } from "../../../../hooks/store";
import useAppParams from "../../../../hooks/useAppParams";
import { projectSelector } from "../../../../reducers/project.reducer";
import { paymentRequestApi } from "../../../../services/payment-request.service";
import { getPaymentRequestConfigOrgId } from "../../../../utils/payment-request";
import { VENDOR_LIST_FORMS } from "../../../../utils/vendor-list";
import PaymentRequestEditFormLoader from "../edit-form-loader";
import usePaymentRequestForm from "../hooks/usePaymentRequestForm";
import InvoicePoAmountCard from "../invoice-po-amount-card";
import type { ICreateEditPaymentRequestFormProps } from "./interface";
import NonOrderSummary from "./non-order-summary";
import RequestedAmountInput from "./requested-amount-input";
import RequestedGstAmountInput from "./requested-gst-amount-input";
import "./style.css";
import UploadProof from "./upload-proof";

const CreateEditPaymentRequestForm = (props: ICreateEditPaymentRequestFormProps) => {
  const { state, otherData, handlers } = usePaymentRequestForm({
    formData: props.formData,
    setErrors: props.setErrors,
    setFormData: props.setFormData,
    errors: props.errors,
    projectName: props.project.name,
    getProjectVendorAndClientId: props.getProjectVendorAndClientId,
    mode: props.mode,
    type: props.type,
    i18n: props.i18n,
  });

  const { orgId = "" } = useAppParams();
  const store = {
    projectImmediateClientId: useAppSelector(projectSelector.immediateClientId),
    orgId: useAppSelector((store) => store.login.organizationId),
  };

  const noOrderPayment = otherData.requestType.id === PAYMENT_REQUEST_CREATE_TYPE.nonOrder;

  const orgIdForConfig = useMemo(
    () =>
      getPaymentRequestConfigOrgId(otherData.module, {
        clientOrgId: orgId,
        projectImmediateClientId: store.projectImmediateClientId,
        userOrgId: store.orgId,
      }),
    [otherData.module, orgId, store.projectImmediateClientId, store.orgId]
  );

  const { data: paymentRequestConfig } = paymentRequestApi.useVendortPaymentsConfigQuery(orgIdForConfig, {
    skip: !orgIdForConfig,
  });

  const isAddPaymentEntryDisabled = useMemo(() => {
    return !paymentRequestConfig?.isPyamentEntryAllowedOnUnApprovedRequest;
  }, [paymentRequestConfig?.isPyamentEntryAllowedOnUnApprovedRequest]);

  const getVendorListFormParam = () => {
    if (otherData.requestType.id === PAYMENT_REQUEST_CREATE_TYPE.poAdvance) {
      return VENDOR_LIST_FORMS.PAYMENT_REQUEST_PO;
    }
    if (otherData.requestType.id === PAYMENT_REQUEST_CREATE_TYPE.againstInvoice) {
      return VENDOR_LIST_FORMS.PAYMENT_REQUEST_INVOICE;
    }
    return undefined;
  };

  if (props.isLoading) return <PaymentRequestEditFormLoader />;

  return (
    <div className="display-flex flex-column gap-20 px-20 pb-20">
      {[
        PAYMENT_REQUEST_MODULE.manageClientPaymentRequest,
        PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest,
        PAYMENT_REQUEST_MODULE.taskManagerPaymentRequest,
      ].includes(otherData.module) && (
        <RDTextInput
          name="projectName"
          label="Project Name"
          value={otherData.mode === PAYMENT_REQUEST_MODE.edit ? props.formData.project?.name : props.project.name}
          disabled
        />
      )}
      {props.invoicePoCardData?.hasAlert && <InvoiceAmountExceedAlert alert={props.invoicePoCardData.alert} />}
      <RDInputDropdownSingleSelect
        required
        label="Request Type"
        placeholder="Select request Type"
        value={otherData.requestType}
        setValue={() => {}}
        dropDownValue={REQUEST_TYPE_DROPDOWN_VALUES}
        dropdownItem={(element, index) => ({
          key: index,
          element: <span className="text-truncate">{element.name}</span>,
        })}
        dropdownLabel={(element) => <span className="text-truncate">{element.name}</span>}
        disabled
      />
      <RDInputDate
        label="Due Date"
        name="dueDate"
        value={props.formData.dueDate}
        setValue={(_, value) => props.setFormData((prev) => ({ ...prev, dueDate: value?.toString() || "" }))}
      />
      {[PAYMENT_REQUEST_MODULE.orderPaymentRequest, PAYMENT_REQUEST_MODULE.taskManagerPaymentRequest].includes(otherData.module) && (
        <VendorInputDropDownSingleSelect
          required
          label="Vendor"
          value={props.formData.vendor.id ? props.formData.vendor : null}
          setValue={handlers.handleSelectVendor}
          projectId={state.projectId}
          clientId={state.clientId}
          error={props.errors.vendor}
          isProjectShared={!noOrderPayment}
          disabled={otherData.mode === PAYMENT_REQUEST_MODE.edit}
          form={getVendorListFormParam()}
        />
      )}
      {otherData.requestType.id === PAYMENT_REQUEST_CREATE_TYPE.againstInvoice && (
        <>
          <RDInputDropdownSingleSelect
            required
            label="Invoice"
            placeholder="Select invoice"
            value={props.formData.invoice.invoiceNumber ? props.formData.invoice : null}
            setValue={handlers.handleSelectInvoice}
            dropDownValue={state.invoiceDropdownState.data || []}
            dropdownItem={(element, index) => ({
              key: index,
              element: (
                <div className="w-full display-flex flex-column gap-5">
                  <div className="display-flex justify-between font-size-14">
                    <span className="text-dark-grey-blue">{element.invoiceNumber}</span>
                    <span className="text-dark-grey-blue">
                      {props.i18n.currencySymbol}
                      {props.i18n.number(element.invoiceAmount || "0")}
                    </span>
                  </div>
                  <div className="display-flex justify-between font-size-12">
                    <span className="invoice-dropdown-order-no">
                      Order No. : {element.order?.number || "-"} . PO No. : {element.po.poNumber || "-"}
                    </span>
                  </div>
                </div>
              ),
            })}
            dropdownLabel={(element) => <span className="text-truncate">{element.invoiceNumber}</span>}
            search
            searchPlaceholder="Search Invoice By Invoice Number, Order Number"
            searchFilter={handlers.invoiceSearchFilter}
            width={400}
            isLoading={state.invoiceDropdownState.isLoading}
            showError={!!props.errors.invoice}
            error={props.errors.invoice}
            disabled={handlers.isInvoiceDropDownDisabled()}
          />
          {/* adding it here to maintain alignment of invoice dropdown row when there is error*/}
          {<RDInputError showError={!!props.errors.invoice} />}
        </>
      )}
      {otherData.requestType.id === PAYMENT_REQUEST_CREATE_TYPE.poAdvance && (
        <>
          <RDInputDropdownSingleSelect
            required={otherData.requestType.id === PAYMENT_REQUEST_CREATE_TYPE.poAdvance}
            label="PO Number"
            placeholder="Select Po"
            value={props.formData.po.poNumber ? props.formData.po : null}
            setValue={handlers.handleSelectPo}
            dropDownValue={state.poDropdownState.data || []}
            dropdownItem={(element, index) => ({
              key: index,
              element: (
                <div className="w-full display-flex flex-column gap-5">
                  <div className="display-flex justify-between font-size-14">
                    <RDToolTip title={element.poNumber}>
                      <span className="text-dark-grey-blue text-truncate">{element.poNumber}</span>
                    </RDToolTip>
                    <span className="text-dark-grey-blue">
                      {props.i18n.currencySymbol}
                      {props.i18n.number(element.poAmount || "0")}
                    </span>
                  </div>
                  <div className="display-flex justify-between font-size-12">
                    <span className="invoice-dropdown-order-no">Order No. : {element.orderNumber || "-"}</span>
                  </div>
                </div>
              ),
            })}
            dropdownLabel={(element) => <span className="text-truncate">{element.poNumber}</span>}
            search
            searchPlaceholder="Search PO By PO Number, Order Number"
            searchFilter={handlers.poSearchFilter}
            width={400}
            showError={!!props.errors.po}
            error={props.errors.po}
            isLoading={state.poDropdownState.isLoading}
            disabled={handlers.isPoDropDownDisabled()}
          />
          {/* adding it here to maintain alignment of po dropdown row when there is error*/}
          {<RDInputError showError={!!props.errors.po} />}
        </>
      )}
      {otherData.requestType.id !== PAYMENT_REQUEST_CREATE_TYPE.nonOrder && (
        <InvoicePoAmountCard
          i18n={props.i18n}
          po={props.formData.po}
          invoice={props.formData.invoice}
          requestType={otherData.requestType.id}
          invoicePoCardData={props.invoicePoCardData}
        />
      )}
      {noOrderPayment && (props.projectClientId || props.projectVendorId) && state.projectId && (
        <NonOrderSummary
          vendorId={props.projectVendorId}
          clientId={props.projectClientId}
          projectId={state.projectId}
        />
      )}
      <div className="display-flex flex-col gap-10">
        <RequestedAmountInput
          formData={props.formData}
          setFormData={props.setFormData}
          errors={props.errors}
          setErrors={props.setErrors}
          getRequestAmounts={props.getRequestAmounts}
          type={props.type || ""}
          i18n={props.i18n}
        />
        <RequestedGstAmountInput
          formData={props.formData}
          setFormData={props.setFormData}
          errors={props.errors}
          setErrors={props.setErrors}
          getRequestAmounts={props.getRequestAmounts}
          type={props.type || ""}
          i18n={props.i18n}
        />
      </div>
      <UploadProof
        form={props.formData}
        setFormData={props.setFormData}
        projectId={props.project.id}
      />
      <RDTextArea
        name="remark"
        label="Remark"
        value={props.formData.remark}
        setValue={(_, value) => props.setFormData((prev) => ({ ...prev, remark: value }))}
      />
      <PaymentEntry
        list={props.formData.paymentEntries}
        handleCancelOrDelete={props.handleCancelOrDeletePaymentEntry}
        handleCreate={props.handleCreatePaymentEntry}
        isForCreateEditMode={true}
        i18n={props.i18n}
        projectId={props.project.id}
        error={props.errors.paymentEntries}
        context={props.paymentEntryContext}
        isAddPaymentEntryDisabled={isAddPaymentEntryDisabled}
        handleUpdateSuccess={props.handlePaymentEntryUpdateSuccess}
      />
    </div>
  );
};

export default CreateEditPaymentRequestForm;
