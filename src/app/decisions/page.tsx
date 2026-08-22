import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DecisionTrailList } from '@/components/decision-trail-list';
import { readDecisionTrail } from '@/mastra/tools/decision-trail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Decision trail · Docusign Renewal Discovery',
  description: 'Append-only record of every human renewal decision and its Workflow Builder handoff.',
};

const DECISION_TRAIL_PAGE_SIZE = 50;

/**
 * Read-only audit view. Reads the append-only SQLite trail directly (same
 * module the GET endpoint uses) — no mutation path exists on this page.
 */
export default async function DecisionTrailPage() {
  const { decisions, total, limit } = await readDecisionTrail(DECISION_TRAIL_PAGE_SIZE);

  return (
    <main className="min-h-screen bg-card">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-6 py-7 sm:px-10 lg:px-12">
        <header className="flex flex-col gap-6 border-b pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-2 hover:text-accent-foreground hover:underline"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back to discovery
            </Link>
            <p className="mt-6 font-data text-xs font-semibold uppercase tracking-[0.24em] text-primary">
              Decision trail · append-only
            </p>
            <h1 className="mt-5 font-display text-[2.85rem] font-medium leading-[0.98] text-foreground">
              Every decision, recorded
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
              One row per human decision: the decision, the follow-up plan, and the Workflow
              Builder handoff.
            </p>
          </div>
          <dl className="flex shrink-0 items-end gap-8 lg:pb-1">
            <div>
              <dt className="text-sm text-muted-foreground">Decisions recorded</dt>
              <dd className="m-0 mt-2 font-display text-[2.35rem] font-medium leading-none text-foreground tabular-nums">
                {total}
              </dd>
              <p className="m-0 mt-2 font-data text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
                {total > limit ? `Showing newest ${limit}` : 'Local SQLite · read-only'}
              </p>
            </div>
          </dl>
        </header>

        <DecisionTrailList decisions={decisions} />
      </div>
    </main>
  );
}
