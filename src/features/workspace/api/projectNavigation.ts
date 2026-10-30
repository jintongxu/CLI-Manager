import { flushSync } from "react-dom";
import { showProjectSpace } from "./primarySpaceState";

/** Route only an explicit user action; callers must validate targets first. */
export function runProjectNavigation(action: () => void) {
  flushSync(showProjectSpace);
  action();
}
