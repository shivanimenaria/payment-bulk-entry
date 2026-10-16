import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import type { IVendor } from "../../../../components/generic-vendor-drop-down/interface";
import {
  PAYMENT_REQUEST_CREATE_TYPE,
  PAYMENT_REQUEST_MODULE,
  REQUEST_TYPE_DROPDOWN_VALUES,
} from "../../../../constants/payment-request.constants";
import { useAppSelector } from "../../../../hooks/store";
import type { IPaymentRequestInvoiceDropdownData, IPaymentRequestPoDropdownData } from "../../../../models";
import { projectSelector } from "../../../../reducers/project.reducer";
import {
  useLazyGetPaymentRequestInvoiceDropdownDataQuery,
  useLazyGetPaymentRequestPoDropdownDataQuery,
} from "../../../../services/payment-request.service";
import { isSearchValueExist } from "../../../../utils/common-methods";
import { getPaymentRequestModule, paymentRequestInitialFormData } from "../../../../utils/payment-request";
import type { IUsePaymentRequestFormProps } from "./interface";

const usePaymentRequestForm = (props: IUsePaymentRequestFormProps) => {
  const [search] = useSearchParams();
  const type = props.type ?? search.get("type");
  const mode = props.mode ?? search.get("mode") ?? "";
  const module = getPaymentRequestModule();
  const [fetchPoDropDownData, poDropdownState] = useLazyGetPaymentRequestPoDropdownDataQuery();
  const [fetchInvoiceDropDownData, invoiceDropdownState] = useLazyGetPaymentRequestInvoiceDropdownDataQuery();
  const { projectId, vendorId, clientId } = props.getProjectVendorAndClientId();

  const store = {
    projectClientId: useAppSelector(projectSelector.clientId),
  };

  const requestType = REQUEST_TYPE_DROPDOWN_VALUES.find((item) => item.id === type) || REQUEST_TYPE_DROPDOWN_VALUES[0];

  const invoiceSearchFilter = (item: IPaymentRequestInvoiceDropdownData, search: string) => {
    return isSearchValueExist(search, item.invoiceNumber) || isSearchValueExist(search, item.po.orderNumber);
  };

  const handleSelectInvoice = (value: IPaymentRequestInvoiceDropdownData | null) => {
    props.setFormData((prev) => ({
      ...prev,
      invoice: value || paymentRequestInitialFormData.invoice,
    }));
    value && props.setErrors((prev) => ({ ...prev, invoice: "" }));
  };

  const handleSelectPo = (value: IPaymentRequestPoDropdownData | null) => {
    props.setFormData((prev) => ({
      ...prev,
      po: value || paymentRequestInitialFormData.po,
    }));
    value && props.setErrors((prev) => ({ ...prev, po: "" }));
  };

  const poSearchFilter = (item: IPaymentRequestPoDropdownData, search: string) => {
    return isSearchValueExist(search, item.poNumber) || isSearchValueExist(search, item.orderNumber);
  };

  const isInvoiceDropDownDisabled = () => {
    if (requestType.id === PAYMENT_REQUEST_CREATE_TYPE.againstInvoice) {
      if (module === PAYMENT_REQUEST_MODULE.orderPaymentRequest) {
        return !props.formData.vendor.id;
      }
    }
    return false;
  };

  const isPoDropDownDisabled = () => {
    if (requestType.id === PAYMENT_REQUEST_CREATE_TYPE.poAdvance) {
      if (module === PAYMENT_REQUEST_MODULE.orderPaymentRequest) {
        return !props.formData.vendor.id;
      }
    }
    return false;
  };

  const handleSelectVendor = (value: IVendor | null) => {
    if (value?.id !== props.formData.vendor.id) {
      props.setFormData((prev) => ({
        ...prev,
        vendor: { id: value?.id || "", name: value?.name || "", code: value?.code || "" },
        invoice: paymentRequestInitialFormData.invoice,
      }));
    }
    value && props.setErrors((prev) => ({ ...prev, vendor: "" }));
  };

  useEffect(() => {
    if (vendorId && projectId) {
      if (requestType.id === PAYMENT_REQUEST_CREATE_TYPE.againstInvoice) {
        fetchInvoiceDropDownData({ project_id: projectId, client_id: clientId, vendor_id: vendorId });
      } else {
        fetchPoDropDownData({ project_id: projectId, client_id: clientId, vendor_id: vendorId });
      }
    }
  }, [vendorId, projectId]);

  return {
    state: {
      poDropdownState,
      invoiceDropdownState,
      store,
      projectId,
      vendorId,
      clientId,
    },
    otherData: { module, requestType, mode },
    handlers: {
      handleSelectInvoice,
      handleSelectPo,
      handleSelectVendor,
      isPoDropDownDisabled,
      isInvoiceDropDownDisabled,
      poSearchFilter,
      invoiceSearchFilter,
    },
  };
};

export default usePaymentRequestForm;
