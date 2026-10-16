import { useSearchParams } from "react-router-dom";
import { PAYMENT_REQUEST_CREATE_TYPE, REQUEST_TYPE_DROPDOWN_VALUES } from "../../../../constants/payment-request.constants";
import { Skeleton } from "../../../../mui-imports";

const PaymentRequestEditFormLoader = () => {
  const [search] = useSearchParams();
  const type = search.get("type");
  const requestType = REQUEST_TYPE_DROPDOWN_VALUES.find((item) => item.id === type) || REQUEST_TYPE_DROPDOWN_VALUES[0];

  return (
    <div className="display-flex flex-col gap-20 px-20">
      {Array.from({ length: requestType.id === PAYMENT_REQUEST_CREATE_TYPE.againstInvoice ? 5 : 4 }).map((_, index) => (
        <div
          className="display-flex flex-col gap-5"
          key={index}
        >
          <Skeleton
            variant="text"
            width={200}
            height={20}
          />
          <Skeleton
            variant="rounded"
            height={30}
          />
        </div>
      ))}
      <div className="display-flex justify-between">
        <Skeleton
          variant="text"
          width={200}
          height={20}
        />
        <Skeleton
          variant="rounded"
          width={50}
          height={20}
        />
      </div>
      <div className="display-flex flex-col gap-5">
        <Skeleton
          variant="text"
          width={200}
          height={20}
        />
        <Skeleton
          variant="rounded"
          height={150}
        />
      </div>
    </div>
  );
};

export default PaymentRequestEditFormLoader;
