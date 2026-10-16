import { RDInputError, RDInputLabel, RDNumberInput, RDPercentInput, RDSwitch } from "@rdash-tech/web-ui-components";
import { PAYMENT_REQUEST_CREATE_TYPE } from "../../../../constants/payment-request.constants";
import type { ILingui } from "../../../../hooks/useLingui";
import { amountSchema } from "../../../../schema";
import { bigNumber } from "../../../../utils/big-number";
import { roundAmount } from "../../../../utils/common-methods";
import type { getRequestAmountsType } from "../hooks/usePaymentRequestDialog";
import type { IPaymentRequestDialogFormData, IPaymentRequestFormErrors } from "../interface";

interface RequestedAmountInputProps {
  formData: IPaymentRequestDialogFormData;
  errors: IPaymentRequestFormErrors;
  setErrors: (errors: IPaymentRequestFormErrors) => void;
  setFormData: (data: IPaymentRequestDialogFormData) => void;
  getRequestAmounts: getRequestAmountsType;
  type: string;
  i18n: ILingui;
}

const RequestedAmountInput = ({ formData, errors, setErrors, setFormData, ...props }: RequestedAmountInputProps) => {
  const type = props.type;
  const nonOrder = type === PAYMENT_REQUEST_CREATE_TYPE.nonOrder;
  const { baseAmountForPercentageInput, requestingBaseAmount } = props.getRequestAmounts();
  const { add, multiply, divide } = bigNumber;

  const handleToggleChange = () => {
    /*
    Business logic:
    when changed from % to amount, amount is kept
    when changed from amount to %, amount is cleared
    */
    if (formData.requestBaseAmountPercentToggle) {
      setFormData({
        ...formData,
        requestBaseAmountPercentToggle: false,
        requestBaseAmount: roundAmount(
          multiply(divide(formData.requestBaseAmountPercent || "0", 100), baseAmountForPercentageInput || "0")
        ),
        requestBaseAmountPercent: "",
      });
    } else {
      setFormData({
        ...formData,
        requestBaseAmountPercentToggle: true,
        requestBaseAmount: "",
        requestBaseAmountPercent: "",
      });
    }
    setErrors({
      ...errors,
      requestBaseAmount: "",
    });
  };

  const handleAmountChange = (_: string, value: string) => {
    setFormData({
      ...formData,
      requestBaseAmount: value,
    });
    setErrors({
      ...errors,
      requestBaseAmount: "",
      requestAmount: "",
    });
  };

  const handlePercentChange = (_: string, value: string) => {
    setFormData({
      ...formData,
      requestBaseAmountPercent: value,
    });
    setErrors({
      ...errors,
      requestBaseAmount: "",
      requestAmount: "",
    });
  };

  return (
    <div>
      <RDInputLabel
        required
        label="Request Amount"
      />
      <RDInputError
        error={errors.requestAmount}
        showError={!!errors.requestAmount}
      />
      <div className="mt-5 display-flex justify-between">
        <RDInputLabel label="Base Amount" />
        {!nonOrder && (
          <span className="display-flex gap-5 font-size-14 items-center text-667085">
            %
            <RDSwitch
              size={15}
              checked={formData.requestBaseAmountPercentToggle}
              onChange={handleToggleChange}
            />
          </span>
        )}
      </div>
      <div className="mt-5">
        {formData.requestBaseAmountPercentToggle ? (
          <div className="display-flex mt-5 items-center">
            <div className="flex-1 overflow-hidden">
              <div className="payment-request-percent-input">
                <RDPercentInput
                  name="requestAmountPercent"
                  value={formData.requestBaseAmountPercent}
                  setValue={handlePercentChange}
                  error={errors.requestBaseAmount || errors.requestAmount}
                  showError={!!errors.requestBaseAmount}
                />
              </div>
            </div>
            <div>{props.i18n.number(requestingBaseAmount)}</div>
          </div>
        ) : (
          <RDNumberInput
            required
            name="requestAmount"
            placeholder="Enter Amount"
            value={formData.requestBaseAmount}
            validateNumber={(value) => amountSchema.safeParse(value).success}
            setValue={handleAmountChange}
            showError={!!errors.requestBaseAmount}
            error={errors.requestBaseAmount || errors.requestAmount}
          />
        )}
      </div>
    </div>
  );
};

export default RequestedAmountInput;
