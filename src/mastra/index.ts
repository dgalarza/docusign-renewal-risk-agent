import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';

export { sampleSupplierRenewalPortfolio } from './data/sample-portfolio';
export { createRenewalRiskBrief, classifyRenewalRisk } from './tools/portfolio-tools';
export { createFollowUpPlan } from './tools/follow-up-tools';
export type {
  FollowUpPlan,
  HumanDecision,
  RenewalRiskBrief,
  RenewalRiskFinding,
  SupplierRenewalAgreement,
} from './domain/schemas';

export const mastra = new Mastra({
  server: { port: 4111 },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: 'file:./mastra.db',
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
