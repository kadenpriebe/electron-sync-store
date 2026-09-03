import { createRendererStore } from "../src/renderer";
import type { DemoBridge } from "./preload";
import type { AppAction, AppState } from "./state";

declare global {
  interface Window {
    __demo: DemoBridge;
  }
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element: #${id}`);
  return node as T;
}

function start(): void {
  const store = createRendererStore<AppState, AppAction>({
    // Report the mirror's decisions to the inspector. An app would omit this.
    trace: (event) => window.__demo.trace(event),
  });

  const count = el("count");
  const user = el("user");
  const userInput = el<HTMLInputElement>("user-input");

  function render(state: AppState): void {
    count.textContent = String(state.count);
    user.textContent = state.user;
    if (document.activeElement !== userInput) {
      userInput.value = state.user;
    }
  }

  // A synchronous read on the first line of app code. No await anywhere in
  // this file, and no loading state — the value is already local.
  render(store.getState());

  store.subscribe(render);

  el("inc").addEventListener("click", () => {
    store.dispatch({ type: "increment" });
  });

  el("dec").addEventListener("click", () => {
    store.dispatch({ type: "decrement" });
  });

  userInput.addEventListener("input", () => {
    store.dispatch({ type: "set-user", user: userInput.value });
  });
}

start();
