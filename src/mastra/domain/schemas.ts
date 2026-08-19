import { z } from 'zod';

// These schemas are the single data contract for the demo: the Mastra
// workflow, the Next.js routes, and the preview UI all import from here.
// Several are also passed to Agent.generate() as structuredOutput schemas,
// so the .describe() annotations below double as instructions the LLM sees
// when producing each field.

export const renewalTypeSchema = z
  .enum(['auto_renews', 'manual_renewal', 'evergreen', 'none', 'not_extracted'])
  .describe(
    'How the agreement renews. evergreen = continues indefinitely until cancelled; not_extracted = Agreement Manager did not return a renewal provision.',
  );

export const renewalRiskClassificationSchema = z.enum(['standard', 'needs_review', 'urgent', 'blocked']);

export const followUpActionSchema = z.enum([
  'no_action',
  'owner_review',
  'legal_review',
  'renegotiate',
  'prepare_cancellation_notice',
  'escalate_missed_deadline',
]);

export const supplierRenewalAgreementSchema = z.object({
  agreementId: z.string(),
  supplierName: z.string(),
  agreementTitle: z.string(),
  agreementValue: z
    .number()
    .nullable()
    .describe('Annual or renewal value as a plain number; null when not extracted.'),
  currency: z
    .string()
    .nullable()
    .describe('ISO currency code; null when not extracted. Never guess a default currency.'),
  renewalType: renewalTypeSchema,
  renewalDate: z
    .string()
    .nullable()
    .describe('ISO date (YYYY-MM-DD) of the next renewal; null when not extracted.'),
  noticePeriodDays: z
    .number()
    .nullable()
    .describe('Days of notice required to cancel or change the renewal.'),
  noticeDeadline: z
    .string()
    .nullable()
    .describe(
      'Last ISO date to act before renewal. Derived as renewalDate minus noticePeriodDays when Agreement Manager does not extract it directly.',
    ),
});

export const renewalAgreementSourceSchema = z.object({
  system: z.enum(['docusign_mcp', 'fixture']),
  toolName: z.string().optional(),
  recordId: z.string().optional(),
  recordUrl: z.string().optional(),
  rawStatus: z.string().optional(),
  missingFields: z
    .array(z.string())
    .describe(
      'Table fields the source could not provide. Missing data is surfaced as an extraction gap, never invented — the policy engine routes rows with missing renewal terms to needs_review.',
    ),
  reconciledFields: z
    .array(z.string())
    .optional()
    .describe(
      'Table fields that were null/not_extracted from the Intake Agent and were deterministically filled in from the Agreement Manager record (the Intake Agent had no value for the field).',
    ),
  overriddenFields: z
    .array(z.string())
    .optional()
    .describe(
      'Table fields where the Intake Agent returned a value but the Agreement Manager record (fetched via docusign_getAgreementDetails) disagreed and won — the record is always authoritative when it has a value.',
    ),
});

export const renewalAgreementTableRowSchema = z.object({
  agreementId: z.string(),
  supplier: z.string(),
  agreementTitle: z.string(),
  renewalDate: z.string().nullable(),
  noticePeriodDays: z.number().nullable(),
  noticeDeadline: z.string().nullable(),
  daysUntilNoticeDeadline: z
    .number()
    .nullable()
    .describe('Days from asOfDate to noticeDeadline; negative when the deadline has passed.'),
  agreementValue: z.number().nullable(),
  currency: z
    .string()
    .nullable()
    .describe('ISO currency code; null when not extracted. Never guess a default currency.'),
  renewalType: renewalTypeSchema,
  source: renewalAgreementSourceSchema,
  noticeDeadlineDerived: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'True when noticeDeadline was not extracted directly and was instead derived as renewalDate minus noticePeriodDays.',
    ),
});

export const renewalDiscoveryStatusSchema = z
  .enum(['live', 'empty', 'missing_fields', 'error'])
  .describe(
    'live = every returned row is complete; missing_fields = rows returned but some renewal fields were not extracted; empty = no agreements matched; error = the source call failed.',
  );

export const renewalDiscoveryResultSchema = z.object({
  status: renewalDiscoveryStatusSchema,
  sourceLabel: z.string(),
  asOfDate: z.string(),
  reviewWindowDays: z.number(),
  message: z.string(),
  rows: z.array(renewalAgreementTableRowSchema),
  availableTools: z.array(z.string()),
  selectedTool: z.string().nullable(),
  errors: z.array(z.string()),
});

