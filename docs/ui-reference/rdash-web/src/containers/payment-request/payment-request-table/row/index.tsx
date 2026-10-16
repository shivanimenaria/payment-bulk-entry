import { type IRDActionItem, RDDropdownWithButton, RDToolTip } from "@rdash-tech/web-ui-components";
import clsx from "clsx";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  PAYMENT_REQUEST_BACKEND_ACTIONS,
  PAYMENT_REQUEST_MODE,
  PAYMENT_REQUEST_MODULE,
  PAYMENT_REQUEST_STATUS,
  PAYMENT_REQUEST_TABS,
  REQUEST_TYPE_DROPDOWN_VALUES,
} from "../../../../constants/payment-request.constants";
import useAppParams from "../../../../hooks/useAppParams";
import { useProjectLingui } from "../../../../hooks/useLingui";
import useProjectContextAction from "../../../../hooks/useProjectContextAction";
import { MoreVertIcon } from "../../../../statics/images";
import { toTitleCase } from "../../../../utils/case-conversion";
import { getFilledRoute } from "../../../../utils/common-methods";
import { getPaymentRequestModule, getPaymentRequestTableStepperRoute, isClientPayment } from "../../../../utils/payment-request";
import type { IPaymentRequestRowProps } from "./interface";

const PaymentRequestTableRow = (props: IPaymentRequestRowProps) => {
  const module = getPaymentRequestModule();
  const navigate = useNavigate();
  const { projectId = "", vendorId = "", orgId = "" } = useAppParams();
  const i18n = useProjectLingui();

  const projectIdToUse = props.data.project.id || projectId;

  const { handleAction } = useProjectContextAction(projectIdToUse);

  const actionItems: IRDActionItem[] = [
    {
      id: 1,
      name: "Edit",
      isHidden: !props.data.actions.includes(PAYMENT_REQUEST_BACKEND_ACTIONS.edit),
    },
    {
      id: 2,
      name: "Cancel",
      isHidden: !props.data.actions.includes(PAYMENT_REQUEST_BACKEND_ACTIONS.resourceCancel),
    },
  ];

  const isClientPaymentModule = useMemo(() => {
    return isClientPayment(module);
  }, [module]);

  const actionMenu = (actionId: number) => {
    if (actionId === 1) {
      const onEdit = () =>
        navigate(
          getFilledRoute(getPaymentRequestTableStepperRoute(), {
            projectId: projectIdToUse,
            vendorId: vendorId,
            orgId: orgId,
            tab: props.selectedTab,
            mode: PAYMENT_REQUEST_MODE.edit,
            type: REQUEST_TYPE_DROPDOWN_VALUES.find((item) => item.id === props.data.requestType)?.id || "",
            paymentRequestId: props.data.id,
          })
        );

      if (isClientPaymentModule) return onEdit();

      handleAction({ context: "vendor-payment-request", action: "edit", contextId: props.data.id, callback: onEdit });
    } else {
      if (isClientPaymentModule) return props.setCancelPaymentRequestId(props.data.id);

      handleAction({
        context: "vendor-payment-request",
        action: "cancel",
        contextId: props.data.id,
        callback: () => props.setCancelPaymentRequestId(props.data.id),
      });
    }
  };

  const getStatusColor = () => {
    switch (props.data.status) {
      case PAYMENT_REQUEST_STATUS.approved:
        return "color-approved";
      case PAYMENT_REQUEST_STATUS.rejected:
        return "color-rejected";
      case PAYMENT_REQUEST_STATUS.cancelled:
        return "color-cancelled";
      case PAYMENT_REQUEST_STATUS.pending:
        return "color-pending";
      case PAYMENT_REQUEST_STATUS.hold:
        return "color-hold";
      default:
        return "text-black";
    }
  };

  const openRequestDetail = () => {
    navigate(
      getFilledRoute(getPaymentRequestTableStepperRoute(), {
        projectId: projectIdToUse,
        vendorId: vendorId,
        orgId: orgId,
        tab: props.selectedTab,
        mode: PAYMENT_REQUEST_MODE.detail,
        type: REQUEST_TYPE_DROPDOWN_VALUES.find((item) => item.id === props.data.requestType)?.id || "",
        paymentRequestId: props.data.id,
      })
    );
  };

  const requestType = REQUEST_TYPE_DROPDOWN_VALUES.find((item) => item.id === props.data.requestType);

  return (
    <div
      className={clsx("display-grid cursor-pointer payment-request-table-columns font-size-14 p-20 border-b", props.className)}
      onClick={openRequestDetail}
    >
      <div className="text-center">{props.index + 1}.</div>
      <div>{i18n.date(props.data.createdAt, { dateOnly: true })}</div>
      <div>{props.data.requestNumber || "-"}</div>
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
      <div>{props.data.dueDate ? i18n.date(props.data.dueDate, { dateOnly: true }) : "-"}</div>
      <RDToolTip title={props.data.createdBy?.name}>
        <div className="text-truncate">{props.data.createdBy?.name}</div>
      </RDToolTip>
      <div className={getStatusColor()}>{toTitleCase(props.data.status)}</div>
      <RDToolTip title={i18n.number(props.data.requestAmount || "0")}>
        <div className="text-right text-truncate">{i18n.number(props.data.requestAmount || "0")}</div>
      </RDToolTip>
      <RDToolTip title={i18n.number(props.data.paymentDue || "0")}>
        <div className="text-right text-truncate">{i18n.number(props.data.paymentDue || "0")}</div>
      </RDToolTip>
      {props.selectedTab !== PAYMENT_REQUEST_TABS.paymentDue && (
        <RDToolTip title={i18n.number(props.data.paidAmount || "0")}>
          <div className="text-right font-gilroy-semi-bold text-truncate">{i18n.number(props.data.paidAmount || "0")}</div>
        </RDToolTip>
      )}
      <div className="display-flex justify-end">
        <RDDropdownWithButton
          actionItems={actionItems}
          actionMenu={actionMenu}
          onButtonClick={(e) => e.stopPropagation()}
          icon={<MoreVertIcon fontSize="small" />}
          buttonVariant="icon"
          disabled={props.data.actions.length === 0}
        />
      </div>
    </div>
  );
};

export default PaymentRequestTableRow;
