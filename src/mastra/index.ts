import { Mastra } from '@mastra/core/mastra';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import { resolve } from 'node:path';
import { intakeAgent } from './agents/intake-agent';
import { renewalDiscoveryWorkflow } from './workflows/renewal-discovery-workflow';

export { intakeAgent } from './agents/intake-agent';
export {
  classifyRenewalRisk,
  createRenewalRiskBrief,
  mapRenewalRowsToAgreements,
  mapRenewalRowToAgreement,
  renewalRiskSeverityOrder,
} from './tools/portfolio-tools';
export {
  renewalDiscoveryWorkflow,
  runRenewalDiscoveryWorkflow,
} from './workflows/renewal-discovery-workflow';
export {
  docusignMcpClient,
} from './mcp/docusign-mcp-client';
export { createFollowUpPlan } from './tools/follow-up-tools';
export type {
  FollowUpPlan,
  HumanDecision,
  RenewalAgreementTableRow,
  RenewalDiscoveryResult,
  RenewalRiskBrief,
  RenewalRiskFinding,
  SupplierRenewalAgreement,
} from './domain/schemas';

const libSqlStore = new LibSQLStore({
  id: 'mastra-storage',
  url: `file:${resolve(process.cwd(), 'mastra.db')}`,
});

const duckDbStore = new DuckDBStore({
  id: 'mastra-observability-storage',
  path: resolve(process.cwd(), 'mastra-observability.duckdb'),
});

const storage = new MastraCompositeStore({
  id: 'mastra-composite-storage',
  default: libSqlStore,
  domains: {
    observability: duckDbStore.observability,
  },
});

export const mastra = new Mastra({
  server: { port: 4111 },
  agents: { intakeAgent },
  workflows: { renewalDiscoveryWorkflow },
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'docusign-renewal-risk-agent',
        exporters: [new MastraStorageExporter()],
      },
    },
  }),
  storage,
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
