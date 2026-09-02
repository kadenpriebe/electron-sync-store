/**
 * The example app's own state shape. The library knows nothing about this —
 * it is generic over whatever the host application defines.
 */

export type AppState = {
  count: number;
  user: string;
};

export type AppAction =
  | { type: "increment" }
  | { type: "decrement" }
  | { type: "set-user"; user: string };

export const initialState: AppState = {
  count: 0,
  user: "ada",
};

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "increment":
      return { ...state, count: state.count + 1 };
    case "decrement":
      return { ...state, count: state.count - 1 };
    case "set-user":
      return { ...state, user: action.user };
    default: {
      // If a new action variant is added above and not handled here, this
      // assignment stops compiling. The compiler refuses to let you forget.
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
