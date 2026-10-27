import { useXTermController } from "../hooks/useXTermController";
import { XTermView } from "./XTermView";
import type { Props } from "../types/xTermModel";

/**
 * Keep the xterm/parser and PTY output consumer mounted across tab switches.
 * Unmounting a hidden display leaves the process manager without a consumer
 * and forces it to retain every output frame until replay; sustained output
 * therefore grows an unbounded browser queue. The controller releases the
 * WebGL renderer and suppresses layout/TUI work while hidden, while xterm
 * remains authoritative for scrollback and ordered replay.
 */
export function XTermTerminal(props: Props) {
  return <MountedXTermTerminal {...props} />;
}

function MountedXTermTerminal(props: Props) {
  return <XTermView {...useXTermController(props)} />;
}
