import { NextResponse } from 'next/server';
import { renewalDiscoveryResultSchema } from '@/mastra/domain/schemas';
import { runRenewalDiscoveryWorkflow } from '@/mastra/workflows/renewal-discovery-workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const asOfDate = requestUrl.searchParams.get('asOfDate') ?? undefined;
  const reviewWindowDays = Number(requestUrl.searchParams.get('reviewWindowDays') ?? 90);

  const result = await runRenewalDiscoveryWorkflow({
    request: 'Find supplier agreements renewing in the next 90 days.',
    asOfDate,
    reviewWindowDays,
  });

  return NextResponse.json(renewalDiscoveryResultSchema.parse(result));
}
