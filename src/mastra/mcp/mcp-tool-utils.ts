// Shared helpers for calling Docusign MCP tools directly from the tool map
// (outside any agent), used by both the Workflow Builder handoff and the
// Agreement Manager reconciliation step. MCP tool results arrive as content
// blocks ({ content: [{ type: 'text', text: '...' }] }) where the text is
// usually JSON — these helpers unwrap and parse that shape consistently.

export const executeMcpTool = async (tool: unknown, input: unknown) => {
  const executable = tool as {
    execute?: (input: unknown, context: unknown) => Promise<unknown>;
  };

  if (!executable.execute) {
    throw new Error('Docusign MCP tool does not expose an execute function.');
  }

  return executable.execute(input, undefined);
};

export const parseMcpTextPayload = (value: unknown): unknown | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const content = (value as { content?: unknown }).content;

  if (!Array.isArray(content)) {
    return null;
  }

  const textBlock = content.find(
    block =>
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string',
  ) as { text: string } | undefined;

  if (!textBlock) {
    return null;
  }

  try {
    return JSON.parse(textBlock.text);
  } catch {
    return null;
  }
};

export const readMcpError = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record.error === true || record.isError === true) {
    return typeof record.message === 'string' ? record.message : 'Docusign MCP returned an error.';
  }

  return null;
};

// Response shapes are not stable across MCP server versions (snake_case vs
// camelCase, nested under `result` or another object), so probe known
// variants rather than trusting one path.
export const readStringPath = (value: unknown, paths: string[]) => {
  for (const path of paths) {
    const resolved = path.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') {
        return undefined;
      }

      return (current as Record<string, unknown>)[segment];
    }, value);

    if (typeof resolved === 'string') {
      return resolved;
    }
  }

  return null;
};
