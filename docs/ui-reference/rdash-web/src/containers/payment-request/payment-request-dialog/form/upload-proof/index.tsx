import { RDButtonV2, RDInputLabel } from "@rdash-tech/web-ui-components";
import { PAYMENT_REQUEST_UPLOAD_PROOF_ALLOWED_FILE_TYPES } from "../../../../../constants/payment-request.constants";
import { FILE_UPLOAD_PATH } from "../../../../../enumerations/file-upload-path.enum";
import { OBJECT_STATUS_ENUM } from "../../../../../enumerations/status.enum";
import { useFieldFileUploader } from "../../../../../hooks/useFileUpload";
import OtherExpenseProofAttachment from "../../../../other-expense/expense-edit/proof";
import type { IUploadProofProps } from "./interface";
import Proof from "./proof";

const UploadProof = (props: IUploadProofProps) => {
  const { getFileFromDevice, fileIds } = useFieldFileUploader({
    moduleName: "payment-request",
    fieldName: "upload-proof",
    uploadFilePath: FILE_UPLOAD_PATH.NON_ORDER_PAYMENT_PROOF,
    allowedFileTypes: PAYMENT_REQUEST_UPLOAD_PROOF_ALLOWED_FILE_TYPES,
    multiple: true,
    projectId: props.projectId,
  });

  const deleteFile = (fileId: string) => {
    const newFormData = {
      ...props.form,
      proofs: props.form.proofs.map((proof) => {
        if (proof.id === fileId) {
          return { ...proof, objectStatus: OBJECT_STATUS_ENUM.DELETE };
        }
        return proof;
      }),
    };
    props.setFormData(newFormData);
  };

  return (
    <>
      <div className="display-flex items-center justify-between">
        <RDInputLabel label={"Upload Proof"} />
        <RDButtonV2
          variant="text"
          onClick={getFileFromDevice}
        >
          + Upload file
        </RDButtonV2>
      </div>
      <div className="display-flex flex-col gap-10">
        {props.form.proofs.map((proof) => {
          if (proof.objectStatus === OBJECT_STATUS_ENUM.DELETE) return null;
          return (
            <OtherExpenseProofAttachment
              key={proof.id}
              proof={{
                id: proof.id,
                name: proof.name,
                file: proof.file,
                uploadedAt: proof.uploadedAt,
              }}
              handleRemove={() => deleteFile(proof.id || "")}
              isUploading={false}
              progress={0}
              blob={false}
              error={false}
            />
          );
        })}
        {fileIds.map((fileId, index) => (
          <Proof
            fileId={fileId}
            key={index}
          />
        ))}
      </div>
    </>
  );
};

export default UploadProof;
