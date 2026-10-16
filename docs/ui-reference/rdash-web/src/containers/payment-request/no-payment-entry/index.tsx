import { ExpenseIcon } from "../../../statics/images";

const NoPaymentEntry = () => {
  return (
    <div className="display-flex align-center justify-center gap-20 flex-col h-full text-d0d5dd">
      <ExpenseIcon
        height={90}
        width={90}
      />
      <div className="font-size-24 font-semi-bold">No Payment Entry data to show</div>
    </div>
  );
};

export default NoPaymentEntry;
