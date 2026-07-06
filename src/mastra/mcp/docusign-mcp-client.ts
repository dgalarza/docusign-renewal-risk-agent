import {
  MCPClient,
  createSimpleTokenProvider,
  type MastraMCPServerDefinition,
} from '@mastra/mcp';

// Docusign runs separate MCP hosts per environment; the demo (developer
// sandbox) host is the default unless DOCUSIGN_ENVIRONMENT=production.
const DEFAULT_DEMO_MCP_URL = 'https://mcp-d.docusign.com/mcp';
const DEFAULT_PRODUCTION_MCP_URL = 'https://mcp.docusign.com/mcp';
const DOCUSIGN_SERVER_NAME = 'docusign';

export const getDocusignMcpUrl = () => {
  if (process.env.DOCUSIGN_MCP_URL) {
    return process.env.DOCUSIGN_MCP_URL;
  }

  return process.env.DOCUSIGN_ENVIRONMENT === 'production'
    ? DEFAULT_PRODUCTION_MCP_URL
    : DEFAULT_DEMO_MCP_URL;
};

const getRedirectUrl = () =>
  process.env.DOCUSIGN_OAUTH_REDIRECT_URI ?? 'http://localhost:4111/auth/docusign/callback';

// The Docusign MCP server authenticates with a user OAuth token, not an API
// key. `npm run auth:docusign` walks the authorization-code flow and prints
// the token values to paste into .env; the refresh token lets @mastra/mcp
// renew the access token when it expires mid-session. With no token
// configured this returns undefined and the client connects unauthenticated
// (tool listing fails gracefully — see intake-agent.ts).
const buildDocusignMcpAuthProvider = () => {
  const accessToken = process.env.DOCUSIGN_MCP_ACCESS_TOKEN;

  if (!accessToken) {
    return undefined;
  }

  return createSimpleTokenProvider(accessToken, {
    redirectUrl: getRedirectUrl(),
    clientMetadata: {
      redirect_uris: [getRedirectUrl()],
      client_name: 'Docusign Renewal Risk Agent Demo',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    clientInformation: process.env.DOCUSIGN_CLIENT_ID
      ? {
          client_id: process.env.DOCUSIGN_CLIENT_ID,
          client_secret: process.env.DOCUSIGN_CLIENT_SECRET,
        }
      : undefined,
    refreshToken: process.env.DOCUSIGN_MCP_REFRESH_TOKEN,
    scope: process.env.DOCUSIGN_MCP_SCOPE,
  });
};

const getDocusignMcpServerDefinition = (): MastraMCPServerDefinition => ({
  url: new URL(getDocusignMcpUrl()),
  authProvider: buildDocusignMcpAuthProvider(),
  forwardInstructions: false,
});

export const docusignMcpClient = new MCPClient({
  id: 'docusign-renewal-risk-mcp-client',
  servers: {
    [DOCUSIGN_SERVER_NAME]: getDocusignMcpServerDefinition(),
  },
});
