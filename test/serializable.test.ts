/**
 * The compile-time half of this file is the point of it.
 *
 * Every `@ts-expect-error` below is an assertion: if `Serializable<T>` ever
 * stops rejecting that shape, the directive becomes unused and `npm run
 * typecheck` fails. The runtime tests exist to show what the type is protecting
 * against — the silent degradation is real, and it happens with no error.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Reducer } from "../src/core/store";
import type { Serializable } from "../src/shared/serializable";

/** The real signature, without importing electron into a plain Node test. */
declare const createMainStore: typeof import("../src/main").createMainStore;

type Action = { type: "noop" };

class Counter {
  constructor(public n = 0) {}
  bump(): void {
    this.n += 1;
  }
}

/** A class with no methods: accepted, and the reason is a test of its own below. */
class Point {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

type Good = {
  count: number;
  user: string;
  tags: string[];
  nested: { at: Date; pattern: RegExp; seen: Set<string>; by: Map<string, number> };
};
type WithMethod = { count: number; bump(): void };
type WithNestedFunction = { count: number; handlers: { onTick: () => void } };
type WithPromise = { count: number; loading: Promise<number> };
type InAnArray = { rows: Array<{ id: number; render: () => string }> };
type WithClass = { counter: Counter };

declare const good: Good;
declare const goodReducer: Reducer<Good, Action>;
declare const withMethod: WithMethod;
declare const withMethodReducer: Reducer<WithMethod, Action>;
declare const withNestedFunction: WithNestedFunction;
declare const withNestedFunctionReducer: Reducer<WithNestedFunction, Action>;
declare const withPromise: WithPromise;
declare const withPromiseReducer: Reducer<WithPromise, Action>;
declare const inAnArray: InAnArray;
declare const inAnArrayReducer: Reducer<InAnArray, Action>;
declare const withClass: WithClass;
declare const withClassReducer: Reducer<WithClass, Action>;

/**
 * Never called. Every line in here is an assertion the compiler makes; actually
 * running them would need a real Electron main process, and there is nothing to
 * run — the point is only whether this file compiles.
 */
export function compilerChecks(): void {
  // Survives the crossing, and comes back out unchanged.
  createMainStore(goodReducer, good);
  expectTypeOf<Serializable<Good>>().toEqualTypeOf<Good>();

  // @ts-expect-error a method is stripped in transit, silently
  createMainStore(withMethodReducer, withMethod);

  // @ts-expect-error the tree is walked all the way down
  createMainStore(withNestedFunctionReducer, withNestedFunction);

  // @ts-expect-error a promise throws on the way across
  createMainStore(withPromiseReducer, withPromise);

  // @ts-expect-error arrays and tuples are walked like anything else
  createMainStore(inAnArrayReducer, inAnArray);

  // @ts-expect-error a class instance with methods is the case worth catching
  createMainStore(withClassReducer, withClass);

  // The limitation, written down rather than left to a comment: a class with no
  // methods is indistinguishable from a plain object to the compiler
  // (microsoft/TypeScript#29063), so it is accepted. It loses only its
  // prototype identity, which is the harmless half of the problem.
  expectTypeOf<Serializable<{ at: Point }>>().toEqualTypeOf<{ at: { x: number; y: number } }>();
}

describe("what the compiler is protecting against", () => {
  it("silently strips the methods off a class instance", () => {
    const clone = structuredClone(new Counter(1));
    expect(clone.n).toBe(1);
    // Nothing threw. The object simply is not a Counter any more.
    expect(clone instanceof Counter).toBe(false);
    expect((clone as { bump?: unknown }).bump).toBeUndefined();
  });

  it("throws outright on a function", () => {
    expect(() => structuredClone({ onTick: () => {} })).toThrow();
  });

  it("carries every shape the type accepts", () => {
    const value: Good = {
      count: 1,
      user: "ada",
      tags: ["a"],
      nested: { at: new Date(0), pattern: /x/g, seen: new Set(["a"]), by: new Map([["a", 1]]) },
    };
    expect(structuredClone(value)).toEqual(value);
  });
});
