import { type IRDActionItem, RDDropdownWithButton, RDToolTip } from "@rdash-tech/web-ui-components";
import clsx from "clsx";
import { useMemo } from "react";
import {
  PAYMENT_METHOD_DROPDOWN_VALUES,
  PAYMENT_REQUEST_MODULE,
  REQUEST_TYPE_DROPDOWN_VALUES,
} from "../../../../constants/payment-request.constants";
import { PAYMENT_ENTRY_ACTION } from "../../../../enumerations/payment-entry.enum";
import { useProjectLingui } from "../../../../hooks/useLingui";
import useProjectContextAction from "../../../../hooks/useProjectContextAction";
import { MoreVertIcon } from "../../../../statics/images";
import { getPaymentEntryTableGridColumnsClass, getPaymentRequestModule } from "../../../../utils/payment-request";
import type { IPaymentEntryRowProps } from "./interface";

const PaymentEntryTableRow = (props: IPaymentEntryRowProps) => {
  const module = getPaymentRequestModule();
  const i18n = useProjectLingui();

  const isClientPayments = useMemo(() => {
    return [PAYMENT_REQUEST_MODULE.boqPaymentRequest, PAYMENT_REQUEST_MODULE.manageClientPaymentRequest].includes(module);
  }, [module]);

  const { handleAction } = useProjectContextAction(props.data.project.id || "");

  const actionItems: IRDActionItem[] = [
    {
      id: 1,
      name: "Cancel",
      isHidden: isClientPayments ? props.data.canCancel === false : !props.data.actions?.includes(PAYMENT_ENTRY_ACTION.CANCEL),
    },
    {
      id: 2,
      name: "Edit",
      isHidden: isClientPayments ? true : !props.data.actions?.includes(PAYMENT_ENTRY_ACTION.EDIT),
    },
  ];

  const actionMenu = (actionId: number) => {
    switch (actionId) {
      case 1: {
        if (isClientPayments) return props.handleCancel(props.data.id);
        return handleAction({
          context: "vendor-payment-entry",
          action: "cancel",
          contextId: props.data.id,
          callback: () => props.handleCancel(props.data.id),
        });
      }
      case 2: {
        if (isClientPayments) return props.handleEdit(props.data.id);
        return handleAction({
          context: "vendor-payment-entry",
          action: "edit",
          contextId: props.data.id,
          callback: () => props.handleEdit(props.data.id),
        });
      }
    }
  };

  const getStatusColor = () => {
    if (props.data.isCancelled) return "color-cancelled";
    else return "text-black";
  };

  const requestType = REQUEST_TYPE_DROPDOWN_VALUES.find((item) => item.id === props.data.requestType);
  const paymentMethod = PAYMENT_METHOD_DROPDOWN_VALUES.find((item) => item.id === props.data.paymentMode);

  return (
    <>
      <div
        className={clsx(
          "display-grid cursor-pointer payment-entry-table-columns font-size-14 p-20 border-b",
          getPaymentEntryTableGridColumnsClass()
        )}
        onClick={() => props.openPaymentEntryDetail(props.data.id)}
      >
        <div className="text-center">{props.index + 1}.</div>
        <div>{i18n.date(props.data.paymentDate, { dateOnly: true })}</div>
        <div>{props.data.requestNumber || "-"}</div>
        <RDToolTip title={props.data.transactionId}>
          <div className="text-truncate">{props.data.transactionId || "-"}</div>
        </RDToolTip>
        <div>{paymentMethod?.name}</div>
        {[PAYMENT_REQUEST_MODULE.manageClientPaymentRequest, PAYMENT_REQUEST_MODULE.manageVendorPaymentRequest].includes(module) && (
          <RDToolTip title={props.data.project?.name}>
            <div className="text-truncate">{props.data.project?.name}</div>
          </RDToolTip>
        )}
        {module === PAYMENT_REQUEST_MODULE.orderPaymentRequest && (
          <RDToolTip title={props.data.vendor?.name}>
            <div className="text-truncate">{props.data.vendor?.name}</div>
          </RDToolTip>
        )}
        <div>{requestType?.name}</div>
        <RDToolTip title={`${props.data.createdBy?.name}, ${i18n.date(props.data.createdAt, { dateOnly: true })}`}>
          <div className="text-truncate">
            {props.data.createdBy?.name}, {i18n.date(props.data.createdAt, { dateOnly: true })}
          </div>
        </RDToolTip>
        <div className={getStatusColor()}>{props.data.isCancelled ? "Cancelled" : "Submitted"}</div>
        <div className="text-right font-gilroy-semi-bold text-truncate">
          <RDToolTip title={i18n.number(props.data.amount || "0")}>
            <span>{i18n.number(props.data.amount || "0")}</span>
          </RDToolTip>
        </div>
        <div className="display-flex justify-end">
          <RDDropdownWithButton
            actionItems={actionItems}
            actionMenu={actionMenu}
            onButtonClick={(e) => e.stopPropagation()}
            icon={<MoreVertIcon fontSize="small" />}
            buttonVariant="icon"
          />
        </div>
      </div>
    </>
  );
};

export default PaymentEntryTableRow;
