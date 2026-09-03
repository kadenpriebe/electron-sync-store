/**
 * Channels and shapes used ONLY by the example's inspector. Nothing in here
 * is part of the library; it is the plumbing that lets one window watch what
 * the library is doing in main and in the two embedded renderers.
 */
import type { MainTraceEvent, RendererTraceEvent } from "../src/shared/trace";
import type { AppAction, AppState } from "./state";

export const DEMO = {
  /** renderer pane → main: a RendererTraceEvent from the library. */
  trace: "demo:trace",
  /** inspector → main: page is up, here is where the panes go. */
  ready: "demo:ready",
  /** inspector → main: the panes moved (resize / scroll). */
  slots: "demo:slots",
  /** inspector → main: reload one pane. */
  reload: "demo:reload",
  /** main → inspector: one entry for the log and the animation. */
  feed: "demo:feed",
} as const;

export type PaneLabel = "a" | "b";

export type Rect = { x: number; y: number; width: number; height: number };

export type Slots = Record<PaneLabel, Rect>;

export type FeedBody =
  | { side: "main"; event: MainTraceEvent<AppState, AppAction> }
  | {
      side: "renderer";
      from: number;
      event: RendererTraceEvent<AppState, AppAction>;
    }
  | {
      side: "meta";
      event: { kind: "pane-created"; id: number; label: PaneLabel };
    };

export type Feed = FeedBody & { at: number };
