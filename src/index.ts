/**
 * Public entry point.
 *
 * Only the process-agnostic pieces are re-exported here. The main, preload and
 * renderer adapters are deliberately NOT re-exported: importing this file must
 * never drag `electron` into a context that cannot have it (a plain Node test
 * process, for instance). Consumers import those by subpath.
 */

export * from "./core/store";
export * from "./shared/protocol";
