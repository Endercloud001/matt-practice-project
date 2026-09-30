import { transferableAbortController } from "node:util";

export function prepareReactDom() {
  // jsdom's signals are not accepted by Node's Request used by React Router.
  Object.assign(globalThis, {
    AbortController: transferableAbortController().constructor,
    AbortSignal: new Request("http://localhost").signal.constructor,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
}
