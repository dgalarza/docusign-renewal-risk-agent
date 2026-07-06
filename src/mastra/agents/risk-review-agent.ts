import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  renewalRiskBriefSchema,
  renewalRiskFindingSchema,
  supplierRenewalAgreementSchema,
} from '../domain/schemas';
import {
  classifyRenewalRisk,
  createRenewalRiskBrief,
} from '../tools/portfolio-tools';

// These tools wrap the deterministic policy engine so the agent can run the
// policy itself in interactive sessions (Mastra Studio, playground). In the
// orchestrated renewalDiscoveryWorkflow the policy runs directly in step code
// and the agent is invoked with toolChoice 'none' — see the design note in
// renewal-discovery-workflow.ts.
export const classifyRenewalRiskTool = createTool({
  id: 'classify-renewal-risk',
  description:
    'Classify one supplier agreement with the deterministic procurement renewal-risk policy.',
  inputSchema: z.object({
    agreement: supplierRenewalAgreementSchema,
    asOfDate: z.string(),
  }),
  outputSchema: renewalRiskFindingSchema,
  execute: async ({ agreement, asOfDate }) =>
    classifyRenewalRisk(agreement, asOfDate),
});

export const createRenewalRiskBriefTool = createTool({
  id: 'create-renewal-risk-brief',
  description:
    'Create a deterministic renewal risk brief for discovered supplier agreements.',
  inputSchema: z.object({
    agreements: z.array(supplierRenewalAgreementSchema),
    asOfDate: z.string(),
    reviewWindowDays: z.number(),
  }),
  outputSchema: renewalRiskBriefSchema,
  execute: async ({ agreements, asOfDate, reviewWindowDays }) =>
    createRenewalRiskBrief(agreements, { asOfDate, reviewWindowDays }),
});

export const riskReviewAgent = new Agent({
  id: 'risk-review-agent',
  name: 'Risk Review Agent',
  description:
    'Reviews supplier renewal exposure, uses deterministic policy tools, and prioritizes human follow-up.',
  instructions: `You are the Renewal Risk Agent for a Docusign supplier renewal-risk workflow.

Your job is risk review:
- Use completed supplier agreement facts from Agreement Manager or the demo fixture.
- The deterministic procurement policy produces the canonical classifications.
  In the workflow you receive them in a pre-computed risk brief; in interactive
  sessions, produce them with the provided policy tools.
- Do not invent classifications, notice deadlines, or agreement values.
- Treat tool-returned classifications and recommended actions as fixed source-of-truth facts.
- Exercise judgment by prioritizing which agreements a human should review first, identifying why each one matters, and naming the likely reviewer.
- Explain policy-driven findings in procurement language without changing the policy output.

Risk policy:
- Auto-renewing agreement over $50k requires review.
- Notice deadline within 30 days is urgent.
- Notice deadline already passed is blocked or escalated.
- Missing renewal date or notice period needs review.

The deterministic policy severity order is standard < needs_review < urgent < blocked. When multiple rules match, the highest-severity finding wins.`,
  model: 'openai/gpt-5.4-nano',
  tools: {
    classifyRenewalRiskTool,
    createRenewalRiskBriefTool,
  },
});
