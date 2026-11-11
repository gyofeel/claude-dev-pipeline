/** Single import surface for generated specs. */
export { test, expect } from './fixture.js';
export { mock, mockByRequest, unmock, mockAll } from './utils/api-mocker.js';
export { RuntimeCollector } from './services/runtime-collector.js';
export { judge } from './services/judge.js';
export { analyze } from './services/analyze.js';
export { attachAnalysisToReport } from './utils/report-helper.js';
export { runtimeErrors } from './utils/runtime-filter.mjs';
export { captureFailureDiagnostics, captureNavigationCensus } from './utils/diagnostics-helper.js';
export { watchSelectors, readWatch } from './utils/watch-helper.js';
export { defaultAdapter, resolveTarget, describeActiveElement } from './utils/default-adapter.js';
export { loadKitConfig } from './config-loader.js';
export const KIT_VERSION = '0.2.0';
