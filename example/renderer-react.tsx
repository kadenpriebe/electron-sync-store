/**
 * The same page as example/renderer.ts, written in React.
 *
 * Window A runs the vanilla version and window B runs this one, side by side
 * on one screen, against the same library and the same preload. Nothing in
 * src/ knows the difference; the React layer is two hooks over the mirror.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useDispatch, useStore } from "../src/react";
import { createRendererStore } from "../src/renderer";
import type { DemoBridge } from "./preload";
import { reducer, type AppAction, type AppState } from "./state";

declare global {
  interface Window {
    __demo: DemoBridge;
  }
}

// Created at module scope, before React mounts, and populated already: the
// preload fetched the state before this file ran. There is no loading state to
// render because there is no moment at which the state is unknown.
const store = createRendererStore<AppState, AppAction>(reducer, {
  trace: (event) => window.__demo.trace(event),
});

/** Module level, so their identity never changes between renders. */
const selectCount = (state: AppState): number => state.count;
const selectUser = (state: AppState): string => state.user;

/**
 * How many times this component has been re-rendered since it first appeared,
 * to match the counter on the vanilla page. Mutating a ref during a render is
 * a demo liberty; a real page would not be counting its own renders.
 */
function useRedraws(): number {
  const redraws = useRef(-1);
  redraws.current += 1;
  return redraws.current;
}

/**
 * Both leaves take no props and are memoised, so nothing their parent does can
 * re-render them. The only thing that can is their own slice of the state
 * changing — which is what the counters underneath them are showing.
 */
const Count = memo(function Count(): React.JSX.Element {
  const count = useStore(store, selectCount);
  const redraws = useRedraws();
  return (
    <>
      <p className="count" id="count">
        {count}
      </p>
      <p className="draws">
        count redraws <b id="count-draws">{redraws}</b>
      </p>
    </>
  );
});

const Name = memo(function Name(): React.JSX.Element {
  const user = useStore(store, selectUser);
  const dispatch = useDispatch(store);
  const redraws = useRedraws();
  return (
    <>
      <label htmlFor="user-input">name</label>
      {/* Controlled with no lag: the guess is applied before this returns. */}
      <input
        id="user-input"
        type="text"
        value={user}
        onChange={(event) => void dispatch({ type: "set-user", user: event.target.value })}
      />
      <p>
        the name is <strong id="user">{user}</strong>
      </p>
      <p className="draws">
        name redraws <b id="name-draws">{redraws}</b>
      </p>
    </>
  );
});

function App(): React.JSX.Element {
  const dispatch = useDispatch(store);
  const [note, setNote] = useState("");
  const [waiting, setWaiting] = useState(0);

  const send = useCallback(
    (action: AppAction) => {
      setWaiting((n) => n + 1);
      setNote("");
      void dispatch(action).then((result) => {
        setWaiting((n) => n - 1);
        if (result.status === "rejected") setNote(`rolled back: ${result.reason}`);
      });
    },
    [dispatch],
  );

  // The inspector's load button, relayed through main. Registered once.
  useEffect(() => {
    window.__demo.onRush((each) => {
      for (let i = 0; i < each; i++) send({ type: "increment" });
    });
  }, [send]);

  // The class goes on the wrapper, not on the number: re-rendering App while
  // an answer is outstanding must not re-render the memoised leaves.
  return (
    <div className={waiting > 0 ? "unconfirmed" : ""}>
      <h1>electron-sync-store · React</h1>
      <Count />
      <button id="dec" onClick={() => send({ type: "decrement" })}>
        −
      </button>
      <button id="inc" onClick={() => send({ type: "increment" })}>
        +
      </button>
      <p className="note" id="note">
        {note}
      </p>
      <Name />
    </div>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("missing element: #root");
createRoot(container).render(<App />);
