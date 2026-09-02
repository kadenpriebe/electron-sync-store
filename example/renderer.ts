import { createRendererStore } from "../src/renderer";
import type { AppAction, AppState } from "./state";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element: #${id}`);
  return node as T;
}

async function start(): Promise<void> {
  const store = await createRendererStore<AppState, AppAction>();

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

  // A synchronous read. No await, no IPC, no loading state.
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

void start();
