import { z } from 'zod';

export const renewalTypeSchema = z.enum(['auto_renews', 'manual_renewal', 'evergreen', 'none', 'not_extracted']);

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
  agreementStatus: z.enum(['completed', 'uploaded_historical']).nullable(),
  agreementValue: z.number().nullable(),
  currency: z.string(),
  renewalType: renewalTypeSchema,
  renewalDate: z.string().nullable(),
  noticePeriodDays: z.number().nullable(),
  noticeDeadline: z.string().nullable(),
  hasTerminationForConvenience: z.boolean().nullable(),
  terminationFee: z.string(),
  businessOwner: z.string(),
});

export const renewalAgreementSourceSchema = z.object({
  system: z.literal('docusign_mcp'),
  toolName: z.string().optional(),
  recordId: z.string().optional(),
  recordUrl: z.string().optional(),
  rawStatus: z.string().optional(),
  missingFields: z.array(z.string()),
});

export const renewalAgreementTableRowSchema = z.object({
  agreementId: z.string(),
  supplier: z.string(),
  agreementTitle: z.string(),
  agreementStatus: z.enum(['completed', 'uploaded_historical']).nullable(),
  renewalDate: z.string().nullable(),
  noticePeriodDays: z.number().nullable(),
  noticeDeadline: z.string().nullable(),
  daysUntilNoticeDeadline: z.number().nullable(),
  agreementValue: z.number().nullable(),
  currency: z.string(),
  renewalType: renewalTypeSchema,
  hasTerminationForConvenience: z.boolean().nullable(),
  terminationFee: z.string(),
  businessOwner: z.string(),
  source: renewalAgreementSourceSchema,
});

export const renewalDiscoveryStatusSchema = z.enum([
  'live',
  'empty',
  'missing_fields',
  'error',
]);

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

export const humanDecisionSchema = z.object({
  agreementId: z.string(),
  decision: z.enum(['approved', 'edited', 'rejected']),
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

export type SupplierRenewalAgreement = z.infer<typeof supplierRenewalAgreementSchema>;
export type RenewalType = z.infer<typeof renewalTypeSchema>;
export type RenewalRiskClassification = z.infer<typeof renewalRiskClassificationSchema>;
export type FollowUpAction = z.infer<typeof followUpActionSchema>;
export type RenewalAgreementSource = z.infer<typeof renewalAgreementSourceSchema>;
export type RenewalAgreementTableRow = z.infer<typeof renewalAgreementTableRowSchema>;
export type RenewalDiscoveryResult = z.infer<typeof renewalDiscoveryResultSchema>;
export type RenewalRiskFinding = z.infer<typeof renewalRiskFindingSchema>;
export type RenewalRiskBrief = z.infer<typeof renewalRiskBriefSchema>;
export type HumanDecision = z.infer<typeof humanDecisionSchema>;
export type FollowUpPlan = z.infer<typeof followUpPlanSchema>;
