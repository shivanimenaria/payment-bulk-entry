import type { IVendor } from "../../../components/generic-vendor-drop-down/interface";
import type { OBJECT_STATUS_ENUM } from "../../../enumerations/status.enum";
import type {
  IOrderData,
  IPaymentRequest,
  IPaymentRequestInvoiceDropdownData,
  IPaymentRequestPoDropdownData,
  IPaymentRequestProject,
  IProjectLignuiConfig,
} from "../../../models";
import type { IInvoiceAmountAlert } from "../../../models/invoice";
import type { IPaymentEntryListItem } from "../../../models/payment-entry";
import type { IPaymentRequestFilterDropDownData } from "../payment-request-table/interface";

export interface IPaymentRequestProof {
  id: string | null;
  uploadedAt?: string;
  file: string;
  name: string;
  objectStatus?: OBJECT_STATUS_ENUM;
}

export interface IPaymentRequestDialogFormData {
  id?: string; // for detail view
  vendor: IVendor;
  invoice: IPaymentRequestInvoiceDropdownData;
  po: IPaymentRequestPoDropdownData;
  requestBaseAmount: string;
  requestBaseAmountPercent: string;
  requestBaseAmountPercentToggle: boolean;
  includeGstPart: boolean;
  gstAmount: string;
  gstAmountPercent: string;
  gstAmountPercentToggle: boolean;
  remark: string;
  requestNumber?: string; // for detail view
  project?: IPaymentRequestProject; // for detail view
  createdById?: string;
  status?: string; // for detail view
  requestId?: string;
  actions?: string[];
  requestType?: string;
  orderNumber?: string;
  orderType?: string;
  paidTillDate?: string;
  dueDate?: string;
  paymentEntries: IPaymentEntryListItem[];
  proofs: IPaymentRequestProof[];
  paymentDue?: string;
  order?: IOrderData;
  maxPaymentEntryAllowed?: string;
  hasAlert?: boolean;
  alert?: IInvoiceAmountAlert;
  projectConfig?: IProjectLignuiConfig;
}

export interface IPaymentRequestFormErrors {
  vendor: string;
  invoice: string;
  po: string;
  requestBaseAmount: string;
  gstAmount: string;
  requestAmount: string;
  paymentEntries?: string;
}

export interface IPaymentRequestCreateEditDetailDialogProps {
  selectedProject: IPaymentRequestFilterDropDownData;
  selectedTab?: string;
  handleCreateUpdateSuccess: (isCreate: boolean, data?: IPaymentRequest) => void;
  handleUpdatePaymentRequestData?: (data: IPaymentRequest) => void;
  mode?: string;
  type?: string;
  handleClose?: () => void;
  paymentRequestId?: string;
  handleUpdatePaidAmountValueInRequestList?: (id: string, value: string) => void;
}
