// ===== @wpsa/engine — public API =====
export * from './types.js';

export { runScan, type ProgressFn } from './scanners/index.js';
export { resolveSourceDir, readProjectFiles, parseGitHubUrl } from './scanners/repo-scanner.js';

export { runSecuritySeoScan, analyzeHtmlSeo, checkResponseHeaders } from './detectors/security-detector.js';
export { runBundleScan, detectStack, type BundleScanResult, type DetectedStack } from './detectors/bundle-detector.js';
export { runLighthouseScan, type LighthouseScanResult } from './detectors/lighthouse-detector.js';
export { runRerenderScan, type RerenderScanResult } from './detectors/rerender-detector.js';
export { runMemoryScan, type MemoryScanResult, type MemorySample } from './detectors/memory-detector.js';

export { generateFixPlan } from './ai/fix-generator.js';
export { aiConfigFromEnv } from './ai/client.js';
export type { AiConfig } from './ai/types.js';

export { createFixPR, buildPrBody } from './github/pr-builder.js';
