/** Public API of the ARS engine (used by the server and the CLI). */
export * from './core/types.ts';
export * from './core/entities.ts';
export { get, list, mustGet, put, update } from './core/store.ts';
export { facts } from './core/factsCache.ts';
export { DATA_DIR } from './core/paths.ts';
export { describeFormatting } from './analyzers/format.ts';
export { FEATURE_MAP } from './mine/features.ts';
export { LAYERS } from './core/types.ts';
export * from './pipeline.ts';
export { cancelJob, getJob, listJobs, onJob } from './jobs.ts';
export { createExperiment, estimateCost, experimentsOf, runsOf } from './bench/experiment.ts';
export { TASKS } from './bench/tasks.ts';
export { installPackage } from './skills/install.ts';
export { SKILLS } from './skills/generate.ts';
export { describeChange, diagnoseExperiment, dismissProposal, gateProposal, promoteProposal, proposalsOf, recategorize } from './improve/loop.ts';
export { llmConfigured, MODELS, AGENT_MODEL } from './llm/claude.ts';
