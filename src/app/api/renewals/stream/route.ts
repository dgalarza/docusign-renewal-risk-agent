import {
  renewalDiscoveryResultSchema,
  renewalReviewWorkflowResultSchema,
  type RenewalReviewWorkflowResult,
} from '@/mastra/domain/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MASTRA_API_URL = 'http://127.0.0.1:4111/api';
const RENEWAL_DISCOVERY_WORKFLOW_ID = 'renewalDiscoveryWorkflow';
const RENEWAL_DISCOVERY_REQUEST =
  'Find supplier agreements renewing in the next 90 days.';
const MASTRA_RECORD_SEPARATOR = '\x1E';

type ProgressEvent = {
  kind: string;
  label: string;
  detail: string | null;
};

type MastraWorkflowChunk = {
  type?: string;
  payload?: Record<string, unknown>;
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const asOfDate =
    requestUrl.searchParams.get('asOfDate') ?? new Date().toISOString().slice(0, 10);
  const reviewWindowDays = Number(
    requestUrl.searchParams.get('reviewWindowDays') ?? 90,
  );
  const runId = crypto.randomUUID();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      const progress = (kind: string, label: string, detail: string | null = null) =>
        send('progress', { kind, label, detail } satisfies ProgressEvent);

      try {
        progress('dispatch', 'Workflow dispatched to Mastra', `Run ${runId.slice(0, 8)}`);

        const upstream = await fetch(
          `${getMastraApiUrl()}/workflows/${RENEWAL_DISCOVERY_WORKFLOW_ID}/stream?runId=${runId}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              inputData: {
                request: RENEWAL_DISCOVERY_REQUEST,
                asOfDate,
                reviewWindowDays,
              },
            }),
            cache: 'no-store',
            signal: request.signal,
          },
        );

        if (!upstream.ok || !upstream.body) {
          throw new Error(
            `Mastra workflow stream request failed with HTTP ${upstream.status}.`,
          );
        }

        let result: RenewalReviewWorkflowResult | null = null;
        let failure: string | null = null;

        for await (const chunk of readWorkflowChunks(upstream.body)) {
          const translated = translateWorkflowChunk(chunk);

          for (const event of translated.progress) {
            progress(event.kind, event.label, event.detail);
          }

          result = translated.result ?? result;
          failure = translated.failure ?? failure;
        }

        if (failure) {
          throw new Error(failure);
        }

        if (!result) {
          throw new Error('The workflow stream closed without returning a result.');
        }

        send('result', result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        send('failure', {
          message:
            message === 'fetch failed'
              ? `Could not reach the Mastra workflow API at ${getMastraApiUrl()}. Start it with \`npm run dev\`.`
              : message,
          asOfDate,
          reviewWindowDays,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

const getMastraApiUrl = () =>
  (process.env.MASTRA_API_URL ?? DEFAULT_MASTRA_API_URL).replace(/\/$/, '');

async function* readWorkflowChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<MastraWorkflowChunk> {
  const decoder = new TextDecoder();
  let buffered = '';

  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buffered += decoder.decode(bytes, { stream: true });

    const records = buffered.split(MASTRA_RECORD_SEPARATOR);
    buffered = records.pop() ?? '';

    for (const record of records) {
      const parsed = parseRecord(record);

      if (parsed) {
        yield parsed;
      }
    }
  }

  const parsed = parseRecord(buffered);

  if (parsed) {
    yield parsed;
  }
}

const parseRecord = (record: string): MastraWorkflowChunk | null => {
  const trimmed = record.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as MastraWorkflowChunk;
  } catch {
    return null;
  }
};

const translateWorkflowChunk = (
  chunk: MastraWorkflowChunk,
): {
  progress: ProgressEvent[];
  result: RenewalReviewWorkflowResult | null;
  failure: string | null;
} => {
  const payload = chunk.payload ?? {};

  switch (chunk.type) {
    case 'workflow-step-output': {
      const custom = findRenewalProgress(payload.output);

      return custom ? only(custom) : none();
    }

    case 'workflow-step-result': {
      if (payload.status === 'success') {
        const parsed = renewalReviewWorkflowResultSchema.safeParse(payload.output);
        const intermediate = renewalDiscoveryResultSchema.safeParse(payload.output);

        return {
          progress: [],
          result: parsed.success ? parsed.data : null,
          failure: parsed.success || intermediate.success
            ? null
            : 'The workflow step returned data the preview could not parse.',
        };
      }

      return {
        progress: [],
        result: null,
        failure:
          readErrorMessage(payload.error) ??
          `The workflow step ended with status ${readString(payload.status) ?? 'unknown'}.`,
      };
    }

    default:
      return none();
  }
};

const only = (event: ProgressEvent) => ({
  progress: [event],
  result: null,
  failure: null,
});

const none = () => ({ progress: [], result: null, failure: null });

const findRenewalProgress = (value: unknown, depth = 0): ProgressEvent | null => {
  if (!value || typeof value !== 'object' || depth > 4) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record.type === 'renewal-progress' && typeof record.label === 'string') {
    return {
      kind: typeof record.kind === 'string' ? record.kind : 'progress',
      label: record.label,
      detail: typeof record.detail === 'string' ? record.detail : null,
    };
  }

  return (
    findRenewalProgress(record.output, depth + 1) ??
    findRenewalProgress(record.payload, depth + 1)
  );
};

const readString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const readErrorMessage = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object' && 'message' in value) {
    return readString((value as { message: unknown }).message);
  }

  return null;
};
