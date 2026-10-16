import clsx from "clsx";
import { APP_ROUTE_PATH } from "../../../../enumerations/common.enum";
import { Skeleton } from "../../../../mui-imports";
import { isRouteMatched } from "../../../../utils/common-methods";
import { getPaymentRequestTableGridColumnsClass } from "../../../../utils/payment-request";
import type { IPaymentRequestRowsLoaderProps } from "./interface";

const PaymentRequestRowsLoader = (props: IPaymentRequestRowsLoaderProps) => {
  return (
    <>
      {Array.from({ length: props.noOfRows }).map((item, index) => {
        return (
          <div
            className={clsx(
              "display-grid payment-request-table-columns font-size-14 p-20 border-b",
              getPaymentRequestTableGridColumnsClass()
            )}
            key={index}
          >
            <div>
              <Skeleton width={20} />
            </div>
            <div>
              <Skeleton />
            </div>
            <div>
              <Skeleton />
            </div>
            {(isRouteMatched(APP_ROUTE_PATH.MyVendorVendorPaymentsViewWithoutQuery) ||
              isRouteMatched(APP_ROUTE_PATH.ManageClientClientPaymentsViewWithoutQuery)) && (
              <div>
                <Skeleton />
              </div>
            )}
            {isRouteMatched(APP_ROUTE_PATH.OrderVendorPaymentsViewWithoutQuery) && (
              <div>
                {" "}
                <Skeleton />
              </div>
            )}
            <div>
              <Skeleton />
            </div>
            <div>
              <Skeleton />
            </div>
            <div>
              <Skeleton />
            </div>
            <div className="text-right">
              <Skeleton />
            </div>
            <div className="text-right">
              <Skeleton />
            </div>
            <div className="display-flex justify-end">
              <Skeleton
                width={10}
                height={20}
              />
            </div>
          </div>
        );
      })}
    </>
  );
};

export default PaymentRequestRowsLoader;
