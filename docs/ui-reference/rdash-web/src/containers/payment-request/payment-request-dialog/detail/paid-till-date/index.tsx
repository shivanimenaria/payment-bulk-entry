import { RDInputReadonly, RDToolTip } from "@rdash-tech/web-ui-components";
import clsx from "clsx";
import useModal from "../../../../../hooks/useModal";
import { ClickAwayListener, Skeleton } from "../../../../../mui-imports";
import { paymentRequestApi } from "../../../../../services/payment-request.service";
import { InfoOutlinedIcon } from "../../../../../statics/images";
import type { IPaidTillDateInfoProps, IPaidTillDateProps } from "./interface";
import "./style.css";

const PaidTillDateSkeleton = () => {
  return (
    <div className="display-flex flex-col">
      <div className="px-5">
        <Skeleton height={80} />
      </div>
      <div className="display-flex flex-1 flex-col gap-10 p-5 pb-10">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            className="flex-1 display-flex gap-20"
            key={index}
          >
            <Skeleton
              height={20}
              width={100}
            />
            <Skeleton
              height={20}
              width={100}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

const PaidTillDateInfo = ({ paymentRequestId, ...props }: IPaidTillDateInfoProps) => {
  const { data, isLoading } = paymentRequestApi.useGetPaidTillDateDetailQuery(paymentRequestId, { refetchOnMountOrArgChange: true });

  const poAvailable = data?.poPaidTillDate && data?.poPaidTillDate?.length > 0;
  const invoiceAvailable = data?.invoicePaidTillDate && data?.invoicePaidTillDate?.length > 0;

  if (isLoading) return <PaidTillDateSkeleton />;

  return (
    <div className="paid-till-date-info display-flex flex-col overflow-scroll">
      <div className={clsx("p-8 font-light font-size-12 rounded-6", { "bg-edeff2": invoiceAvailable || poAvailable })}>
        {data?.summaryText}
      </div>
      {(invoiceAvailable || poAvailable) && (
        <div className="flex-1 p-5 overflow-auto display-flex flex-col gap-5 vertical-scrollbar">
          <div className="font-medium font-size-12 py-5">Summary</div>

          {poAvailable && (
            <div className="display-flex gap-5">
              <div className="flex-1 overflow-hidden">
                <div className="py-5 text-6e6e6e">PO</div>
                {data?.poPaidTillDate.map((item, idx) => (
                  <RDToolTip
                    placement="top-start"
                    title={item.poNumber}
                    key={idx}
                  >
                    <div className="text-truncate">{item.poNumber}</div>
                  </RDToolTip>
                ))}
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="py-5 text-6e6e6e">Paid</div>
                {data?.poPaidTillDate.map((item, idx) => (
                  <RDToolTip
                    placement="top-start"
                    title={props.i18n.number(item.amount || "0")}
                    key={idx}
                  >
                    <div className="text-truncate">{props.i18n.number(item.amount || "0")}</div>
                  </RDToolTip>
                ))}
              </div>
            </div>
          )}
          {invoiceAvailable && (
            <div className="display-flex gap-5">
              <div className="flex-1 overflow-hidden">
                <div className="py-5 text-6e6e6e">Invoice</div>
                {data?.invoicePaidTillDate.map((item, idx) => (
                  <RDToolTip
                    placement="top-start"
                    title={item.invoiceNumber}
                    key={idx}
                  >
                    <div className="text-truncate">{item.invoiceNumber}</div>
                  </RDToolTip>
                ))}
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="py-5 text-6e6e6e">Paid</div>
                {data?.invoicePaidTillDate.map((item, idx) => (
                  <RDToolTip
                    placement="top-start"
                    title={props.i18n.number(item.amount || "0")}
                    key={idx}
                  >
                    <div className="text-truncate">{props.i18n.number(item.amount || "0")}</div>
                  </RDToolTip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const PaidTillDate = (props: IPaidTillDateProps) => {
  const popUp = useModal();
  return (
    <div className="display-flex gap-2">
      <div>
        <RDInputReadonly
          label="Paid Till Date"
          labelJsx={
            <ClickAwayListener onClickAway={popUp.close}>
              <div>
                <RDToolTip
                  title={
                    <PaidTillDateInfo
                      paymentRequestId={props.paymentRequestId}
                      i18n={props.i18n}
                    />
                  }
                  open={popUp.isOpen}
                  placement="top"
                  width="270px"
                  distanceFromAnchor={[50]}
                >
                  <span
                    className={clsx("display-flex cursor-pointer", { "display-none": props.isLoading })}
                    onClick={popUp.toggle}
                  >
                    <InfoOutlinedIcon className="paid-till-date-info-icon" />
                  </span>
                </RDToolTip>
              </div>
            </ClickAwayListener>
          }
          isLoading={props.isLoading}
          className="paid-till-date-info"
        >
          {props.i18n.number(props.paidTillDateAmount || "0")}
        </RDInputReadonly>
      </div>
    </div>
  );
};

export default PaidTillDate;
