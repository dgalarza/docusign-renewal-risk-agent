import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'gstudio',
    'gstudio.tail39a142.ts.net',
    '100.102.21.100',
    '127.0.0.1',
  ],
  serverExternalPackages: [
    '@mastra/core',
    '@mastra/duckdb',
    '@mastra/libsql',
    '@mastra/mcp',
  ],
};

export default nextConfig;
