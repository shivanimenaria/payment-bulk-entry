import {
  RDAccordion,
  RDAccordionDetails,
  RDAccordionSummary,
  RDAccordionSummaryContent,
  RDCommentButton,
} from "@rdash-tech/web-ui-components";
import clsx from "clsx";
import { useRef } from "react";
import { TaskReplies, TaskReplyBoxWrapper } from "../../../../components/task-manager";
import useTaskReplies from "../../../../components/task-manager/task-replies/hook/useTaskReplies";
import type { ITaskReplyRef } from "../../../../components/task-manager/task-replies/interface";
import { API_ENDPOINT } from "../../../../enumerations/api-endpoint.enum";
import { APPROVAL_HIERARCHY_RESOURCE_TYPE } from "../../../../enumerations/approval-hierarchy.enum";
import { getFilledRoute } from "../../../../utils/common-methods";
import type { IPaymentRequestRepliesProps } from "./interface";

const Reply = (props: IPaymentRequestRepliesProps) => {
  const containerElement = useRef<HTMLDivElement>(null);
  const replyContainerRef = useRef<HTMLDivElement>(null);
  const taskReplayRef = useRef<ITaskReplyRef>(null);

  const state = useTaskReplies(
    {
      containerElement: containerElement.current,
      taskId: props.requestId,
      url: getFilledRoute(API_ENDPOINT.requestReplyList, {
        requestType: APPROVAL_HIERARCHY_RESOURCE_TYPE.PAYMENT_REQUEST,
        requestTypeId: props.paymentRequestId,
        requestId: props.requestId,
      }),
    },
    taskReplayRef
  );

  if (state.isLoading) return null;

  return (
    <RDAccordion className={clsx("border rounded-6 overflow-hidden mt-20")}>
      <RDAccordionSummary className={clsx("align-center px-20")}>
        <RDAccordionSummaryContent className="py-10">
          <span className="font-gilroy-semi-bold display-flex align-center gap-5">
            Replies
            <RDCommentButton
              count={state.totalReplies}
              disableAddComment
            />
          </span>
        </RDAccordionSummaryContent>
      </RDAccordionSummary>
      <RDAccordionDetails className="border-t">
        <div
          ref={containerElement}
          className={clsx("px-20", { "py-10": state.totalReplies > 0 })}
        >
          <TaskReplies {...state} />
        </div>
        <TaskReplyBoxWrapper
          taskId={props.requestId}
          handleReplyCreated={() => {
            taskReplayRef.current?.onReplyCreated();
          }}
          replyContainerRef={replyContainerRef}
          url={getFilledRoute(API_ENDPOINT.requestReply, {
            requestType: APPROVAL_HIERARCHY_RESOURCE_TYPE.PAYMENT_REQUEST,
            requestTypeId: props.paymentRequestId,
            requestId: props.requestId,
          })}
        />
      </RDAccordionDetails>
    </RDAccordion>
  );
};

Reply.displayName = "Reply";

export default Reply;
