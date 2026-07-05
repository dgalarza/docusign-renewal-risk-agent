#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

loadDotEnv();

const mode = process.argv[2] ?? 'status';
const asOfDate = process.argv[3];
const reviewWindowDays = Number(process.argv[4] ?? 90);

if (mode === 'fixture') {
  const { runRenewalFixtureReview } = await import(
    '../src/mastra/workflows/renewal-discovery-workflow'
  );
  const result = await runRenewalFixtureReview({
    asOfDate,
    reviewWindowDays,
  });
  console.log(JSON.stringify(result, null, 2));
} else if (mode === 'discover') {
  const { runRenewalDiscoveryWorkflow } = await import(
    '../src/mastra/workflows/renewal-discovery-workflow'
  );
  const result = await runRenewalDiscoveryWorkflow({
    request: 'Find supplier agreements renewing in the next 90 days.',
    asOfDate,
    reviewWindowDays,
    source: 'docusign_mcp',
  });
  console.log(JSON.stringify(result, null, 2));
} else {
  const { docusignMcpClient, getDocusignMcpUrl } = await import(
    '../src/mastra/mcp/docusign-mcp-client'
  );
  const { tools, errors } = await docusignMcpClient.listToolsWithErrors();
  const status = {
    configured: Boolean(process.env.DOCUSIGN_MCP_ACCESS_TOKEN),
    url: getDocusignMcpUrl(),
    tools: Object.keys(tools).sort(),
    errors,
  };
  console.log(JSON.stringify(status, null, 2));
  await docusignMcpClient.disconnect();
}

function loadDotEnv() {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env'), 'utf8');

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        continue;
      }

      const [key, ...valueParts] = trimmed.split('=');
      process.env[key.trim()] ??= valueParts.join('=').trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // The status/discovery commands surface missing local auth without crashing here.
  }
}
