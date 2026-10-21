import { RDButton, RDPrompt, RDToolTip } from "@rdash-tech/web-ui-components";
import { setProjectCreateSuccessOpenClose } from "../../../actions/project-share.action";
import { PERMISSION, PERMISSION_TYPE } from "../../../enumerations/permission-context.enum";
import { useAppDispatch, useAppSelector } from "../../../hooks/store";
import useModal from "../../../hooks/useModal";
import usePermissions from "../../../hooks/usePermissions";
import { projectSelector } from "../../../reducers/project.reducer";
import { ShareIcon } from "../../../statics/images";
import projectCreateSuccessIcon from "../../../statics/images/project-create-success-tick-icon.svg";
import ProjectSharePrompt from "../project-share-modal";
import "./style.css";

const ProjectCreateSuccessPrompt = () => {
  const dispatch = useAppDispatch();
  const { isActionPermitted } = usePermissions();

  const shareModal = useModal();

  const store = {
    isShowProjectCreateSuccessModal: useAppSelector((state) => state.projectShare.isShowProjectCreateSuccessModal),
    projectName: useAppSelector(projectSelector.projectName),
    jobId: useAppSelector(projectSelector.jobId),
  };

  const handleOkBtnClick = () => {
    dispatch(setProjectCreateSuccessOpenClose(false));
  };

  if (!store.isShowProjectCreateSuccessModal) return null;

  return (
    <>
      <RDPrompt
        open
        className="project-create-success-prompt-wrapper"
        outSideClickHandler={handleOkBtnClick}
      >
        <>
          <div className="project-create-success-prompt">
            <div className="project-create-success-prompt-upper-section display-flex align-center flex-column">
              <img
                className="project-create-success-icon"
                src={projectCreateSuccessIcon}
                alt="project create success"
              />
              <div className="project-create-success-prompt-title font-gilroy-bold">Project created successfully</div>
              <div className="project-create-success-prompt-project-name-jobid display-flex justify-space-between">
                <div>
                  <RDToolTip title={store.projectName}>
                    <div className="text-align-left font-gilroy-500 project-create-success-prompt-project-name text-truncate">
                      {store.projectName}
                    </div>
                  </RDToolTip>
                  <div className="project-create-success-prompt-project-jobid">Job ID : {store.jobId}</div>
                </div>
                <RDButton
                  title="OK"
                  size="small"
                  onClick={handleOkBtnClick}
                />
              </div>
            </div>
          </div>
          <div className="project-create-success-prompt-bottom-section display-flex justify-space-between align-center">
            <span className="share-project-text">Do you want to share this project ?</span>
            <RDButton
              variant="outlined-red"
              className="project-share-button"
              title="Share"
              icon={<ShareIcon color="red" />}
              size="small"
              permitted={isActionPermitted(PERMISSION_TYPE.ORG, PERMISSION.CAN_SHARE_PROJECT)}
              onClick={shareModal.open}
            />
          </div>
        </>
      </RDPrompt>
      {shareModal.isOpen && (
        <ProjectSharePrompt
          onClose={shareModal.close}
          source="creationFlow"
        />
      )}
    </>
  );
};

export default ProjectCreateSuccessPrompt;
