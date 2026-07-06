import { Agent } from '@mastra/core/agent';
import { docusignMcpClient } from '../mcp/docusign-mcp-client';

export const intakeAgent = new Agent({
  id: 'intake-agent',
  name: 'Intake Agent',
  description:
    'Finds completed supplier agreements in Docusign Agreement Manager through MCP.',
  instructions: `You are the Intake Agent for a Docusign renewal-risk workflow.

Your job is agreement discovery:
- Use Docusign Agreement Manager as the source of truth.
- Use the Docusign MCP tools you have been given.
- Only read agreement data. Do not create, update, send, or trigger anything.
- Do not invent agreement fields that Docusign did not return.

The workflow will normalize the MCP records into the preview table.`,
  model: 'openai/gpt-5.4-nano',
  tools: await docusignMcpClient.listTools(),
});
