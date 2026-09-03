/**
 * Channels and shapes used ONLY by the example's inspector. Nothing in here
 * is part of the library; it is the plumbing that lets one window watch what
 * the library is doing in main and in the two embedded renderers, and poke
 * at the conditions it runs under.
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
  /**
   * inspector → main → every pane's preload: how long each message should
   * take to cross the boundary, in ms. Real IPC is sub-millisecond; this
   * makes the wait visible.
   */
  latency: "demo:latency",
  /** inspector → main: refuse the next proposal, whatever it is. */
  rejectNext: "demo:reject-next",
  /**
   * inspector → main → both pages: dispatch a burst of actions right now.
   * The point is to give main more asks than it can answer at once, so its
   * answers visibly fall behind while the pages stay instant.
   */
  rush: "demo:rush",
} as const;

export type PaneLabel = "a" | "b";

export type Rect = { x: number; y: number; width: number; height: number };

export type Slots = Record<PaneLabel, Rect>;

export type MetaEvent =
  | { kind: "pane-created"; id: number; label: PaneLabel }
  /** The chaos switch changed, or was consumed by a rejection. */
  | { kind: "reject-armed"; armed: boolean };

export type FeedBody =
  | { side: "main"; event: MainTraceEvent<AppState, AppAction> }
  | {
      side: "renderer";
      from: number;
      event: RendererTraceEvent<AppState, AppAction>;
    }
  | { side: "meta"; event: MetaEvent };

export type Feed = FeedBody & { at: number };
