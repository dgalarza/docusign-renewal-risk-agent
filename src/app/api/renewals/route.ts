import { NextResponse } from 'next/server';
import {
  renewalReviewWorkflowResultSchema,
  type RenewalReviewWorkflowResult,
} from '@/mastra/domain/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MASTRA_API_URL = 'http://127.0.0.1:4111/api';
const RENEWAL_DISCOVERY_WORKFLOW_ID = 'renewalDiscoveryWorkflow';
const RENEWAL_DISCOVERY_REQUEST =
  'Find supplier agreements renewing in the next 90 days.';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const asOfDate = requestUrl.searchParams.get('asOfDate') ?? undefined;
  const reviewWindowDays = Number(
    requestUrl.searchParams.get('reviewWindowDays') ?? 90,
  );
  // `source=fixture` runs the workflow against the bundled sample portfolio.
  const source =
    requestUrl.searchParams.get('source') === 'fixture' ? 'fixture' : 'docusign_mcp';

  try {
    const result = await runRenewalDiscoveryWorkflowViaMastra({
      request: RENEWAL_DISCOVERY_REQUEST,
      asOfDate,
      reviewWindowDays,
      source,
    });

    return NextResponse.json(renewalReviewWorkflowResultSchema.parse(result));
  } catch (error) {
    return NextResponse.json(
      renewalReviewWorkflowResultSchema.parse(
        buildMastraWorkflowErrorResult({
          asOfDate,
          reviewWindowDays,
          source,
          error,
        }),
      ),
      { status: 502 },
    );
  }
}

const runRenewalDiscoveryWorkflowViaMastra = async (input: {
  request: string;
  asOfDate?: string;
  reviewWindowDays: number;
  source: 'docusign_mcp' | 'fixture';
}) => {
  const response = await fetch(
    `${getMastraApiUrl()}/workflows/${RENEWAL_DISCOVERY_WORKFLOW_ID}/start-async`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputData: input }),
      cache: 'no-store',
    },
  );

  const payload = (await response.json()) as {
    status?: string;
    result?: unknown;
    error?: { message?: string } | string;
  };

  if (!response.ok) {
    throw new Error(`Mastra workflow request failed with HTTP ${response.status}.`);
  }

  if (payload.status !== 'success') {
    const message =
      typeof payload.error === 'string' ? payload.error : payload.error?.message;

    throw new Error(
      `Mastra workflow returned ${payload.status ?? 'unknown'}${message ? `: ${message}` : ''}`,
    );
  }

  return payload.result;
};

const getMastraApiUrl = () =>
  (process.env.MASTRA_API_URL ?? DEFAULT_MASTRA_API_URL).replace(/\/$/, '');

const buildMastraWorkflowErrorResult = ({
  asOfDate,
  reviewWindowDays,
  source,
  error,
}: {
  asOfDate?: string;
  reviewWindowDays: number;
  source: 'docusign_mcp' | 'fixture';
  error: unknown;
}): RenewalReviewWorkflowResult => ({
  status: 'error',
  sourceLabel: source === 'fixture' ? 'Demo fixture' : 'Docusign MCP',
  asOfDate: asOfDate ?? new Date().toISOString().slice(0, 10),
  reviewWindowDays,
  message: 'The preview app could not invoke the Mastra renewal discovery workflow.',
  rows: [],
  availableTools: [],
  selectedTool: null,
  errors: [error instanceof Error ? error.message : String(error)],
  riskBrief: null,
  riskReview: null,
});
