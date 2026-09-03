/**
 * Optional instrumentation.
 *
 * Both stores accept a `trace` callback. It is invoked synchronously at every
 * point where the library makes a decision, with a plain-data description of
 * that decision. The library does nothing with these events itself: the hook
 * exists so a host can log, visualise or assert on what happened inside the
 * store without reaching into its internals.
 *
 * `to` and `from` are `webContents.id` values.
 */

export type MainTraceEvent<S, A> =
  /** A preload blocked on the bootstrap channel and was answered. */
  | { kind: "bootstrap-served"; to: number; seq: number }
  /** A running mirror asked for a full snapshot (resync). */
  | { kind: "snapshot-served"; to: number; seq: number }
  /** A renderer proposed an action. */
  | { kind: "dispatch-received"; from: number; action: A }
  /** The reducer produced a new state. */
  | { kind: "reducer-ran"; action: A; before: S; after: S }
  /** A new state was sent to every subscribed renderer. */
  | { kind: "broadcast"; seq: number; to: number[] };

export type RendererTraceEvent<S, A> =
  /** The mirror was populated from the preload's bootstrap snapshot. */
  | { kind: "bootstrap-applied"; seq: number; state: S }
  /** An action left this renderer for main. */
  | { kind: "dispatch-sent"; action: A }
  /** A broadcast arrived, and what the mirror decided to do with it. */
  | { kind: "update-received"; seq: number; verdict: "applied" | "stale" | "gap" }
  /** A gap was detected and a full snapshot requested. */
  | { kind: "resync-started" }
  /** The snapshot came back; applied only if newer than what arrived meanwhile. */
  | { kind: "resync-finished"; seq: number; applied: boolean };

export type Trace<E> = (event: E) => void;
