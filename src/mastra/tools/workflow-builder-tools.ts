import type {
  FollowUpPlan,
  HumanDecision,
  RenewalAgreementTableRow,
  RenewalRiskFinding,
  WorkflowBuilderHandoff,
} from '../domain/schemas';
import { docusignMcpClient } from '../mcp/docusign-mcp-client';
import { executeMcpTool, parseMcpTextPayload, readMcpError, readStringPath } from '../mcp/mcp-tool-utils';

const DEFAULT_WORKFLOW_NAME = 'Renewal Risk Follow-Up';
const GET_TRIGGER_REQUIREMENTS_TOOL = 'docusign_getWorkflowTriggerRequirements';
const TRIGGER_WORKFLOW_TOOL = 'docusign_triggerWorkflow';

// The post-approval Workflow Builder handoff is a two-phase MCP call:
// docusign_getWorkflowTriggerRequirements first (confirms the workflow exists
// and reports the trigger inputs it expects), then docusign_triggerWorkflow
// with the actual payload. This runs outside any agent — the human decision,
// not an LLM, is what fires Docusign actions — so the MCP tools are executed
// directly from the tool map instead of through Agent.generate().
export const createWorkflowBuilderHandoff = async ({
  row,
  finding,
  decision,
  followUpPlan,
}: {
  row: RenewalAgreementTableRow;
  finding: RenewalRiskFinding;
  decision: HumanDecision;
  followUpPlan: FollowUpPlan;
}): Promise<WorkflowBuilderHandoff> => {
  const workflowId = process.env.DOCUSIGN_WORKFLOW_ID ?? null;
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID ?? null;
  const workflowName = process.env.DOCUSIGN_WORKFLOW_NAME ?? DEFAULT_WORKFLOW_NAME;

  if (followUpPlan.status === 'skipped') {
    return {
      workflowId,
      accountId,
      workflowName,
      status: 'skipped',
      details: 'No Workflow Builder instance is needed for this human decision.',
      triggerPayload: null,
      requirements: null,
      instanceId: null,
      instanceUrl: null,
      errors: [],
    };
  }

  if (!workflowId || !accountId) {
    return {
      workflowId,
      accountId,
      workflowName,
      status: 'not_configured',
      details:
        'Set DOCUSIGN_WORKFLOW_ID and DOCUSIGN_ACCOUNT_ID to prepare a Workflow Builder trigger.',
      triggerPayload: null,
      requirements: null,
      instanceId: null,
      instanceUrl: null,
      errors: [],
    };
  }

  const triggerPayload = buildWorkflowTriggerPayload({
    row,
    finding,
    decision,
    followUpPlan,
  });

  try {
    const { tools } = await docusignMcpClient.listToolsWithErrors();
    const getRequirementsTool = tools[GET_TRIGGER_REQUIREMENTS_TOOL];

    if (!getRequirementsTool) {
      throw new Error(`Docusign MCP tool ${GET_TRIGGER_REQUIREMENTS_TOOL} was not available.`);
    }

    const requirementsResponse = await executeMcpTool(getRequirementsTool, {
      accountId,
      workflowId,
    });
    const requirements = parseMcpTextPayload(requirementsResponse) ?? requirementsResponse;

    const triggerWorkflowTool = tools[TRIGGER_WORKFLOW_TOOL];

    if (!triggerWorkflowTool) {
      throw new Error(`Docusign MCP tool ${TRIGGER_WORKFLOW_TOOL} was not available.`);
    }

    const triggerResponse = await executeMcpTool(triggerWorkflowTool, {
      accountId,
      workflowId,
      instance_name: triggerPayload.instance_name,
      trigger_inputs: triggerPayload.trigger_inputs,
    });
    const parsedTriggerResponse =
      parseMcpTextPayload(triggerResponse) ?? triggerResponse;
    const triggerError = readMcpError(parsedTriggerResponse) ?? readMcpError(triggerResponse);
    const instanceId = readStringPath(parsedTriggerResponse, [
      'instance_id',
      'instanceId',
      'instance.id',
      'result.instance_id',
      'result.instanceId',
      'result.id',
    ]);
    const instanceUrl = readStringPath(parsedTriggerResponse, [
      'instance_url',
      'instanceUrl',
      'workflow_instance_url',
      'workflowInstanceUrl',
      'instance.url',
      'result.instance_url',
      'result.instanceUrl',
      'result.workflow_instance_url',
      'result.workflowInstanceUrl',
    ]);

    if (triggerError) {
      throw new Error(triggerError);
    }

    if (!instanceId && !instanceUrl) {
      throw new Error('Docusign MCP triggerWorkflow did not return a workflow instance ID or URL.');
    }

    return {
      workflowId,
      accountId,
      workflowName,
      status: 'triggered',
      details: 'Docusign Workflow Builder follow-up was started through MCP.',
      triggerPayload,
      requirements,
      instanceId,
      instanceUrl,
      errors: [],
    };
  } catch (error) {
    return {
      workflowId,
      accountId,
      workflowName,
      status: 'failed',
      details: 'Workflow Builder handoff failed before the workflow could start.',
      triggerPayload,
      requirements: null,
      instanceId: null,
      instanceUrl: null,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  } finally {
    await docusignMcpClient.disconnect();
  }
};

const buildWorkflowTriggerPayload = ({
  row,
  finding,
  decision,
  followUpPlan,
}: {
  row: RenewalAgreementTableRow;
  finding: RenewalRiskFinding;
  decision: HumanDecision;
  followUpPlan: FollowUpPlan;
}) => {
  const reviewerEmail =
    process.env.DOCUSIGN_WORKFLOW_REVIEWER_EMAIL ?? decision.reviewer;
  const preparerEmail =
    process.env.DOCUSIGN_WORKFLOW_PREPARER_EMAIL ?? reviewerEmail;

  return {
    instance_name: `Renewal follow-up: ${row.supplier}`,
    trigger_inputs: {
      startDate: decision.decidedAt.slice(0, 10),
      workflowBuilder: reviewerEmail,
      workflowPreparer: preparerEmail,
      agreementId: row.agreementId,
      supplier: row.supplier,
      classification: finding.classification,
      approvedAction: followUpPlan.action,
      noticeDeadline: row.noticeDeadline,
      reviewerNotes: decision.notes,
    },
  };
};
