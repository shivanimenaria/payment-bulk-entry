import { RDCheckBox, RDInputLabel, RDNumberInput, RDPercentInput, RDSwitch } from "@rdash-tech/web-ui-components";
import clsx from "clsx";
import { PAYMENT_REQUEST_CREATE_TYPE } from "../../../../constants/payment-request.constants";
import type { ILingui } from "../../../../hooks/useLingui";
import { amountSchema } from "../../../../schema";
import { bigNumber } from "../../../../utils/big-number";
import { roundAmount } from "../../../../utils/common-methods";
import type { getRequestAmountsType } from "../hooks/usePaymentRequestDialog";
import type { IPaymentRequestDialogFormData, IPaymentRequestFormErrors } from "../interface";

interface RequestedGstAmountInputProps {
  formData: IPaymentRequestDialogFormData;
  errors: IPaymentRequestFormErrors;
  setErrors: (errors: IPaymentRequestFormErrors) => void;
  setFormData: (data: IPaymentRequestDialogFormData) => void;
  getRequestAmounts: getRequestAmountsType;
  type: string;
  i18n: ILingui;
}

const RequestedGstAmountInput = ({ formData, errors, setErrors, setFormData, ...props }: RequestedGstAmountInputProps) => {
  const { taxAmountForPercentageInput, requestingTaxAmount } = props.getRequestAmounts();
  const type = props.type;
  const nonOrder = type === PAYMENT_REQUEST_CREATE_TYPE.nonOrder;
  const againstInvoice = type === PAYMENT_REQUEST_CREATE_TYPE.againstInvoice;
  const { multiply, divide } = bigNumber;

  const handleTogglePercentChange = () => {
    if (formData.gstAmountPercentToggle) {
      setFormData({
        ...formData,
        gstAmount: roundAmount(multiply(divide(formData.gstAmountPercent || "0", "100"), taxAmountForPercentageInput || "0")),
        gstAmountPercentToggle: false,
        gstAmountPercent: "",
      });
    } else {
      setFormData({
        ...formData,
        gstAmountPercentToggle: true,
        gstAmount: "",
        gstAmountPercent: "",
      });
    }
    setErrors({
      ...errors,
      gstAmount: "",
      requestAmount: "",
    });
  };

  const handleChangeAmount = (_: string, value: string) => {
    setFormData({
      ...formData,
      gstAmount: value,
    });
    setErrors({
      ...errors,
      gstAmount: "",
      requestAmount: "",
    });
  };

  const handlePercentChange = (_: string, value: string) => {
    setFormData({
      ...formData,
      gstAmountPercent: value,
    });
    setErrors({
      ...errors,
      gstAmount: "",
      requestAmount: "",
    });
  };

  const toggleGst = () => {
    setFormData({
      ...formData,
      includeGstPart: !formData.includeGstPart,
      gstAmount: "",
      gstAmountPercent: "",
    });
    setErrors({
      ...errors,
      gstAmount: "",
    });
  };

  return (
    <div>
      <div className="mt-5 display-flex justify-between">
        <div className="display-flex gap-5">
          <RDCheckBox
            isSelected={formData.includeGstPart}
            handleSelect={toggleGst}
            handleUnSelect={toggleGst}
            size={15}
          />
          <RDInputLabel label={`${props.i18n.tax.name} Amount`} />
        </div>
        {!nonOrder && (
          <span
            className={clsx("display-flex gap-5 font-size-14 items-center text-667085", {
              disabled: !formData.includeGstPart,
            })}
          >
            %
            <RDSwitch
              size={15}
              checked={formData.gstAmountPercentToggle}
              onChange={handleTogglePercentChange}
            />
          </span>
        )}
      </div>
      <div
        className={clsx("mt-5", {
          disabled: !formData.includeGstPart,
        })}
      >
        {formData.gstAmountPercentToggle ? (
          <div className="display-flex flex-col mt-5 gap-10">
            <div className="display-flex items-center">
              <div className="flex-1 overflow-hidden">
                <div className="payment-request-percent-input">
                  <RDPercentInput
                    name="requestAmountPercent"
                    value={formData.gstAmountPercent}
                    setValue={handlePercentChange}
                    showError={!!errors.gstAmount}
                    error={errors.gstAmount || errors.gstAmount}
                  />
                </div>
              </div>
              <div>{props.i18n.number(requestingTaxAmount)}</div>
            </div>
            <div className="font-semi-bold font-size-12 text-italic text-7f8ea4">
              {`* ${props.i18n.tax.name} % is applied to ${againstInvoice ? "Invoice" : "PO"} ${props.i18n.tax.name} Amount , not the Base Amount`}
            </div>
          </div>
        ) : (
          <RDNumberInput
            required
            name="requestAmount"
            placeholder="Enter Amount"
            value={formData.gstAmount}
            validateNumber={(value) => amountSchema.safeParse(value).success}
            setValue={handleChangeAmount}
            showError={!!errors.gstAmount}
            error={errors.gstAmount || errors.requestAmount}
          />
        )}
      </div>
    </div>
  );
};

export default RequestedGstAmountInput;
