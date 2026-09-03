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
import type { Origin } from "./protocol";

export type MainTraceEvent<S, A> =
  /** A preload blocked on the bootstrap channel and was answered. */
  | { kind: "bootstrap-served"; to: number; seq: number }
  /** A running mirror asked for a full snapshot (resync). */
  | { kind: "snapshot-served"; to: number; seq: number }
  /** A renderer proposed an action. */
  | { kind: "dispatch-received"; from: number; origin: Origin; action: A }
  /** The reducer threw; state is untouched and the proposer is told why. */
  | { kind: "dispatch-rejected"; from: number; origin: Origin; reason: string }
  /** The reducer produced a new state. */
  | { kind: "reducer-ran"; action: A; before: S; after: S }
  /**
   * A new state was sent to every subscribed renderer, covering every change
   * after `since` up to and including `seq`.
   */
  | { kind: "broadcast"; seq: number; since: number; origins?: Origin[]; to: number[] };

export type RendererTraceEvent<S, A> =
  /** The mirror was populated from the preload's bootstrap snapshot. */
  | { kind: "bootstrap-applied"; seq: number; state: S }
  /** An action was applied locally as a guess and sent to main. */
  | { kind: "dispatch-sent"; origin: Origin; action: A }
  /** Main confirmed the guess; it was applied there at `seq`. */
  | { kind: "dispatch-confirmed"; origin: Origin; seq: number }
  /** Main rejected the guess; it has been rolled back. */
  | { kind: "dispatch-rejected"; origin: Origin; reason: string }
  /** A broadcast arrived, and what the mirror decided to do with it. */
  | {
      kind: "update-received";
      seq: number;
      since: number;
      origins?: Origin[];
      verdict: "applied" | "stale" | "gap";
    }
  /** A gap was detected and a full snapshot requested. */
  | { kind: "resync-started" }
  /** The snapshot came back; applied only if newer than what arrived meanwhile. */
  | { kind: "resync-finished"; seq: number; applied: boolean }
  /**
   * The snapshot could not be fetched. Not fatal: the mirror is still behind,
   * and the next broadcast will expose the same gap and ask again.
   */
  | { kind: "resync-failed"; reason: string }
  /**
   * What the page now sees: confirmed state with every pending guess replayed
   * on top. Emitted after every change to it, with how many guesses are
   * still waiting on main.
   */
  | { kind: "mirror-changed"; state: S; pending: number };

export type Trace<E> = (event: E) => void;
