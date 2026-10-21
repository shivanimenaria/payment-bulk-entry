import { RDButtonV2, RDPrompt } from "@rdash-tech/web-ui-components";
import "./style.css";

interface ISetUpdateMethodConfirmationModalProps {
  onApply: () => void;
  isLoading?: boolean;
  onCancel: () => void;
}

const SetUpdateMethodConfirmationModal = (props: ISetUpdateMethodConfirmationModalProps) => {
  return (
    <RDPrompt
      open
      showIcon
      className="update-method-confirmation-modal"
    >
      <div className="display-flex flex-col justify-center gap-30 w-full items-center">
        <div className="text-center px-30 font-size-22 font-semi-bold">
          Switching the update method will reset progress. Proceed anyway?
        </div>
        <div className="display-flex justify-center gap-15 w-300">
          <RDButtonV2
            onClick={props.onApply}
            isLoading={props.isLoading}
            fullWidth
          >
            Yes
          </RDButtonV2>
          <RDButtonV2
            color="black"
            variant="outlined"
            onClick={props.onCancel}
            fullWidth
          >
            Cancel
          </RDButtonV2>
        </div>
      </div>
    </RDPrompt>
  );
};

export default SetUpdateMethodConfirmationModal;
