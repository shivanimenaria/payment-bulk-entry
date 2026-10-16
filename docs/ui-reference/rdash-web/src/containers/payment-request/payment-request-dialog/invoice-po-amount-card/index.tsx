import { RDInputLabel, RDLabel, RDToolTip } from "@rdash-tech/web-ui-components";
import { PAYMENT_REQUEST_CREATE_TYPE } from "../../../../constants/payment-request.constants";
import type { ILingui } from "../../../../hooks/useLingui";
import useModal from "../../../../hooks/useModal";
import type { IPaymentRequestFormAmount } from "../../../../models";
import { ClickAwayListener } from "../../../../mui-imports";
import { InfoOutlinedIcon } from "../../../../statics/images";
import { bigNumber } from "../../../../utils/big-number";
import CardItem from "./card-item";
import CreditNoteToolTip from "./credit-note-tool-tip";
import type { IInvoicePoAmountCardProps } from "./interface";
import "./style.css";
interface IPODataInfo {
  data: IPaymentRequestFormAmount;
  i18n: ILingui;
  close: () => void;
}

const PODataInfo = ({ data, i18n, close }: IPODataInfo) => {
  const alreadyRequestedAmount = `${i18n.currencySymbol} ${i18n.number(data.totalRequestedAmount)}`;
  const baseAmount = `${i18n.currencySymbol} ${i18n.number(data.totalRequestedBaseAmount)}`;
  const taxAmount = `${i18n.currencySymbol} ${i18n.number(data.totalRequestedTaxAmount)}`;
  const paidAmount = `${i18n.currencySymbol} ${i18n.number(data.paidAmount)}`;

  return (
    <ClickAwayListener onClickAway={close}>
      <div className="display-flex flex-col gap-5 font-size-12 text-344054 font-medium p-5">
        <div className="display-flex justify-between gap-20">
          <div className="font-semi-bold">Already requested amount</div>
          <div>{alreadyRequestedAmount}</div>
        </div>
        <div className="display-flex justify-between gap-20">
          <div>Base Amount</div>
          <div>{baseAmount}</div>
        </div>
        <div className="display-flex justify-between gap-20">
          <div>{i18n.tax.name}</div>
          <div>{taxAmount}</div>
        </div>
        <div className="display-flex justify-between gap-20">
          <div className="font-semi-bold">Paid Amount</div>
          <div>{paidAmount}</div>
        </div>
      </div>
    </ClickAwayListener>
  );
};

const InvoicePoAmountCard = ({ invoicePoCardData, ...props }: IInvoicePoAmountCardProps) => {
  const poDataInfo = useModal();

  const isInvoiceCardHidden = props.requestType !== PAYMENT_REQUEST_CREATE_TYPE.againstInvoice;
  const isPoCardHidden = !!props.invoice.invoiceNumber && !props.invoice.po.poNumber;

  const getFormattedAmount = (amount: string) => {
    return props.i18n.currencySymbol + props.i18n.number(bigNumber.roundOffByDroppingDecimals(amount));
  };

  return (
    <div className="display-flex gap-10 flex-col">
      {!isInvoiceCardHidden && !isPoCardHidden && (
        <div className="display-flex gap-10 items-center">
          <RDInputLabel label="PO Number :" />
          {props.invoice.po.poNumber && (
            <RDLabel
              color="grey"
              className="font-semi-bold"
              size="large"
            >
              {props.invoice.po.poNumber}
            </RDLabel>
          )}
          {!!props.invoice.po.poNumber.toString() && !!invoicePoCardData?.po && !!invoicePoCardData.hasPaymentRequests && (
            <RDToolTip
              instantOpen
              open={poDataInfo.isOpen}
              title={
                <PODataInfo
                  data={invoicePoCardData.po}
                  i18n={props.i18n}
                  close={poDataInfo.close}
                />
              }
            >
              <InfoOutlinedIcon
                className="po-data-info cursor-pointer"
                onClick={poDataInfo.toggle}
              />
            </RDToolTip>
          )}
        </div>
      )}
      <div className="display-grid grid-cols-2-equal gap-10">
        {!isInvoiceCardHidden && (
          <CardItem
            amount={getFormattedAmount(invoicePoCardData?.invoice.totalAmount ?? "0")}
            taxAmount={getFormattedAmount(invoicePoCardData?.invoice.taxAmount ?? "0")}
            baseAmount={getFormattedAmount(invoicePoCardData?.invoice.baseAmount ?? "0")}
            i18n={props.i18n}
            title="INVOICE AMOUNT"
            isStretched={isPoCardHidden}
            infoNode={
              <CreditNoteToolTip
                i18n={props.i18n}
                getFormattedAmount={getFormattedAmount}
                invoiceTotalData={invoicePoCardData?.invoiceTotalData}
              />
            }
          />
        )}
        {!isPoCardHidden && (
          <CardItem
            amount={getFormattedAmount(invoicePoCardData?.po.totalAmount ?? "0")}
            taxAmount={getFormattedAmount(invoicePoCardData?.po.taxAmount ?? "0")}
            baseAmount={getFormattedAmount(invoicePoCardData?.po.baseAmount ?? "0")}
            i18n={props.i18n}
            title="PO AMOUNT"
            isStretched={isInvoiceCardHidden}
          />
        )}
        <CardItem
          amount={getFormattedAmount(invoicePoCardData?.alreadyRequested.totalAmount ?? "0")}
          taxAmount={getFormattedAmount(invoicePoCardData?.alreadyRequested.taxAmount ?? "0")}
          baseAmount={getFormattedAmount(invoicePoCardData?.alreadyRequested.baseAmount ?? "0")}
          i18n={props.i18n}
          title="ALREADY REQUESTED"
        />
        <CardItem
          amount={getFormattedAmount(invoicePoCardData?.paidAmount ?? "0")}
          i18n={props.i18n}
          title="PAID AMOUNT"
        />
      </div>
      <CardItem
        amount={getFormattedAmount(invoicePoCardData?.requestable.totalAmount || "0")}
        taxAmount={getFormattedAmount(invoicePoCardData?.requestable.taxAmount || "0")}
        baseAmount={getFormattedAmount(invoicePoCardData?.requestable.baseAmount || "0")}
        i18n={props.i18n}
        title="Requestable Amount"
        className="form-request-amount-card"
      />
    </div>
  );
};

export default InvoicePoAmountCard;
