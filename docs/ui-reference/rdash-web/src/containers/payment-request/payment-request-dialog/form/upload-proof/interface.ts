import type { IPaymentRequestDialogFormData } from "../../interface";

export interface IUploadProofProps {
  form: IPaymentRequestDialogFormData;
  setFormData: (data: IPaymentRequestDialogFormData) => void;
  projectId?: string;
}
