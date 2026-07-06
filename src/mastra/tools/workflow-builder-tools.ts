import type {
  FollowUpPlan,
  HumanDecision,
  RenewalAgreementTableRow,
  RenewalRiskFinding,
  WorkflowBuilderHandoff,
} from '../domain/schemas';
import { docusignMcpClient } from '../mcp/docusign-mcp-client';

const DEFAULT_WORKFLOW_NAME = 'Renewal Risk Follow-Up';
const GET_TRIGGER_REQUIREMENTS_TOOL = 'docusign_getWorkflowTriggerRequirements';
const TRIGGER_WORKFLOW_TOOL = 'docusign_triggerWorkflow';

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

    if (process.env.DOCUSIGN_WORKFLOW_TRIGGER_ENABLED !== 'true') {
      return {
        workflowId,
        accountId,
        workflowName,
        status: 'ready_to_start',
        details:
          'Workflow Builder trigger payload prepared. Set DOCUSIGN_WORKFLOW_TRIGGER_ENABLED=true to start the workflow from the app.',
        triggerPayload,
        requirements,
        instanceId: null,
        instanceUrl: null,
        errors: [],
      };
    }

    const triggerWorkflowTool = tools[TRIGGER_WORKFLOW_TOOL];

    if (!triggerWorkflowTool) {
      throw new Error(`Docusign MCP tool ${TRIGGER_WORKFLOW_TOOL} was not available.`);
    }

    const triggerResponse = await executeMcpTool(triggerWorkflowTool, {
      accountId,
      workflowId,
      instanceName: triggerPayload.instance_name,
      instance_name: triggerPayload.instance_name,
      triggerInputs: triggerPayload.trigger_inputs,
      trigger_inputs: triggerPayload.trigger_inputs,
    });
    const parsedTriggerResponse =
      parseMcpTextPayload(triggerResponse) ?? triggerResponse;

    return {
      workflowId,
      accountId,
      workflowName,
      status: 'triggered',
      details: 'Docusign Workflow Builder follow-up was started through MCP.',
      triggerPayload,
      requirements,
      instanceId: readStringPath(parsedTriggerResponse, [
        'instance_id',
        'instanceId',
        'instance.id',
      ]),
      instanceUrl: readStringPath(parsedTriggerResponse, [
        'instance_url',
        'instanceUrl',
        'instance.url',
      ]),
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
    process.env.DOCUSIGN_WORKFLOW_REVIEWER_EMAIL ??
    process.env.DOCUSIGN_WORKFLOW_BUILDER_EMAIL ??
    decision.reviewer;
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

const parseMcpTextPayload = (value: unknown): unknown | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const content = (value as { content?: unknown }).content;

  if (!Array.isArray(content)) {
    return null;
  }

  const textBlock = content.find(
    block =>
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string',
  ) as { text: string } | undefined;

  if (!textBlock) {
    return null;
  }

  try {
    return JSON.parse(textBlock.text);
  } catch {
    return null;
  }
};

const executeMcpTool = async (
  tool: unknown,
  input: unknown,
) => {
  const executable = tool as {
    execute?: (input: unknown, context: unknown) => Promise<unknown>;
  };

  if (!executable.execute) {
    throw new Error('Docusign MCP tool does not expose an execute function.');
  }

  return executable.execute(input, undefined);
};

const readStringPath = (value: unknown, paths: string[]) => {
  for (const path of paths) {
    const resolved = path.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') {
        return undefined;
      }

      return (current as Record<string, unknown>)[segment];
    }, value);

    if (typeof resolved === 'string') {
      return resolved;
    }
  }

  return null;
};
