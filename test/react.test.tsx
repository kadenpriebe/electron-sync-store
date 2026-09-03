// @vitest-environment jsdom
/**
 * The React bindings, against the same fake main every other test uses.
 *
 * The assertion that matters is the second one: a component watching the count
 * must not re-render when the name changes. That is the whole reason the hook
 * subscribes through the store's selector instead of reading the state and
 * comparing objects.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Reducer } from "../src/core/store";
import { useDispatch, useStore } from "../src/react";
import { createRendererStore, type RendererStore } from "../src/renderer";
import { fakeMain } from "./fake-main";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type State = { count: number; user: string };
type Action = { type: "inc" } | { type: "set-user"; user: string };

const reducer: Reducer<State, Action> = (state, action) =>
  action.type === "inc" ? { ...state, count: state.count + 1 } : { ...state, user: action.user };

/** Module level, so its identity never changes between renders. */
const selectCount = (state: State): number => state.count;
const selectUser = (state: State): string => state.user;

let renders = { count: 0, user: 0 };

function Count({ store }: { store: RendererStore<State, Action> }): React.JSX.Element {
  const count = useStore(store, selectCount);
  const dispatch = useDispatch(store);
  renders.count += 1;
  return (
    <button id="inc" onClick={() => void dispatch({ type: "inc" })}>
      {count}
    </button>
  );
}

function User({ store }: { store: RendererStore<State, Action> }): React.JSX.Element {
  const user = useStore(store, selectUser);
  renders.user += 1;
  return <p id="user">{user}</p>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  renders = { count: 0, user: 0 };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(store: RendererStore<State, Action>): void {
  act(() => {
    root.render(
      <>
        <Count store={store} />
        <User store={store} />
      </>,
    );
  });
}

describe("the React bindings", () => {
  it("reads the state on the first render, with nothing to await", () => {
    const main = fakeMain(reducer, { count: 7, user: "ada" });
    const store = createRendererStore(reducer, { bridge: main.bridge });
    mount(store);
    expect(container.querySelector("#inc")?.textContent).toBe("7");
    expect(container.querySelector("#user")?.textContent).toBe("ada");
    expect(renders).toEqual({ count: 1, user: 1 });
  });

  it("re-renders on a change, optimistically, before main has answered", async () => {
    const main = fakeMain(reducer, { count: 0, user: "ada" });
    const store = createRendererStore(reducer, { bridge: main.bridge });
    mount(store);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#inc")?.click();
    });
    expect(container.querySelector("#inc")?.textContent).toBe("1");
    expect(main.state.count).toBe(0);
    expect(main.inFlight).toBe(1);
  });

  it("leaves a component alone when a slice it does not watch changes", async () => {
    const main = fakeMain(reducer, { count: 0, user: "ada" });
    const store = createRendererStore(reducer, { bridge: main.bridge });
    mount(store);
    const before = renders.count;
    await act(async () => {
      main.change({ type: "set-user", user: "grace" });
    });
    expect(container.querySelector("#user")?.textContent).toBe("grace");
    expect(renders.user).toBe(2);
    // The point of the whole file.
    expect(renders.count).toBe(before);
  });

  it("rolls the render back when main refuses", async () => {
    const main = fakeMain(reducer, { count: 0, user: "ada" });
    const store = createRendererStore(reducer, { bridge: main.bridge });
    mount(store);
    main.rejectNext("not allowed");
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#inc")?.click();
    });
    expect(container.querySelector("#inc")?.textContent).toBe("1");
    await act(async () => {
      main.answer();
    });
    expect(container.querySelector("#inc")?.textContent).toBe("0");
  });
});
