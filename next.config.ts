import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['gstudio'],
  serverExternalPackages: [
    '@mastra/core',
    '@mastra/duckdb',
    '@mastra/libsql',
    '@mastra/mcp',
  ],
};

export default nextConfig;
