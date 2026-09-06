/** Single import surface for generated specs. */
export { mock, mockByRequest, unmock, mockAll } from './utils/api-mocker.js';
export { RuntimeCollector } from './services/runtime-collector.js';
export { analyze } from './services/ai-analyzer.js';
export { attachAnalysisToReport } from './utils/report-helper.js';
export { captureFailureDiagnostics, captureNavigationCensus } from './utils/diagnostics-helper.js';
export { defaultAdapter, resolveTarget, describeActiveElement } from './utils/default-adapter.js';
export { loadKitConfig } from './config-loader.js';
export const KIT_VERSION = '0.1.0';
