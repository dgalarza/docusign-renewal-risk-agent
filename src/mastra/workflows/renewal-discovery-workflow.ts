import { createStep, createWorkflow } from '@mastra/core/workflows';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  renewalAgreementTableRowSchema,
  renewalDiscoveryResultSchema,
  renewalRiskAgentJudgmentSchema,
  renewalReviewWorkflowResultSchema,
  supplierRenewalAgreementSchema,
  type RenewalAgreementTableRow,
  type RenewalDiscoveryResult,
  type RenewalRiskBrief,
  type RenewalRiskAgentJudgment,
  type RenewalRiskFinding,
  type RenewalReviewWorkflowResult,
  type SupplierRenewalAgreement,
} from '../domain/schemas';
import {
  createRenewalRiskBrief,
  mapRenewalRowsToAgreements,
} from '../tools/portfolio-tools';

const DOCUSIGN_AGREEMENT_TOOL = 'docusign_getAllAgreements';
const FIXTURE_PATH = new URL('../../../examples/agreement-demo-fixture.json', import.meta.url);
const RISK_REVIEW_AGENT_TIMEOUT_MS = 5_000;
const RISK_REVIEW_AGENT_FINDING_LIMIT = 3;

export type RenewalDiscoveryProgress = {
  type: 'renewal-progress';
  kind:
    | 'intake'
    | 'tool-call'
    | 'tool-result'
    | 'normalize'
    | 'risk-review'
    | 'policy-tool-call'
    | 'policy-tool-result';
  label: string;
  detail: string | null;
};

export const renewalDiscoveryWorkflowInputSchema = z.object({
  request: z
    .string()
    .default('Find supplier agreements renewing in the next 90 days.'),
  source: z.enum(['docusign_mcp', 'fixture']).default('docusign_mcp'),
  asOfDate: z.string().optional(),
  reviewWindowDays: z.number().default(90),
});

