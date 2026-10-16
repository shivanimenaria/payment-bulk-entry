import type { Dispatch, SetStateAction } from "react";
import type { ILingui } from "../../../../hooks/useLingui";
import type { IPaymentRequest } from "../../../../models";
import type { IPaymentRequestFilterDropDownData } from "../../payment-request-table/interface";
import type { IPaymentRequestDialogFormData, IPaymentRequestFormErrors } from "../interface";

export interface IUsePaymentRequestDialogProps {
  selectedProject: IPaymentRequestFilterDropDownData;
  selectedTab?: string;
  handleCreateUpdateSuccess: (isCreate: boolean, data?: IPaymentRequest) => void;
  handleUpdatePaymentRequestData?: (data: IPaymentRequest) => void;
  mode?: string;
  type?: string;
  paymentRequestId?: string;
  handleUpdatePaidAmountValueInRequestList?: (id: string, value: string) => void;
}

export interface IUsePaymentRequestFormProps {
  formData: IPaymentRequestDialogFormData;
  setFormData: Dispatch<SetStateAction<IPaymentRequestDialogFormData>>;
  errors: IPaymentRequestFormErrors;
  setErrors: Dispatch<SetStateAction<IPaymentRequestFormErrors>>;
  projectName: string;
  getProjectVendorAndClientId: () => {
    projectId: string;
    vendorId: string;
    clientId: string;
  };
  mode?: string;
  type?: string;
  i18n: ILingui;
}
