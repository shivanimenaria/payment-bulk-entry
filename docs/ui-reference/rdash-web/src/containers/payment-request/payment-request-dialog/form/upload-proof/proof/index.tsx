import { useFileUploader } from "../../../../../../hooks/useFileUpload";
import OtherExpenseProofAttachment from "../../../../../other-expense/expense-edit/proof";
import type { IProofProps } from "./interface";

const Proof = (props: IProofProps) => {
  const { state, removeFile, retryFileUpload } = useFileUploader({
    fileId: props.fileId,
    moduleName: "payment-request",
    fieldName: "upload-proof",
  });

  return (
    <OtherExpenseProofAttachment
      proof={{
        id: null,
        name: state.name,
        file: state.fileUrl,
      }}
      isUploading={state.isUploading}
      progress={state.progress}
      error={state.error}
      blob={true}
      handleRemove={removeFile}
      handleRetry={retryFileUpload}
    />
  );
};

export default Proof;
