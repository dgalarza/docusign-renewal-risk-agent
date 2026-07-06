import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  followUpActionSchema,
  humanDecisionSchema,
  renewalAgreementTableRowSchema,
  renewalDecisionResultSchema,
  renewalRiskFindingSchema,
  type RenewalDecisionResult,
} from '@/mastra/domain/schemas';
import { createFollowUpPlan } from '@/mastra/tools/follow-up-tools';
import { createWorkflowBuilderHandoff } from '@/mastra/tools/workflow-builder-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const decisionRequestSchema = z.object({
  row: renewalAgreementTableRowSchema,
  finding: renewalRiskFindingSchema,
  decision: z.object({
    agreementId: z.string(),
    decision: z.enum(['approved', 'edited', 'rejected']),
    selectedAction: followUpActionSchema,
    reviewer: z.string().min(1),
    notes: z.string(),
  }),
});

/**
 * Human approval checkpoint. The reviewer's decision arrives here from the
 * preview UI; only after validation does the server build a follow-up plan,
 * append the local JSONL decision trail, and — for approved or overridden
 * actions — trigger the Docusign Workflow Builder follow-up through MCP.
 * Rejected decisions and no_action overrides never reach Workflow Builder.
 */
export async function POST(request: Request) {
  try {
    const parsed = decisionRequestSchema.parse(await request.json());

    if (parsed.row.agreementId !== parsed.finding.agreementId) {
      throw new Error('Decision row and finding agreement IDs do not match.');
    }

    if (parsed.decision.agreementId !== parsed.finding.agreementId) {
      throw new Error('Decision agreement ID does not match the selected finding.');
    }

    const decision = humanDecisionSchema.parse({
      ...parsed.decision,
      decidedAt: new Date().toISOString(),
    });
    const followUpPlan = createFollowUpPlan(parsed.finding, decision);
    const workflowBuilder = await createWorkflowBuilderHandoff({
      row: parsed.row,
      finding: parsed.finding,
      decision,
      followUpPlan,
    });
    const result = renewalDecisionResultSchema.parse({
      decision,
      followUpPlan,
      workflowBuilder,
    } satisfies RenewalDecisionResult);

    await appendDecisionTrail(result);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}

const appendDecisionTrail = async (result: RenewalDecisionResult) => {
  const trailPath = resolve(process.cwd(), '.mastra', 'renewal-decision-trail.jsonl');
  await mkdir(dirname(trailPath), { recursive: true });
  await appendFile(trailPath, `${JSON.stringify(result)}\n`, 'utf8');
};