const intakeAgentFindRenewalsStep = createStep({
  id: 'intake-agent-find-renewals',
  description:
    'Intake Agent queries Agreement Manager through Docusign MCP/API for supplier agreements renewing in the configured review window.',
  inputSchema: renewalDiscoveryWorkflowInputSchema,
  outputSchema: renewalDiscoveryResultSchema,
  execute: async ({ inputData, runId, mastra, writer }) => {
    const asOfDate = inputData.asOfDate ?? new Date().toISOString().slice(0, 10);

    const emitProgress = (progress: Omit<RenewalDiscoveryProgress, 'type'>) => {
      void writer
        .write({ type: 'renewal-progress', ...progress } satisfies RenewalDiscoveryProgress)
        .catch(() => {});
    };

    if (inputData.source === 'fixture') {
      emitProgress({
        kind: 'intake',
        label: 'Fixture portfolio loaded',
        detail: `Review window ${inputData.reviewWindowDays} days from ${asOfDate}`,
      });

      const result = await buildFixtureDiscoveryResult({
        asOfDate,
        reviewWindowDays: inputData.reviewWindowDays,
      });

      emitProgress({
        kind: 'normalize',
        label: `Normalized ${result.rows.length} fixture ${result.rows.length === 1 ? 'row' : 'rows'}`,
        detail: `Status ${result.status}`,
      });

      return result;
    }

    if (!mastra) {
      throw new Error('Mastra instance is required to resolve the Intake Agent.');
    }

    const intakeAgent = mastra.getAgent('intakeAgent');

    emitProgress({
      kind: 'intake',
      label: 'Intake Agent engaged',
      detail: `Review window ${inputData.reviewWindowDays} days from ${asOfDate}`,
    });

    const agentResult = await intakeAgent.generate(
      buildIntakeAgentRenewalPrompt({
        request: inputData.request,
        asOfDate,
        accountId: process.env.DOCUSIGN_ACCOUNT_ID,
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

const riskReviewStep = createStep({
  id: 'risk-review',
  description:
    'Risk Review Agent maps discovered rows into policy-ready agreements and creates a deterministic renewal risk brief.',
  inputSchema: renewalDiscoveryResultSchema,
  outputSchema: renewalReviewWorkflowResultSchema,
  execute: async ({ inputData, runId, mastra, writer }) => {
    const emitProgress = (progress: Omit<RenewalDiscoveryProgress, 'type'>) => {
      void writer
        .write({ type: 'renewal-progress', ...progress } satisfies RenewalDiscoveryProgress)
        .catch(() => {});
    };

    emitProgress({
      kind: 'risk-review',
      label: 'Risk Review Agent engaged',
      detail: `${inputData.rows.length} discovered ${inputData.rows.length === 1 ? 'agreement' : 'agreements'} queued for policy review`,
    });

    const agreements = mapRenewalRowsToAgreements(inputData.rows);
    let riskBrief: RenewalReviewWorkflowResult['riskBrief'] = null;
    let riskReview: RenewalRiskAgentJudgment | null = null;

    if (agreements.length > 0) {
      emitProgress({
        kind: 'risk-review',
        label: 'Risk Review Agent reviewing policy-ready agreements',
        detail: `${agreements.length} ${agreements.length === 1 ? 'agreement' : 'agreements'} mapped from discovery rows`,
      });

      emitProgress({
        kind: 'policy-tool-call',
        label: 'Creating deterministic policy brief',
        detail: 'Deterministic renewal policy classifying agreements',
      });

      riskBrief = createRenewalRiskBrief(agreements, {
        asOfDate: inputData.asOfDate,
        reviewWindowDays: inputData.reviewWindowDays,
      });

      emitProgress({
        kind: 'policy-tool-result',
        label: 'Deterministic policy brief created',
        detail: null,
      });

      riskReview = createRiskReviewJudgment(riskBrief);

      if (mastra) {
        const riskReviewAgent = mastra.getAgent('riskReviewAgent');

        emitProgress({
          kind: 'risk-review',
          label: 'Risk Review Agent applying judgment',
          detail: 'Prioritizing the policy brief for human review',
        });

        riskReview =
          (await generateRiskReviewAgentJudgment({
          riskReviewAgent,
          riskBrief,
          fallbackJudgment: riskReview,
          runId: `workflow-${runId}-risk-review`,
        }).catch(error => {
            emitProgress({
              kind: 'risk-review',
              label: 'Risk Review Agent judgment fallback',
              detail: error instanceof Error ? error.message : String(error),
            });

            return null;
          })) ?? riskReview;
      }
    }

    const result = renewalReviewWorkflowResultSchema.parse({
      ...inputData,
      message: riskBrief
        ? `${inputData.message} Risk review classified ${riskBrief.agreementsReviewed} agreement ${riskBrief.agreementsReviewed === 1 ? 'finding' : 'findings'}.`
        : `${inputData.message} Risk review found no agreements to classify.`,
      riskBrief,
      riskReview,
    });

    emitProgress({
      kind: 'risk-review',
      label: riskBrief
        ? `Classified ${riskBrief.agreementsReviewed} agreement ${riskBrief.agreementsReviewed === 1 ? 'finding' : 'findings'}`
        : 'Risk review complete',
      detail: riskBrief ? summarizeRiskBrief(riskBrief.findings) : 'No agreements in review window',
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

const generateRiskReviewAgentJudgment = async ({
  riskReviewAgent,
  riskBrief,
  fallbackJudgment,
  runId,
}: {
  riskReviewAgent: {
    generate: (
      prompt: string,
      options: {
        maxSteps: number;
        runId: string;
        toolChoice: 'none';
        structuredOutput: { schema: typeof renewalRiskAgentJudgmentSchema };
        abortSignal: AbortSignal;
        modelSettings: {
          temperature: number;
          maxOutputTokens: number;
          reasoning: 'low';
        };
      },
    ) => Promise<{ object?: unknown }>;
  };
  riskBrief: RenewalRiskBrief;
  fallbackJudgment: RenewalRiskAgentJudgment;
  runId: string;
}): Promise<RenewalRiskAgentJudgment> => {
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort('Risk Review Agent judgment timed out.'),
    RISK_REVIEW_AGENT_TIMEOUT_MS,
  );

  try {
    const agentResult = await riskReviewAgent.generate(
      buildRiskReviewAgentJudgmentPrompt({ riskBrief, fallbackJudgment }),
      {
        maxSteps: 1,
        runId,
        toolChoice: 'none',
        structuredOutput: { schema: renewalRiskAgentJudgmentSchema },
        abortSignal: abortController.signal,
        modelSettings: {
          temperature: 0,
          maxOutputTokens: 450,
          reasoning: 'low',
        },
      },
    );

    return renewalRiskAgentJudgmentSchema.parse(agentResult.object);
  } finally {
    clearTimeout(timeout);
  }
};

const buildRiskReviewAgentJudgmentPrompt = ({
  riskBrief,
  fallbackJudgment,
}: {
  riskBrief: RenewalRiskBrief;
  fallbackJudgment: RenewalRiskAgentJudgment;
}) =>
  `You are the Risk Review Agent. The deterministic policy tool already produced this canonical renewal risk brief.

Do not change classifications, recommended actions, deadline math, or extracted signals.
Apply judgment only to the top ${RISK_REVIEW_AGENT_FINDING_LIMIT} policy findings below:
- portfolioJudgment: one concise sentence naming what needs attention.
- priorityAgreementIds: include only the top agreement IDs, ordered by review priority.
- reviewerGuidance: include only the top findings that need human attention.

Return only the requested RenewalRiskAgentJudgment structure.

Portfolio summary:
${JSON.stringify(
  {
    agreementsReviewed: riskBrief.agreementsReviewed,
    reviewWindowDays: riskBrief.reviewWindowDays,
    fallbackPortfolioJudgment: fallbackJudgment.portfolioJudgment,
    topFindings: fallbackJudgment.priorityAgreementIds
      .slice(0, RISK_REVIEW_AGENT_FINDING_LIMIT)
      .map(agreementId =>
        riskBrief.findings.find(finding => finding.agreementId === agreementId),
      )
      .filter(Boolean),
  },
  null,
  2,
)}`;

const createRiskReviewJudgment = (
  riskBrief: RenewalRiskBrief,
): RenewalRiskAgentJudgment => {
  const rankedFindings = [...riskBrief.findings].sort((left, right) =>
    compareFindingsByReviewPriority(left, right, riskBrief.reviewWindowDays),
  );
  const urgentOrBlocked = rankedFindings.filter(
    finding => finding.classification === 'urgent' || finding.classification === 'blocked',
  ).length;
  const legalReviews = rankedFindings.filter(
    finding => finding.recommendedAction === 'legal_review',
  ).length;

  return {
    portfolioJudgment:
      riskBrief.agreementsReviewed === 0
        ? 'No agreements need renewal-risk review in this window.'
        : `${riskBrief.agreementsReviewed} agreement ${riskBrief.agreementsReviewed === 1 ? 'needs' : 'need'} review; ${urgentOrBlocked} ${urgentOrBlocked === 1 ? 'is' : 'are'} urgent or blocked, and ${legalReviews} ${legalReviews === 1 ? 'needs' : 'need'} legal attention.`,
    priorityAgreementIds: rankedFindings.map(finding => finding.agreementId),
    reviewerGuidance: rankedFindings.map(finding => ({
      agreementId: finding.agreementId,
      judgment: buildFindingJudgment(finding),
      reasonForPriority: finding.rationale,
      suggestedReviewer: getSuggestedReviewer(finding),
    })),
  };
};

const compareFindingsByReviewPriority = (
  left: RenewalRiskFinding,
  right: RenewalRiskFinding,
  reviewWindowDays: number,
) =>
  getFindingPriority(right, reviewWindowDays) -
  getFindingPriority(left, reviewWindowDays);

const getFindingPriority = (
  finding: RenewalRiskFinding,
  reviewWindowDays: number,
) => {
  const severityScore = {
    standard: 0,
    needs_review: 10,
    urgent: 20,
    blocked: 30,
  }[finding.classification];
  const legalScore = finding.recommendedAction === 'legal_review' ? 2 : 0;
  const deadlineScore =
    finding.daysUntilNoticeDeadline !== null
      ? Math.max(0, reviewWindowDays - finding.daysUntilNoticeDeadline) /
        reviewWindowDays
      : 0;

  return severityScore + legalScore + deadlineScore;
};

const buildFindingJudgment = (finding: RenewalRiskFinding) => {
  if (finding.classification === 'blocked') {
    return `${finding.supplierName} should be escalated first because the notice window has already closed.`;
  }

  if (finding.classification === 'urgent') {
    return `${finding.supplierName} needs owner confirmation before the notice window closes.`;
  }

  if (finding.recommendedAction === 'legal_review') {
    return `${finding.supplierName} should go to legal because the extracted renewal terms are not safe to accept as-is.`;
  }

  if (finding.classification === 'needs_review') {
    return `${finding.supplierName} needs procurement review before renewal intent is accepted.`;
  }

  return `${finding.supplierName} can stay on the watchlist because no high-risk renewal signal was found.`;
};

const getSuggestedReviewer = (
  finding: RenewalRiskFinding,
): RenewalRiskAgentJudgment['reviewerGuidance'][number]['suggestedReviewer'] => {
  if (finding.classification === 'blocked') {
    return 'executive_escalation';
  }

  if (finding.recommendedAction === 'legal_review') {
    return 'legal';
  }

  if (finding.recommendedAction === 'no_action') {
    return 'none';
  }

  return 'procurement_owner';
};

const buildIntakeAgentRenewalPrompt = (input: {
  request: string;
  asOfDate: string;
  accountId?: string;
  reviewWindowDays: number;
}) => {
  const discoverySteps = input.accountId
    ? `1. Use accountId "${input.accountId}". Do not call docusign_getUserInfo.
2. Call ${DOCUSIGN_AGREEMENT_TOOL} with:
   { "accountId": "${input.accountId}", "limit": 100, "status": "COMPLETE", "review_status": "PENDING" }`
    : `1. Call docusign_getUserInfo.
2. Use the default account_id from that response.
3. Call ${DOCUSIGN_AGREEMENT_TOOL} with:
   { "accountId": "<default account_id>", "limit": 100, "status": "COMPLETE", "review_status": "PENDING" }`;

  return `Request: ${input.request}

Use Docusign MCP to find completed supplier agreements for renewal review.

Steps:
${discoverySteps}

Return one RenewalDiscoveryResult JSON object:
- sourceLabel must be "Docusign MCP".
- asOfDate must be "${input.asOfDate}".
- reviewWindowDays must be ${input.reviewWindowDays}.
- selectedTool must be "${DOCUSIGN_AGREEMENT_TOOL}" when agreement calls succeed.
- availableTools can be an empty array.
- rows must use source.system "docusign_mcp" and source.toolName "${DOCUSIGN_AGREEMENT_TOOL}".
- Include rows with renewalDate from ${input.asOfDate} through the next ${input.reviewWindowDays} days.
- Include noticePeriodDays when Docusign returns it.
- If Docusign returns renewalDate and noticePeriodDays but not noticeDeadline, calculate noticeDeadline as renewalDate minus noticePeriodDays.
- If noticeDeadline is available, calculate daysUntilNoticeDeadline from noticeDeadline and ${input.asOfDate}.
- If Docusign does not return renewalDate, keep the row so the preview can show missing renewal fields.
- Use null for renewalDate, noticePeriodDays, noticeDeadline, daysUntilNoticeDeadline, and agreementValue when Docusign did not return them.
- Use "Not extracted" for supplier or agreementTitle when Docusign did not return them.
- Use renewalType "not_extracted" unless Docusign returns an explicit renewal type.
- source.missingFields must list each missing required table field: supplier, agreementTitle, renewalDate, noticePeriodDays, noticeDeadline, agreementValue, currency, renewalType.
- status should be "missing_fields" if any returned row is missing renewal table fields, "live" only if all returned rows are complete, "empty" if no matching agreements are returned, and "error" only if MCP fails.

Do not add OData filters or renewal-date filters. Do not invent fields that Docusign did not return.`;
};

export const renewalDiscoveryWorkflow = createWorkflow({
  id: 'renewal-discovery-workflow',
  description:
    'Docusign renewal discovery workflow. Intake Agent finds supplier agreements, then Risk Review Agent attaches deterministic policy classifications.',
  inputSchema: renewalDiscoveryWorkflowInputSchema,
  outputSchema: renewalReviewWorkflowResultSchema,
}).then(intakeAgentFindRenewalsStep).then(riskReviewStep);

renewalDiscoveryWorkflow.commit();

export const runRenewalDiscoveryWorkflow = async (
  input: z.input<typeof renewalDiscoveryWorkflowInputSchema>,
): Promise<RenewalReviewWorkflowResult> => {
  const { mastra } = await import('../index');
  const workflow = mastra.getWorkflow('renewalDiscoveryWorkflow');
  const run = await workflow.createRun();
  const parsedInput = renewalDiscoveryWorkflowInputSchema.parse(input);
  const workflowResult = await run.start({ inputData: parsedInput });

  if (workflowResult.status !== 'success') {
    return {
      status: 'error',
      sourceLabel: parsedInput.source === 'fixture' ? 'Demo fixture' : 'Docusign MCP',
      asOfDate: parsedInput.asOfDate ?? new Date().toISOString().slice(0, 10),
      reviewWindowDays: parsedInput.reviewWindowDays,
      message: 'Renewal discovery workflow failed before the Intake Agent could return agreements.',
      rows: [],
      availableTools: [],
      selectedTool: null,
      errors: ['error' in workflowResult ? [workflowResult.error.message].filter(Boolean).join(': ') : workflowResult.status],
      riskBrief: null,
      riskReview: null,
    };
  }

  return workflowResult.result;
};

export const runRenewalFixtureReview = async (
  input: Pick<z.input<typeof renewalDiscoveryWorkflowInputSchema>, 'asOfDate' | 'reviewWindowDays'>,
): Promise<RenewalReviewWorkflowResult> => {
  const parsedInput = renewalDiscoveryWorkflowInputSchema.parse({
    source: 'fixture',
    asOfDate: input.asOfDate,
    reviewWindowDays: input.reviewWindowDays,
  });
  const asOfDate = parsedInput.asOfDate ?? new Date().toISOString().slice(0, 10);
  const discoveryResult = await buildFixtureDiscoveryResult({
    asOfDate,
    reviewWindowDays: parsedInput.reviewWindowDays,
  });
  const agreements = mapRenewalRowsToAgreements(discoveryResult.rows);
  const riskBrief =
    agreements.length > 0
      ? createRenewalRiskBrief(agreements, {
          asOfDate,
          reviewWindowDays: parsedInput.reviewWindowDays,
        })
      : null;

  return renewalReviewWorkflowResultSchema.parse({
    ...discoveryResult,
    message: riskBrief
      ? `${discoveryResult.message} Risk review classified ${riskBrief.agreementsReviewed} agreement ${riskBrief.agreementsReviewed === 1 ? 'finding' : 'findings'}.`
      : `${discoveryResult.message} Risk review found no agreements to classify.`,
    riskBrief,
    riskReview: null,
  });
};

const buildFixtureDiscoveryResult = async ({
  asOfDate,
  reviewWindowDays,
}: {
  asOfDate: string;
  reviewWindowDays: number;
}): Promise<RenewalDiscoveryResult> => {
  const fixture = fixtureSchema.parse(
    JSON.parse(await readFile(FIXTURE_PATH, 'utf8')),
  );
  const rows = fixture.examples
    .map(example => mapFixtureAgreementToRow(example.agreement, asOfDate))
    .filter(row => isRowInReviewWindow(row, asOfDate, reviewWindowDays));

  return renewalDiscoveryResultSchema.parse({
    status: rows.length > 0 ? 'live' : 'empty',
    sourceLabel: 'Demo fixture',
    asOfDate,
    reviewWindowDays,
    message:
      rows.length > 0
        ? `Loaded ${rows.length} fixture-backed supplier renewal ${rows.length === 1 ? 'agreement' : 'agreements'}.`
        : 'No fixture agreements renew inside this window.',
    rows,
    availableTools: [],
    selectedTool: null,
    errors: [],
  });
};

const mapFixtureAgreementToRow = (
  agreement: SupplierRenewalAgreement,
  asOfDate: string,
): RenewalAgreementTableRow =>
  renewalAgreementTableRowSchema.parse({
    agreementId: agreement.agreementId,
    supplier: agreement.supplierName,
    agreementTitle: agreement.agreementTitle,
    renewalDate: agreement.renewalDate,
    noticePeriodDays: agreement.noticePeriodDays,
    noticeDeadline: agreement.noticeDeadline,
    daysUntilNoticeDeadline: agreement.noticeDeadline
      ? dateDiffDays(asOfDate, agreement.noticeDeadline)
      : null,
    agreementValue: agreement.agreementValue,
    currency: agreement.currency,
    renewalType: agreement.renewalType,
    source: {
      system: 'fixture',
      recordId: agreement.agreementId,
      missingFields: [],
    },
  });

const summarizeRiskBrief = (
  findings: RenewalReviewWorkflowResult['riskBrief'] extends null
    ? never
    : NonNullable<RenewalReviewWorkflowResult['riskBrief']>['findings'],
) => {
  const counts = findings.reduce<Record<string, number>>((summary, finding) => {
    summary[finding.classification] = (summary[finding.classification] ?? 0) + 1;
    return summary;
  }, {});

  return Object.entries(counts)
    .map(([classification, count]) => `${classification}: ${count}`)
    .join(', ');
};

const isRowInReviewWindow = (
  row: RenewalAgreementTableRow,
  asOfDate: string,
  reviewWindowDays: number,
) => {
  if (!row.renewalDate) {
    return true;
  }

  const daysUntilRenewal = dateDiffDays(asOfDate, row.renewalDate);
  return daysUntilRenewal >= 0 && daysUntilRenewal <= reviewWindowDays;
};

const dateDiffDays = (fromDate: string, toDate: string) => {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
};

const fixtureSchema = z.object({
  examples: z.array(
    z.object({
      agreement: supplierRenewalAgreementSchema,
    }),
  ),
});
