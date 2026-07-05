import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { renewalDiscoveryResultSchema, type RenewalDiscoveryResult } from '../domain/schemas';

const DOCUSIGN_AGREEMENT_TOOL = 'docusign_getAllAgreements';

export type RenewalDiscoveryProgress = {
  type: 'renewal-progress';
  kind: 'intake' | 'tool-call' | 'tool-result' | 'normalize';
  label: string;
  detail: string | null;
};

export const renewalDiscoveryWorkflowInputSchema = z.object({
  request: z
    .string()
    .default('Find supplier agreements renewing in the next 90 days.'),
  asOfDate: z.string().optional(),
  reviewWindowDays: z.number().default(90),
});

const intakeAgentFindRenewalsStep = createStep({
  id: 'intake-agent-find-renewals',
  description:
    'Intake Agent queries Agreement Manager through Docusign MCP/API for supplier agreements renewing in the next 90 days.',
  inputSchema: renewalDiscoveryWorkflowInputSchema,
  outputSchema: renewalDiscoveryResultSchema,
  execute: async ({ inputData, runId, mastra, writer }) => {
    if (!mastra) {
      throw new Error('Mastra instance is required to resolve the Intake Agent.');
    }

    const intakeAgent = mastra.getAgent('intakeAgent');
    const asOfDate = inputData.asOfDate ?? new Date().toISOString().slice(0, 10);

    const emitProgress = (progress: Omit<RenewalDiscoveryProgress, 'type'>) => {
      void writer
        .write({ type: 'renewal-progress', ...progress } satisfies RenewalDiscoveryProgress)
        .catch(() => {});
    };

    emitProgress({
      kind: 'intake',
      label: 'Intake Agent engaged',
      detail: `Review window ${inputData.reviewWindowDays} days from ${asOfDate}`,
    });

    const agentResult = await intakeAgent.generate(
      buildIntakeAgentRenewalPrompt({
        request: inputData.request,
        asOfDate,
        reviewWindowDays: inputData.reviewWindowDays,
      }),
      {
        maxSteps: 5,
        runId: `workflow-${runId}-intake`,
        structuredOutput: { schema: renewalDiscoveryResultSchema },
        onChunk: chunk => {
          if (chunk.type === 'tool-call') {
            emitProgress({
              kind: 'tool-call',
              label: `Calling ${chunk.payload.toolName}`,
              detail: describeToolArgs(chunk.payload.args),
            });
          } else if (chunk.type === 'tool-result') {
            emitProgress({
              kind: 'tool-result',
              label: `${chunk.payload.toolName} responded`,
              detail: null,
            });
          }
        },
      },
    );

    const result = renewalDiscoveryResultSchema.parse({
      ...agentResult.object,
      sourceLabel: 'Docusign MCP',
      asOfDate,
      reviewWindowDays: inputData.reviewWindowDays,
    });

    emitProgress({
      kind: 'normalize',
      label: `Normalized ${result.rows.length} agreement ${result.rows.length === 1 ? 'row' : 'rows'}`,
      detail: `Status ${result.status}`,
    });

    return result;
  },
});

const describeToolArgs = (args: unknown): string | null => {
  if (!args || typeof args !== 'object') {
    return null;
  }

  const reviewStatus = (args as Record<string, unknown>).review_status;

  return typeof reviewStatus === 'string' ? `Review status ${reviewStatus}` : null;
};

const buildIntakeAgentRenewalPrompt = (input: {
  request: string;
  asOfDate: string;
  reviewWindowDays: number;
}) => `Request: ${input.request}

Use Docusign MCP to find completed supplier agreements for renewal review.

Steps:
1. Call docusign_getUserInfo.
2. Use the default account_id from that response.
3. Call ${DOCUSIGN_AGREEMENT_TOOL} with:
   { "accountId": "<default account_id>", "limit": 100, "status": "COMPLETE", "review_status": "COMPLETE" }
4. Call ${DOCUSIGN_AGREEMENT_TOOL} again with:
   { "accountId": "<default account_id>", "limit": 100, "status": "COMPLETE", "review_status": "PENDING" }

Return one RenewalDiscoveryResult JSON object:
- sourceLabel must be "Docusign MCP".
- asOfDate must be "${input.asOfDate}".
- reviewWindowDays must be ${input.reviewWindowDays}.
- selectedTool must be "${DOCUSIGN_AGREEMENT_TOOL}" when agreement calls succeed.
- availableTools can be an empty array.
- rows must use source.system "docusign_mcp" and source.toolName "${DOCUSIGN_AGREEMENT_TOOL}".
- Include rows with renewalDate from ${input.asOfDate} through the next ${input.reviewWindowDays} days.
- If Docusign does not return renewalDate, keep the row so the preview can show missing renewal fields.
- Use null for renewalDate, noticeDeadline, daysUntilNoticeDeadline, and agreementValue when Docusign did not return them.
- Use "Not extracted" for supplier, agreementTitle, or businessOwner when Docusign did not return them.
- Use renewalType "not_extracted" unless Docusign returns an explicit renewal type.
- source.missingFields must list each missing table field: supplier, agreementTitle, renewalDate, noticeDeadline, agreementValue, renewalType, businessOwner.
- status should be "missing_fields" if any returned row is missing renewal table fields, "live" only if all returned rows are complete, "empty" if no matching agreements are returned, and "error" only if MCP fails.

Do not add OData filters or renewal-date filters. Do not invent fields that Docusign did not return.`;

export const renewalDiscoveryWorkflow = createWorkflow({
  id: 'renewal-discovery-workflow',
  description:
    'Docusign renewal discovery workflow. First step: Intake Agent finds supplier agreements renewing in the next 90 days through Agreement Manager MCP/API.',
  inputSchema: renewalDiscoveryWorkflowInputSchema,
  outputSchema: renewalDiscoveryResultSchema,
}).then(intakeAgentFindRenewalsStep);

renewalDiscoveryWorkflow.commit();

export const runRenewalDiscoveryWorkflow = async (
  input: z.input<typeof renewalDiscoveryWorkflowInputSchema>,
): Promise<RenewalDiscoveryResult> => {
  const { mastra } = await import('../index');
  const workflow = mastra.getWorkflow('renewalDiscoveryWorkflow');
  const run = await workflow.createRun();
  const workflowResult = await run.start({
    inputData: renewalDiscoveryWorkflowInputSchema.parse(input),
  });

  if (workflowResult.status !== 'success') {
    return {
      status: 'error',
      sourceLabel: 'Docusign MCP',
      asOfDate: input.asOfDate ?? new Date().toISOString().slice(0, 10),
      reviewWindowDays: input.reviewWindowDays ?? 90,
      message: 'Renewal discovery workflow failed before the Intake Agent could return agreements.',
      rows: [],
      availableTools: [],
      selectedTool: null,
      errors: ['error' in workflowResult ? [workflowResult.error.message].filter(Boolean).join(': ') : workflowResult.status],
    };
  }

  return workflowResult.result;
};
