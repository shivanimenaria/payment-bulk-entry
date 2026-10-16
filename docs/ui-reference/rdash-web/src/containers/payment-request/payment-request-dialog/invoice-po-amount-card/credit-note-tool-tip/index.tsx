import { RDToolTip } from "@rdash-tech/web-ui-components";
import useModal from "../../../../../hooks/useModal";
import { ClickAwayListener } from "../../../../../mui-imports";
import { InfoOutlinedIcon } from "../../../../../statics/images";
import type { ICreditNoteToolTipProps, ICreditNoteToolTipSectionProps } from "../interface";

const CreditNoteToolTipSection = (props: ICreditNoteToolTipSectionProps) => {
  return (
    <div className="font-size-12 display-flex flex-col gap-5 text-7f8ea4">
      <div className="display-flex justify-between text-primary gap-20">
        <span className="font-medium">{props.title}</span>
        <span className="font-semi-bold">{props.amount}</span>
      </div>
      <div className="display-flex justify-between gap-20">
        <span className="font-medium">Amount</span>
        <span className="font-semi-bold">{props.baseAmount}</span>
      </div>
      <div className="display-flex justify-between gap-20">
        <span className="font-medium">{`${props.i18n.tax.name} Amount`}</span>
        <span className="font-semi-bold">{props.taxAmount}</span>
      </div>
    </div>
  );
};

const CreditNoteToolTip = ({ i18n, getFormattedAmount, invoiceTotalData }: ICreditNoteToolTipProps) => {
  const toolTipModal = useModal();

  if (!invoiceTotalData?.hasCreditNote) return null;
  return (
    <RDToolTip
      open={toolTipModal.isOpen}
      title={
        <ClickAwayListener onClickAway={toolTipModal.close}>
          <div className="w-fit display-flex flex-col gap-10 p-5 min-w-180">
            <CreditNoteToolTipSection
              title="INVOICE"
              i18n={i18n}
              amount={getFormattedAmount(invoiceTotalData.totalAmount)}
              taxAmount={getFormattedAmount(invoiceTotalData.taxAmount)}
              baseAmount={getFormattedAmount(invoiceTotalData.baseAmount)}
            />
            <CreditNoteToolTipSection
              title="CREDIT NOTE"
              i18n={i18n}
              amount={getFormattedAmount(invoiceTotalData.creditNoteTotalAmount ?? "0")}
              taxAmount={getFormattedAmount(invoiceTotalData.creditNoteTaxAmount ?? "0")}
              baseAmount={getFormattedAmount(invoiceTotalData.creditNoteBaseAmount ?? "0")}
            />
          </div>
        </ClickAwayListener>
      }
      placement="top"
    >
      <div
        onClick={toolTipModal.toggle}
        className="display-flex cursor-pointer"
      >
        <InfoOutlinedIcon className="form-amount-card-header-icon" />
      </div>
    </RDToolTip>
  );
};

export default CreditNoteToolTip;
