import { digest, fail, gitText, runGit, freeze } from './git-run.mjs';
import { inspectDelivery as inspectState, repositoryContext, readStatus } from './git-state.mjs';
import { stageSelectedPaths, commitIndex } from './git-commit.mjs';
import { withDeliveryLock, readJournal, writeJournal, listJournals, newDeliveryId, journalDigest } from './journal.mjs';
import { validateInput, frozenInput, head, tree, assertCheckout, confirmation, changedPaths, recoverCommit, commitIntentRoot, resolutionBinding, externalMessage } from './delivery-protocol.mjs';
import { assertRemote, fetchRemote, verifyRemoteContains, finalTip } from './delivery-remote.mjs';

import { syncStep, needsSync, operationContext, conflictContext, assertOperationScope } from './delivery-sync.mjs';

/** Fault injection is API-only (never CLI/env), for temporary-repository tests. */
function fault(options, point) { options?.fault?.(point); }
function save(common, j) { return writeJournal(common, j); }
function inspectFrozen(cwd, input) {
  const frozen = frozenInput(cwd, input); const p = inspectState(cwd, frozen);
  return freeze({ ...p, coreDigest: p.digest, messages: { source: { file: frozen.messageFile, digest: frozen.messageDigest, text: frozen.message }, target: { file: frozen.targetMessageFile, digest: frozen.targetMessageDigest, text: frozen.targetMessage } }, digest: digest({ preview: p, frozen }) });
}
export function inspectDelivery(cwd, input = {}) {
  validateInput('inspect', input);
  // A first read-only inspection does not require a drafted message. Prepare always does.
  if (!input.messageFile && !input.targetMessageFile) return inspectState(cwd, input);
  return inspectFrozen(cwd, input);
}
function ensureFrozenHeads(j) {
  assertCheckout(j, false);
  const expectedSource = j.mode === 'primary' ? (j.finalTargetOid ?? j.sourceResult?.resultOid ?? j.sourceOid) : (j.sourceResult?.resultOid ?? j.sourceOid);
  if (head(j.sourceRoot) !== expectedSource) fail('source_changed', '冻结源 OID 已变化，不得重复 squash 新历史');
  assertCheckout(j, true); if (head(j.targetRoot) !== finalTip(j)) fail('target_changed', '冻结目标 OID 已变化');
}
function recordSource(j, result) {
  j.sourceResult = result;
  if (j.version === 2 && j.mode === 'primary') { j.targetResult = result; j.finalTargetOid = result.resultOid; }
  j.phase = j.mode === 'primary' ? (j.version === 2 && j.input.push && j.preview.resolution.remote ? 'target_committed' : 'complete') : 'source_committed';
}
function commitAttempt(common, j) {
  const attempts = j.intent.commitAttempts ?? 0;
  if (attempts >= 3) fail('commit_attempts_exhausted', '提交最多 3 次，保留意图和索引现场停止');
  j.intent.commitAttempts = attempts + 1;
  return save(common, j);
}
function baseline(j) { return j.integrationBaseOid ?? j.targetOid; }

