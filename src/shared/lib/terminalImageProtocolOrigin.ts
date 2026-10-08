import type { Terminal } from "@xterm/xterm";
import type { ImageAddon } from "@xterm/addon-image";
import { canEmitTerminalProtocol, captureTerminalProtocolPermission } from "./terminalHistoricalParser";

/** Pinned addon-image 0.10.0-beta.288: Kitty emits replies in promise callbacks
 * BEFORE InputHandler.parse resumes. Bind that specific protocol producer to its
 * handler invocation, never CoreService or user input to the pending promise.
 * The parser serializes end invocations, including its async continuations.
 */
interface KittyResponder {
  end(success: boolean): boolean | Promise<boolean>;
  _sendResponse(id: number, message: string, quiet: number, placementId?: number): void;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
export function installTerminalImageProtocolOrigin(terminal: Terminal, addon: ImageAddon): { dispose(): void } {
  const candidate: unknown = addon;
  if (!record(candidate) || !(candidate._handlers instanceof Map)) {
    throw new Error("Incompatible @xterm/addon-image 0.10.0-beta.288 origin adapter");
  }
  const value: unknown = candidate._handlers.get("kitty");
  if (!record(value) || typeof value.end !== "function" || typeof value._sendResponse !== "function") {
    throw new Error("Incompatible @xterm/addon-image 0.10.0-beta.288 Kitty response adapter");
  }
  const kitty = value as unknown as KittyResponder;
  const end = kitty.end;
  const reply = kitty._sendResponse;
  let invocationPermission = () => true;
  let disposed = false;
  kitty.end = function (success) {
    invocationPermission = captureTerminalProtocolPermission(terminal);
    try {
      const result = end.call(kitty, success);
      if (result instanceof Promise) {
        return result.finally(() => { invocationPermission = () => true; });
      }
      invocationPermission = () => true;
      return result;
    } catch (error) {
      invocationPermission = () => true;
      throw error;
    }
  };
  kitty._sendResponse = function (id, message, quiet, placementId) {
    if (!disposed && invocationPermission() && canEmitTerminalProtocol(terminal)) reply.call(kitty, id, message, quiet, placementId);
  };
  return { dispose() { disposed = true; } };
}