export const renewalRiskFindingSchema = z.object({
  agreementId: z.string(),
  supplierName: z.string(),
  classification: renewalRiskClassificationSchema,
  recommendedAction: followUpActionSchema,
  rationale: z.string(),
  daysUntilNoticeDeadline: z.number().nullable(),
  extractedSignals: z.array(z.string()),
});

export const renewalRiskBriefSchema = z.object({
  generatedAt: z.string(),
  reviewWindowDays: z.number(),
  agreementsReviewed: z.number(),
  findings: z.array(renewalRiskFindingSchema),
});

export const renewalRiskAgentGuidanceSchema = z.object({
  agreementId: z.string(),
  judgment: z.string(),
  reasonForPriority: z.string(),
  suggestedReviewer: z.enum([
    'procurement_owner',
    'legal',
    'executive_escalation',
    'none',
  ]),
});

export const renewalRiskAgentJudgmentSchema = z.object({
  portfolioJudgment: z.string(),
  priorityAgreementIds: z.array(z.string()),
  reviewerGuidance: z.array(renewalRiskAgentGuidanceSchema),
});

export const renewalReviewWorkflowResultSchema = renewalDiscoveryResultSchema.extend({
  riskBrief: renewalRiskBriefSchema.nullable(),
  riskReview: renewalRiskAgentJudgmentSchema.nullable(),
});

export const humanDecisionSchema = z.object({
  agreementId: z.string(),
  decision: z.enum(['approved', 'edited', 'rejected']),
  selectedAction: followUpActionSchema,
  reviewer: z.string(),
  notes: z.string(),
  decidedAt: z.string(),
});

export const followUpPlanSchema = z.object({
  agreementId: z.string(),
  action: followUpActionSchema,
  status: z.enum(['planned', 'skipped']),
  surface: z.literal('Workflow Builder'),
  details: z.string(),
});

export const workflowBuilderHandoffSchema = z.object({
  workflowId: z.string().nullable(),
  accountId: z.string().nullable(),
  workflowName: z.string(),
  status: z.enum([
    'not_configured',
    'triggered',
    'failed',
    'skipped',
  ]),
  details: z.string(),
  triggerPayload: z.record(z.string(), z.unknown()).nullable(),
  requirements: z.unknown().nullable(),
  instanceId: z.string().nullable(),
  instanceUrl: z.string().nullable(),
  errors: z.array(z.string()),
});

export const renewalDecisionResultSchema = z.object({
  decision: humanDecisionSchema,
  followUpPlan: followUpPlanSchema,
  workflowBuilder: workflowBuilderHandoffSchema,
});

export type SupplierRenewalAgreement = z.infer<typeof supplierRenewalAgreementSchema>;
export type RenewalType = z.infer<typeof renewalTypeSchema>;
export type RenewalRiskClassification = z.infer<typeof renewalRiskClassificationSchema>;
export type FollowUpAction = z.infer<typeof followUpActionSchema>;
export type RenewalAgreementSource = z.infer<typeof renewalAgreementSourceSchema>;
export type RenewalAgreementTableRow = z.infer<typeof renewalAgreementTableRowSchema>;
export type RenewalDiscoveryResult = z.infer<typeof renewalDiscoveryResultSchema>;
export type RenewalRiskFinding = z.infer<typeof renewalRiskFindingSchema>;
export type RenewalRiskBrief = z.infer<typeof renewalRiskBriefSchema>;
export type RenewalRiskAgentGuidance = z.infer<typeof renewalRiskAgentGuidanceSchema>;
export type RenewalRiskAgentJudgment = z.infer<typeof renewalRiskAgentJudgmentSchema>;
export type RenewalReviewWorkflowResult = z.infer<typeof renewalReviewWorkflowResultSchema>;
export type HumanDecision = z.infer<typeof humanDecisionSchema>;
export type FollowUpPlan = z.infer<typeof followUpPlanSchema>;
export type WorkflowBuilderHandoff = z.infer<typeof workflowBuilderHandoffSchema>;
export type RenewalDecisionResult = z.infer<typeof renewalDecisionResultSchema>;