function checkMessage(j, target = false) {
  const m = externalMessage(target ? j.targetRoot : j.sourceRoot, target ? j.input.targetMessageFile : j.input.messageFile);
  if (m.digest !== (target ? j.input.targetMessageDigest : j.input.messageDigest)) fail('message_changed', '已确认消息文件变化');
  return m;
}
function view(j) {
  const syncRequired = j.version === 2 && (j.phase === 'sync_pending' || (['source_committed', 'target_committed'].includes(j.phase) && needsSync(j)));
  return freeze({ ...j, confirmation: journalDigest(j), conflictResolution: j.preview.config.conflictResolution ?? 'agent', requiresSync: syncRequired, requiresFinalConfirmation: Boolean(j.sync?.review), next: syncRequired ? 'sync' : j.phase === 'prepared' ? 'commit' : j.phase === 'source_committed' || j.phase === 'squash_pending' ? 'integrate' : j.phase === 'target_committed' || j.phase === 'push_pending' ? 'push' : 'none' });
}
export function prepareDelivery(cwd, input, options = {}) {
  validateInput('prepare', input); const c = repositoryContext(cwd);
  return withDeliveryLock(c.commonDir, () => {
    const p = inspectFrozen(cwd, input);
    if (p.digest !== input.expectedPreviewDigest) fail('preview_changed', '预览已变化，不能准备');
    confirmation(input, p.digest);
    if (!p.state.ready) fail('scope_blocked', '本地预览尚有阻断', { blockers: p.state.blockers });
    const f = frozenInput(cwd, input);
    // Resolve defaults once. Later config changes cannot silently choose a different destination.
    f.targetBranch = p.resolution.targetBranch; if (p.resolution.remote) f.remote = p.resolution.remote; else delete f.remote; f.remoteBranch = p.resolution.remoteBranch; f.push = p.scope.push;
    const prior = listJournals(c.commonDir).filter(j => j.sourceRoot === c.root || j.sourceBranch === c.branch);
    if (prior.some(j => !['complete', 'pushed'].includes(j.phase))) fail('active_delivery', '此源已有未完成交付，请 status/resume');
    if (p.context.mode === 'worktree' && prior.some(j => j.targetResult)) fail('source_already_delivered', '此源已有 squash 交付；新增提交不能盲重 squash，请创建新任务分支');
    let j = { version: 2, id: newDeliveryId(), revision: 0, phase: 'prepared', identity: c.identity, sourceRoot: c.root, targetRoot: p.context.targetRoot,
      sourceBranch: c.branch, targetBranch: p.resolution.targetBranch, mode: p.context.mode, input: f, preview: p, sourceOid: c.sourceOid, targetOid: p.context.targetOid,
      sync: null, syncAttempts: 0, pushAttempts: 0, syncHistory: [], integrationBaseOid: null, finalTargetOid: null, operationContext: null, sourceResult: null, targetResult: null, intent: null, remoteState: null, squash: null, evidence: null, createdAt: new Date().toISOString() };
    // Persist all scope, URL and message bindings before authorized network writes.
    j = save(c.commonDir, j);
    if (f.push && p.resolution.remote) {
      if (input.allowFetch !== true) fail('fetch_authorization_required', '需明确 fetch 授权；收据已保存，可用 resume 授权继续', { id: j.id });
      j.intent = { kind: 'fetch' }; j = save(c.commonDir, j); fault(options, 'before_fetch');
      j.remoteState = fetchRemote(j); j.intent = null; j = save(c.commonDir, j);
    }
    return view(j);
  });
}
function rejectLegacy(j) { if (j.version === 1) fail('new_authorization_required', '旧 v1 收据需新授权，不修改原收据或扩展同步权限'); }
function load(cwd, id) {
  const c = repositoryContext(cwd); const j = readJournal(c.commonDir, id);
  if (j.identity !== c.identity || c.root !== j.sourceRoot) fail('identity_changed', '必须从已绑定源工作区恢复');
  return { common: c.commonDir, j };
}
export function statusDelivery(cwd, id, input = {}) {
  validateInput('status', input); const { j } = load(cwd, id);
  // Pure reads: no lock creation, write-tree, network or recovery mutation.
  const current = { sourceOid: head(j.sourceRoot), targetOid: head(j.targetRoot), sourceStatus: readStatus(j.sourceRoot), targetStatus: readStatus(j.targetRoot) };
  return { ...view(j), current };
}
function commitStep(common, j, input, options) {
  if (j.phase !== 'prepared') return view(j);
  confirmation(input, journalDigest(j));
  if (j.intent) fail('pending_intent', '已有未完成意图，先显式 resume 核验');
  if (j.input.push && j.preview.resolution.remote && !j.remoteState) fail('fetch_required', '须先 resume 授权 fetch 远端历史');
  checkMessage(j); checkMessage(j, true);
  if (head(j.sourceRoot) !== j.sourceOid || head(j.targetRoot) !== j.targetOid) fail('head_changed', '准备后源或目标 OID 变化');
  if (j.mode === 'worktree') assertCheckout(j, true);
  const p = inspectState(j.sourceRoot, j.input);
  // Fetch may change only tracking history; compare frozen local state and scope independently.
  if (!p.state.ready || digest(p.state) !== digest(j.preview.state) || p.context.sourceOid !== j.sourceOid || digest(p.scope.paths) !== digest(j.preview.scope.paths) || digest(p.config) !== digest(j.preview.config) || digest(resolutionBinding(p.resolution)) !== digest(resolutionBinding(j.preview.resolution))) fail('scope_changed', '准备后索引、工作区、配置、目的地或范围变化');
  if (!p.state.source.status.length) {
    if (j.mode === 'primary' || !p.scope.branchCommits.length) fail('empty_delivery', '没有新的源变更或分支提交');
    j.sourceResult = { resultOid: j.sourceOid, tree: gitText(j.sourceRoot, ['rev-parse', 'HEAD^{tree}']), existing: true };
    j.phase = 'source_committed'; return view(save(common, j));
  }
  j.intent = { kind: 'stage', parent: j.sourceOid, paths: j.input.paths, previewDigest: p.digest }; j = save(common, j);
  stageSelectedPaths(j.sourceRoot, { input: j.input, expectedPreviewDigest: p.digest }); fault(options, 'after_stage');
  const t = tree(j.sourceRoot);
  j.intent = { kind: 'source_commit', root: j.sourceRoot, parent: j.sourceOid, tree: t, paths: j.input.paths, message: j.input.message, messageDigest: j.input.messageDigest };
  j = commitAttempt(common, j); fault(options, 'before_source_commit');
  const result = commitIndex(j.sourceRoot, { expectedParentOid: j.sourceOid, expectedTree: t, messageFile: j.input.messageFile, expectedMessageDigest: j.input.messageDigest, paths: j.input.paths, expectedBranch: j.sourceBranch });
  fault(options, 'after_source_commit');
  recordSource(j, result); j.intent = null;
  return view(save(common, j));
}
export function commitDelivery(cwd, id, input = {}, options = {}) {
  validateInput('commit', input); const { common } = load(cwd, id);
  return withDeliveryLock(common, () => { const j = load(cwd, id).j; rejectLegacy(j); return commitStep(common, j, input, options); });
}
function recordSquashConflicts(common, j) {
  if (!j.operationContext) return j;
  const context = conflictContext(j, j.operationContext);
  if (context.conflictPaths.length) {
    if (context.resolutionAttempts >= 3) fail('resolution_attempts_exhausted', '冲突解决最多 3 次，保留现场停止', { context });
    context.resolutionAttempts++;
  }
  j.operationContext = context;
  return save(common, j);
}
function squashPreview(j) {
  assertCheckout(j, false);
  if (head(j.sourceRoot) !== j.sourceResult.resultOid || head(j.targetRoot) !== baseline(j)) fail('head_changed', 'squash 冻结的源或目标已变化');
  assertCheckout(j, true, false);
  const status = readStatus(j.targetRoot);
  if (j.operationContext) {
    if (j.operationContext.ours !== baseline(j) || j.operationContext.theirs !== j.sourceResult.resultOid) fail('squash_identity_changed', 'squash 上下文已变化');
    if (status.some(e => /U|AA|DD/.test(e.status))) fail('squash_conflict', 'squash 冲突保留现场；由 Pi/manual 解决并暂存后 resume', { context: conflictContext(j, j.operationContext) });
    assertOperationScope(j, j.operationContext);
  } else if (status.some(e => /U|AA|DD/.test(e.status))) fail('squash_conflict', 'squash 冲突保留现场');
  if (status.some(e => e.status === '??' || e.status[1] !== ' ')) fail('unstaged_resolution', '最终 squash 必须无未暂存/未跟踪内容');
  const t = tree(j.targetRoot); const paths = changedPaths(j.targetRoot);
  if (!paths.length || t === gitText(j.targetRoot, ['rev-parse', 'HEAD^{tree}'])) fail('empty_squash', 'squash 无实际差异，不创建空提交、不声称已交付');
  const diff = runGit(j.targetRoot, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--']).stdout;
  const scope = { parent: baseline(j), sourceOid: j.sourceResult.resultOid, tree: t, paths, diff };
  return { ...scope, digest: digest(scope) };
}
function integrateStep(common, j, input, options) {
  if (j.mode !== 'worktree') fail('worktree_required', '只有 linked 任务可 squash');
  if (j.phase !== 'source_committed' && j.phase !== 'squash_pending') return view(j);
  confirmation(input, journalDigest(j)); checkMessage(j, true);
  if (j.intent) fail('pending_intent', '已有未完成意图，先显式 resume');
  if (j.phase === 'source_committed') {
    ensureFrozenHeads(j);
    if (needsSync(j)) return { ...view(j), requiresSync: true };
    if (j.version === 2) j.operationContext = operationContext(j, 'squash', baseline(j), j.sourceResult.resultOid);
    j.phase = 'squash_pending'; j.intent = { kind: 'squash', source: j.sourceResult.resultOid, parent: baseline(j) }; j = save(common, j); fault(options, 'before_squash');
    const r = runGit(j.targetRoot, ['-c', 'merge.autoStash=false', '-c', 'rerere.enabled=false', '-c', `branch.${j.targetBranch}.mergeOptions=`, 'merge', '--squash', '--no-commit', j.sourceResult.resultOid], { readOnly: false, allowFailure: true });
    fault(options, 'after_squash');
    // Never infer MERGE_HEAD or issue merge --abort: squash conflict state is deliberately preserved.
    if (r.status !== 0) {
      if (j.operationContext) j = recordSquashConflicts(common, j);
      fail('squash_conflict', 'squash 未完成，保留工作区与索引；显式解决后 resume', { id: j.id, context: j.operationContext });
    }
    j.squash = squashPreview(j); j.intent = null; j = save(common, j);
    return { ...view(j), requiresFinalConfirmation: true, verification: 'Run relevant checks against this final tree, then supply user-confirmed evidence.' };
  }
  if (j.operationContext && readStatus(j.targetRoot).some(e => /U|AA|DD/.test(e.status))) j = recordSquashConflicts(common, j);
  const s = squashPreview(j);
  if (!j.squash || j.squash.digest !== s.digest) {
    if (j.squash && j.operationContext) {
      if (j.operationContext.resolutionAttempts >= 3) fail('resolution_attempts_exhausted', '最终树修改最多 3 次，保留现场停止');
      j.operationContext.resolutionAttempts++;
    }
    j.squash = s; j.evidence = null; return { ...view(save(common, j)), requiresFinalConfirmation: true };
  }
  const e = input.evidence;
  if (!e || e.tree !== s.tree) fail('evidence_required', '最终树需相关验证及新确认，不能复用源树测试');
  const required = j.preview.config.checks ?? [];
  if (required.some(command => !e.checks.some(c => c.command === command))) fail('checks_missing', '缺少配置指定的最终树验证证据');
  j.evidence = e;
  j.intent = { kind: 'target_commit', root: j.targetRoot, parent: baseline(j), tree: s.tree, paths: s.paths, message: j.input.targetMessage, messageDigest: j.input.targetMessageDigest };
  j = commitAttempt(common, j); fault(options, 'before_target_commit');
  const result = commitIndex(j.targetRoot, { expectedParentOid: baseline(j), expectedTree: s.tree, messageFile: j.input.targetMessageFile, expectedMessageDigest: j.input.targetMessageDigest, paths: s.paths, expectedBranch: j.targetBranch });
  fault(options, 'after_target_commit');
  j.targetResult = result; if (j.version === 2) j.finalTargetOid = result.resultOid; j.intent = null; j.phase = j.input.push && j.preview.resolution.remote ? 'target_committed' : 'complete';
  return view(save(common, j));
}
export function integrateDelivery(cwd, id, input = {}, options = {}) {
  validateInput('integrate', input); const { common } = load(cwd, id);
  return withDeliveryLock(common, () => { const j = load(cwd, id).j; rejectLegacy(j); return integrateStep(common, j, input, options); });
}
function pushStep(common, j, input, options) {
  if (!['target_committed', 'push_pending'].includes(j.phase)) return view(j);
  confirmation(input, journalDigest(j));
  if (input.allowFetch !== true) fail('fetch_authorization_required', '推送前及不确定响应恢复需要明确 fetch 授权');
  ensureFrozenHeads(j); assertRemote(j);
  if (j.intent?.kind === 'push') {
    if (verifyRemoteContains(j)) { j.phase = 'pushed'; j.intent = null; return view(save(common, j)); }
    // Prove current remote state and require a NEW confirmation before any retry.
    if (j.version === 2 && j.pushAttempts >= 3) fail('push_attempts_exhausted', '推送最多 3 次，保留现场停止');
    j.remoteState = fetchRemote(j); j.intent = null; j.phase = 'target_committed'; return { ...view(save(common, j)), requiresPushConfirmation: true };
  }
  if (j.intent) fail('pending_intent', '已有未完成意图，先 resume');
  // This fetch is a Git write too: durable intent precedes it, even during push preflight.
  j.intent = { kind: 'push_fetch' }; j = save(common, j);
  const remote = fetchRemote(j); j.intent = null;
  if (needsSync({ ...j, remoteState: remote }) || digest(remote) !== digest(j.remoteState)) {
    j.remoteState = remote; return { ...view(save(common, j)), requiresPushConfirmation: true };
  }
  j = save(common, j);
  const r = assertRemote(j); ensureFrozenHeads(j);
  if (j.version === 2) {
    if (j.pushAttempts >= 3) fail('push_attempts_exhausted', '推送最多 3 次，保留现场停止');
    j.pushAttempts++;
  }
  j.phase = 'push_pending'; j.intent = { kind: 'push', oid: finalTip(j), remote: r.remote, refspec: `${finalTip(j)}:refs/heads/${r.remoteBranch}`, remoteDigest: r.remoteUrlDigest, remoteOid: remote.oid };
  j = save(common, j); fault(options, 'before_push');
  const pushed = runGit(j.sourceRoot, ['-c', 'push.followTags=false', '-c', `remote.${r.remote}.mirror=false`, 'push', '--porcelain', '--no-recurse-submodules', r.remote, j.intent.refspec], { readOnly: false, allowFailure: true });
  fault(options, 'after_push'); ensureFrozenHeads(j);
  if (!verifyRemoteContains(j)) fail('push_unverified', '推送未被远端包含关系证明；保留 push intent，请显式 resume', { status: pushed.status });
  j.phase = 'pushed'; j.intent = null; return view(save(common, j));
}
export function pushDelivery(cwd, id, input = {}, options = {}) {
  validateInput('push', input); const { common } = load(cwd, id);
  return withDeliveryLock(common, () => { const j = load(cwd, id).j; rejectLegacy(j); return pushStep(common, j, input, options); });
}
export function resumeDelivery(cwd, id, input = {}, options = {}) {
  validateInput('resume', input); const { common } = load(cwd, id);
  return withDeliveryLock(common, () => {
    let j = load(cwd, id).j; rejectLegacy(j);
    confirmation(input, journalDigest(j));
    if (j.phase === 'sync_pending') return view(syncStep(common, j, input, options));
    if (j.intent?.kind === 'source_commit' || j.intent?.kind === 'target_commit') {
      const intent = j.intent; const root = commitIntentRoot(j, intent); let result = recoverCommit(j, intent);
      if (!result) {
        // No commit exists: an explicit resume may execute ONLY the already durable intent,
        // after rechecking its exact parent/tree/message/allowed files and frozen other checkout.
        const target = intent.kind === 'target_commit'; checkMessage(j, target);
        assertCheckout(j, target, false); if (j.mode === 'worktree') assertCheckout(j, !target);
        if (tree(root) !== intent.tree || readStatus(root).some(e => e.status === '??' || e.status[1] !== ' ' || !intent.paths.includes(e.path))) fail('commit_recovery_ambiguous', '原提交意图的索引或工作区变化，禁止重试');
        if (target && head(j.sourceRoot) !== j.sourceResult.resultOid) fail('source_changed', '源已变化，禁止目标提交重试');
        if (!target && j.mode === 'worktree' && head(j.targetRoot) !== baseline(j)) fail('target_changed', '目标已变化，禁止源提交重试');
        j = commitAttempt(common, j);
        result = commitIndex(root, { expectedParentOid: intent.parent, expectedTree: intent.tree, messageFile: target ? j.input.targetMessageFile : j.input.messageFile, expectedMessageDigest: intent.messageDigest, paths: intent.paths, expectedBranch: target ? j.targetBranch : j.sourceBranch });
        fault(options, target ? 'after_target_commit' : 'after_source_commit');
      }
      if (intent.kind === 'source_commit') { recordSource(j, result); }
      else { j.targetResult = result; if (j.version === 2) j.finalTargetOid = result.resultOid; j.phase = j.input.push && j.preview.resolution.remote ? 'target_committed' : 'complete'; }
      j.intent = null; return view(save(common, j));
    }
    if (j.intent?.kind === 'stage') {
      checkMessage(j); if (j.mode === 'worktree') assertCheckout(j, true);
      const p = inspectState(j.sourceRoot, j.input);
      if (!p.state.ready || head(j.sourceRoot) !== j.sourceOid || head(j.targetRoot) !== j.targetOid || digest(p.state.source.contents) !== digest(j.preview.state.source.contents) || digest(p.config) !== digest(j.preview.config) || digest(resolutionBinding(p.resolution)) !== digest(resolutionBinding(j.preview.resolution))) fail('stage_recovery_required', '暂存中断且冻结内容变化，保留现场，不自动扩大范围');
      stageSelectedPaths(j.sourceRoot, { input: j.input, expectedPreviewDigest: p.digest });
      const t = tree(j.sourceRoot);
      j.intent = { kind: 'source_commit', root: j.sourceRoot, parent: j.sourceOid, tree: t, paths: j.input.paths, message: j.input.message, messageDigest: j.input.messageDigest };
      return { ...view(save(common, j)), requiresCommitConfirmation: true };
    }
    if (j.intent?.kind === 'squash' || j.phase === 'squash_pending') {
      checkMessage(j, true);
      if (j.intent?.kind === 'squash' && readStatus(j.targetRoot).length === 0) {
        // Intent may have reached disk before merge started. Retry only that exact frozen operation.
        ensureFrozenHeads(j);
        const r = runGit(j.targetRoot, ['-c', 'merge.autoStash=false', '-c', 'rerere.enabled=false', '-c', `branch.${j.targetBranch}.mergeOptions=`, 'merge', '--squash', '--no-commit', j.sourceResult.resultOid], { readOnly: false, allowFailure: true });
        if (r.status !== 0) fail('squash_conflict', 'squash 未完成，保留现场');
      }
      if (j.operationContext && readStatus(j.targetRoot).some(e => /U|AA|DD/.test(e.status))) j = recordSquashConflicts(common, j);
      const preview = squashPreview(j);
      if (j.squash && j.squash.digest !== preview.digest && j.operationContext) {
        if (j.operationContext.resolutionAttempts >= 3) fail('resolution_attempts_exhausted', '最终树修改最多 3 次，保留现场停止');
        j.operationContext.resolutionAttempts++;
      }
      j.squash = preview; j.intent = null; j.evidence = null; j = save(common, j);
      return { ...view(j), requiresFinalConfirmation: true };
    }
    if (j.intent?.kind === 'push') return pushStep(common, j, input, options);
    if (j.intent?.kind === 'push_fetch') {
      if (input.allowFetch !== true) fail('fetch_authorization_required', '需要明确 fetch 授权');
      ensureFrozenHeads(j); j.remoteState = fetchRemote(j); j.intent = null;
      return { ...view(save(common, j)), requiresPushConfirmation: true };
    }
    if (j.intent?.kind === 'fetch' || (j.phase === 'prepared' && j.input.push && j.preview.resolution.remote && !j.remoteState)) {
      if (input.allowFetch !== true) fail('fetch_authorization_required', '需要明确 fetch 授权');
      if (!j.intent) { j.intent = { kind: 'fetch' }; j = save(common, j); }
      j.remoteState = fetchRemote(j); j.intent = null; return view(save(common, j));
    }
    // Resume never silently starts the next destructive step. Each step has a separate explicit command.
    fault(options, 'resume_noop'); return view(j);
  });
}

/** Explicit operation: uses the same receipt confirmation contract as push. */
export function syncDelivery(cwd, id, input = {}, options = {}) {
  validateInput('sync', input); const { common } = load(cwd, id);
  return withDeliveryLock(common, () => {
    const j = load(cwd, id).j; confirmation(input, journalDigest(j));
    return view(syncStep(common, j, input, options));
  });
}
