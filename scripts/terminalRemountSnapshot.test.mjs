import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync('src/features/terminal/hooks/useXTermController.ts','utf8');
// Wiring checks supplement real xterm/lifecycle/manager/display behavior tests.
test('layout cleanup always owns snapshot, including interrupted initial hydration',()=>{
 assert.match(source,/useLayoutEffect\(\(\) => \(\) => \{[\s\S]*?snapshotBeforeUnmountRef\.current\?\.\(\)/);
 assert.equal(source.match(/snapshotBeforeUnmountRef\.current = snapshotLifecycle\.snapshotBeforeUnmount/g)?.length,1);
 assert.ok(source.indexOf('snapshotBeforeUnmountRef.current = snapshotLifecycle.snapshotBeforeUnmount')<source.indexOf('const initialTerminalOutput ='));
});
test('same-process hydration has no shell cleanup; authoritative replay bypasses old images',()=>{
 assert.match(source,/const coldHistory = !previousDisplay && shouldResetTerminalSnapshotInputModes\(sessionId\)/);
 assert.match(source,/!terminalProcessManager\.canContinueSnapshot\(sessionId, sessionSnapshot\?\.initialTerminalSequence\)/);
 assert.match(source,/const initialTerminalOutput = authoritativeReplay \? undefined : sessionSnapshot\?\.initialTerminalOutput/);
 assert.match(source,/const restoredState = coldHistory[\s\S]*?: restoredOutput;\s*writeTerminalOutput\(terminal, restoredState, "history"/);
 assert.match(source,/if \(!hasSnapshot \|\| !coldHistory\)/);
 assert.match(source,/terminalProcessManager\.attach\(sessionId, true\)/);
});
test('subscription follows parser restore barrier with no speculative timer; generation scopes keyboard and async paste',()=>{
 assert.match(source,/void initialDisplayReady\.then\(\(\) => \{\s*if \(terminalRef\.current === terminal\) attachOutput\(\)/);
 assert.doesNotMatch(source,/attachOutputTimer/);
 assert.match(source,/terminal\.attachCustomKeyEventHandler\(\(e\) => \{\s*if \(!canAcceptTerminalInput\(terminal\)\)/);
 assert.match(source,/const permission = captureTerminalInputPermission\(terminal\)/);
 assert.match(source,/if \(!terminal \|\| !canAcceptTerminalInput\(terminal\)\) return;/);
});
test('pending startup executes after authoritative replay through a session-owned claim, never image hydration',()=>{
 assert.doesNotMatch(source,/if \(authoritativeReplay \|\| !sessionSnapshot\?\.deferStartup/);
 assert.match(source,/terminalProcessManager\.writeDeferredStartup\([\s\S]*?\(\) => terminalRef\.current === terminal/);
 assert.match(source,/const replayCompleted = await output\.completeReplay\(attach\.replay\);[\s\S]*?if \(!replayCompleted \|\| !output\.isCurrent\(\)[\s\S]*?if \(attach\.attached\) writeDeferredStartup\(\)/);
 assert.doesNotMatch(source,/writeDeferredStartup\(\);\s*finishInitialDisplayRestore/);
});
