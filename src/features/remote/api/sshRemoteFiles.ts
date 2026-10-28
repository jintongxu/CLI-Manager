import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Project, ProjectFileContentMatch, ProjectFileEntry, ProjectFilePreviewKind, TerminalSession } from "../../../shared/types/index";
import { buildSshAgentHostLaunch, buildSshDirectHostLaunch, buildSshDirectProjectLaunch, type SshAgentProjectLaunch } from "./sshAgentHistory";
import { useBackgroundOperationStore } from "../../terminal/api/backgroundOperationStore";
import type { TranslationKey } from "../../../shared/i18n/index";

interface RemoteFileEntry {
  name: string;
  relativePath: string;
  kind: "file" | "directory" | string;
  sizeBytes: number;
  modifiedMs?: number | null;
}

export interface SshRemoteOrphanPart {
  remotePath: string;
  partPath: string;
  localPath: string;
  fileName: string;
  sizeBytes: number;
  uploadedBytes: number;
  transferId: string;
}

interface RemoteFileRead {
  relativePath: string;
  kind: "text" | "image" | string;
  content: string;
  sizeBytes: number;
  modifiedMs?: number | null;
  truncated: boolean;
}

export interface SshRemoteFileContext {
  consumerId: string;
  launch: SshAgentProjectLaunch;
  rootPath: string;
}

export interface SshRemoteFileOperationOptions {
  silent?: boolean;
  onProgress?: (progress: number) => void;
  onProgressDetail?: (detail: { bytesDone: number; bytesTotal: number }) => void;
  cancel?: () => void | Promise<void>;
}

function isSshAuthenticationError(error: unknown): boolean {
  const message = String(error);
  return [
    "ssh_credential_missing",
    "ssh_authentication_failed",
    "ssh_interactive_auth_required",
  ].some((code) => message.includes(code));
}

function buildSshConnectionSpecFromLaunch(launch: SshAgentProjectLaunch) {
  return {
    host: launch.host,
    port: launch.port,
    username: launch.username,
    configAlias: launch.configAlias,
    configFile: launch.configFile,
    authMode: launch.authMode,
    identityFile: launch.identityFile,
    credentialRef: launch.credentialRef,
    jumpTarget: launch.jumpTarget,
    proxyType: launch.proxyType,
    proxyHost: launch.proxyHost,
    proxyPort: launch.proxyPort,
    proxyCommand: launch.proxyCommand,
    connectTimeoutSec: launch.connectTimeoutSec,
    serverAliveIntervalSec: launch.serverAliveIntervalSec,
    serverAliveCountMax: launch.serverAliveCountMax,
  };
}

function nativeSftpPath(context: SshRemoteFileContext, relativePath = ""): string {
  const root = context.rootPath.replace(/\/$/u, "") || "/";
  return relativePath ? `${root}/${relativePath.replace(/^\/+|\/+$/gu, "")}` : root;
}

function toEntry(entry: RemoteFileEntry): ProjectFileEntry {
  return {
    name: entry.name,
    path: entry.relativePath,
    kind: entry.kind === "directory" ? "directory" : "file",
    sizeBytes: entry.sizeBytes,
    modifiedMs: entry.modifiedMs ?? null,
  };
}

async function runFileOperation<T>(
  context: SshRemoteFileContext,
  detailKey: TranslationKey,
  action: () => Promise<T>,
  options?: SshRemoteFileOperationOptions,
): Promise<T> {
  if (options?.silent) return action();

  const id = `remote-files:${context.consumerId}`;
  const retry = () => { void runFileOperation(context, detailKey, action, options).catch(() => undefined); };
  useBackgroundOperationStore.getState().start({
    id,
    kind: "remoteFiles",
    titleKey: "backgroundOperations.remoteFiles.title",
    detailKey,
    contextLabel: context.rootPath,
    progress: options?.onProgress ? 0 : undefined,
    retry,
    cancel: options?.cancel,
    verification: options?.onProgressDetail ? "pending" : undefined,
  });
  try {
    const result = await action();
    options?.onProgress?.(100);
    useBackgroundOperationStore.getState().succeed(id);
    return result;
  } catch (error) {
    useBackgroundOperationStore.getState().fail(id, error);
    throw error;
  }
}

export async function buildSshRemoteFileContext(project: Project): Promise<SshRemoteFileContext> {
  const launch = await buildSshDirectProjectLaunch(project);
  const hostScoped = project.id.startsWith("ssh-host:");
  const rootPath = hostScoped
    ? await invoke<string>("ssh_resolve_home", { spec: buildSshConnectionSpecFromLaunch(launch) })
    : project.remote_path.trim();
  return {
    consumerId: `files:${launch.clientInstanceId}:${launch.hostId}:${project.id}`,
    launch: {
      ...launch,
      remotePath: rootPath,
      bridgeEpoch: crypto.randomUUID(),
    },
    rootPath,
  };
}

export async function buildSshRemoteAttachmentContext(
  hostId: string,
): Promise<SshRemoteFileContext> {
  const launch = await buildSshDirectHostLaunch(hostId, "/");
  return {
    consumerId: `attachment-browser:${launch.clientInstanceId}:${launch.hostId}:${crypto.randomUUID()}`,
    launch,
    rootPath: "",
  };
}

export async function resolveSshRemoteAttachmentRoot(
  context: SshRemoteFileContext,
): Promise<string> {
  const configured = context.launch.attachmentRoot.trim();
  if (!context.launch.agentPath?.trim()) {
    const home = await invoke<string>("ssh_resolve_home", { spec: buildSshConnectionSpecFromLaunch(context.launch) });
    if (!configured || configured === "~") return home;
    if (configured.startsWith("~/")) return `${home.replace(/\/$/u, "")}/${configured.slice(2)}`;
    if (configured.startsWith("/")) return configured;
    throw new Error("ssh_remote_attachment_root_invalid");
  }
  const result = await invoke<{ rootPath?: string }>("ssh_remote_file_attachment_root", {
    consumerId: context.consumerId,
    sshLaunch: context.launch,
    attachmentRoot: configured || null,
  });
  const rootPath = result.rootPath?.trim() ?? "";
  if (!rootPath.startsWith("/")) throw new Error("ssh_remote_attachment_root_invalid");
  return rootPath;
}

export type SshRemoteAttachmentInput =
  | { kind: "data"; fileName: string; dataBase64: string }
  | { kind: "localPath"; path: string };

export async function releaseSshRemoteFileContext(context: SshRemoteFileContext): Promise<void> {
  await invoke("history_remote_close", {
    hostId: context.launch.hostId,
    consumerId: context.consumerId,
  });
}

export async function sshRemoteAttachFiles(
  project: Project,
  sessionId: string,
  inputs: SshRemoteAttachmentInput[],
): Promise<string[]> {
  if (inputs.length === 0) return [];
  const context = await buildSshRemoteFileContext(project);
  return attachFilesWithContext(context, sessionId, inputs);
}

export async function sshRemoteAttachFilesForSession(
  session: Pick<TerminalSession, "id" | "sshHostId" | "remotePath">,
  inputs: SshRemoteAttachmentInput[],
): Promise<string[]> {
  if (inputs.length === 0) return [];
  if (!session.sshHostId?.trim() || !session.remotePath?.trim()) {
    throw new Error("ssh_terminal_context_invalid");
  }
  const launch = await buildSshAgentHostLaunch(session.sshHostId, session.remotePath);
  return attachFilesWithContext({
    consumerId: "",
    launch,
    rootPath: launch.remotePath,
  }, session.id, inputs);
}

export function sshHostAttachmentSessionId(hostId: string): string {
  const safeHostId = hostId.trim().replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 110);
  return `host-${safeHostId || "unknown"}`;
}

export async function sshRemoteAttachFilesForHost(
  hostId: string,
  inputs: SshRemoteAttachmentInput[],
): Promise<string[]> {
  if (inputs.length === 0) return [];
  const launch = await buildSshAgentHostLaunch(hostId, "/");
  return attachFilesWithContext({
    consumerId: "",
    launch,
    rootPath: "/",
  }, sshHostAttachmentSessionId(hostId), inputs);
}

export async function sshRemotePutFilesForHost(
  hostId: string,
  remoteDirectory: string,
  inputs: Array<{ kind: "localPath"; path: string }>,
  options?: SshRemoteFileOperationOptions,
  transferId?: string,
): Promise<string[]> {
  if (inputs.length === 0) return [];
  const launch = await buildSshDirectHostLaunch(hostId, remoteDirectory);
  const context: SshRemoteFileContext = {
    consumerId: `file-put:${transferId ?? crypto.randomUUID()}`,
    launch,
    rootPath: remoteDirectory,
  };
  try {
    const paths: string[] = [];
    for (const input of inputs) {
      paths.push(await sshRemotePutFile({ ...context, rootPath: remoteDirectory }, "", input.path, options));
    }
    return paths;
  } finally {
    await releaseSshRemoteFileContext(context).catch(() => undefined);
  }
}

async function attachFilesWithContext(
  context: SshRemoteFileContext,
  sessionId: string,
  inputs: SshRemoteAttachmentInput[],
): Promise<string[]> {
  context.consumerId = [
    "attachments",
    context.launch.clientInstanceId,
    context.launch.hostId,
    sessionId,
    crypto.randomUUID(),
  ].join(":");
  try {
    const paths: string[] = [];
    for (const input of inputs) {
      const common = {
        consumerId: context.consumerId,
        sshLaunch: context.launch,
        sessionId,
        ...(context.launch.attachmentRoot.trim()
          ? { attachmentRoot: context.launch.attachmentRoot.trim() }
          : {}),
      };
      const path = input.kind === "data"
        ? await invoke<string>("ssh_remote_file_attach_data", {
            ...common,
            fileName: input.fileName,
            dataBase64: input.dataBase64,
          })
        : await invoke<string>("ssh_remote_file_attach_path", {
            ...common,
            localPath: input.path,
          });
      paths.push(path);
    }
    return paths;
  } finally {
    await releaseSshRemoteFileContext(context).catch(() => undefined);
  }
}

export async function sshRemoteListOrphanParts(
  context: SshRemoteFileContext,
  relativeDirectory = "",
  options?: SshRemoteFileOperationOptions,
): Promise<SshRemoteOrphanPart[]> {
  const spec = buildSshConnectionSpecFromLaunch(context.launch);
  const path = nativeSftpPath(context, relativeDirectory);
  try {
    return await runFileOperation(context, "backgroundOperations.remoteFiles.listing", () => invoke<SshRemoteOrphanPart[]>("ssh_sftp_list_orphan_parts", { spec, path }), options);
  } catch {
    return [];
  }
}

export async function sshRemoteListDir(
  context: SshRemoteFileContext,
  relativePath = "",
  options?: SshRemoteFileOperationOptions,
): Promise<ProjectFileEntry[]> {
  const spec = buildSshConnectionSpecFromLaunch(context.launch);
  try {
    const nativeEntries = await invoke<Array<{ name: string; relativePath: string; kind: string; sizeBytes: number; modifiedMs?: number | null }>>("ssh_sftp_list", {
      spec,
      path: nativeSftpPath(context, relativePath),
    });
    return nativeEntries.map((entry) => ({
      name: entry.name,
      path: relativePath ? `${relativePath}/${entry.name}` : entry.name,
      kind: entry.kind === "directory" ? "directory" : "file",
      sizeBytes: entry.sizeBytes,
      modifiedMs: entry.modifiedMs ?? null,
    }));
  } catch (error) {
    if (isSshAuthenticationError(error)) throw error;
    // Preserve Agent/OpenSSH fallback for unsupported routes and older servers.
  }
  let agentEntries: RemoteFileEntry[] | null = null;
  if (context.launch.agentPath?.trim()) try {
    const response = await runFileOperation(context, "backgroundOperations.remoteFiles.listing", () =>
      invoke<{ entries: RemoteFileEntry[] }>("ssh_remote_file_list", {
        consumerId: context.consumerId,
        sshLaunch: context.launch,
        rootPath: context.rootPath,
        relativePath,
      }), options);
    agentEntries = response.entries ?? [];
  } catch (error) {
    if (options?.silent) throw error;
  }
  if (agentEntries !== null) return agentEntries.map(toEntry);
  const rootPath = context.rootPath || "/";
  const path = relativePath ? `${rootPath.replace(/\/$/, "")}/${relativePath}` : rootPath;
  const entries = await invoke<Array<{ name: string; path: string; kind: string; sizeBytes: number; modifiedMs?: number | null }>>(
    "ssh_list_file_entries",
    { spec, path },
  );
  return entries.map((entry) => ({
    name: entry.name,
    path: relativePath ? `${relativePath}/${entry.name}` : entry.path,
    kind: entry.kind === "directory" ? "directory" : "file",
    sizeBytes: entry.sizeBytes,
    modifiedMs: entry.modifiedMs ?? null,
  }));
}

export async function sshRemoteCreateEntry(
  context: SshRemoteFileContext,
  parentPath: string,
  name: string,
  kind: "file" | "directory",
  overwrite: boolean,
): Promise<{ path: string; kind: string }> {
  const spec = buildSshConnectionSpecFromLaunch(context.launch);
  return runFileOperation(context, "backgroundOperations.remoteFiles.reading", () =>
    invoke<{ path: string; kind: string }>("ssh_create_entry", { spec, rootPath: context.rootPath, parentPath, name, kind, overwrite }));
}

export async function sshRemoteReadFile(
  context: SshRemoteFileContext,
  relativePath: string,
  options?: SshRemoteFileOperationOptions,
): Promise<{ content: string; previewKind: ProjectFilePreviewKind; sizeBytes: number; modifiedMs: number | null }> {
  try {
    const result = await runFileOperation(context, "backgroundOperations.remoteFiles.reading", () =>
      invoke<RemoteFileRead>("ssh_sftp_read", {
        spec: buildSshConnectionSpecFromLaunch(context.launch),
        path: nativeSftpPath(context, relativePath),
      }), options);
    return {
      content: result.content,
      previewKind: result.kind === "image" ? "image" : "text",
      sizeBytes: result.sizeBytes,
      modifiedMs: result.modifiedMs ?? null,
    };
  } catch (agentError) {
    const spec = buildSshConnectionSpecFromLaunch(context.launch);
    let result: RemoteFileRead;
    try {
      result = await runFileOperation(context, "backgroundOperations.remoteFiles.reading", () =>
        invoke<RemoteFileRead>("ssh_remote_file_read", {
          consumerId: context.consumerId,
          sshLaunch: context.launch,
          rootPath: context.rootPath,
          relativePath,
        }), options);
    } catch {
      result = await runFileOperation(context, "backgroundOperations.remoteFiles.reading", () =>
        invoke<RemoteFileRead>("ssh_read_file", { spec, rootPath: context.rootPath, relativePath }), options);
    }
    return {
      content: result.content,
      previewKind: result.kind === "image" ? "image" : "text",
      sizeBytes: result.sizeBytes,
      modifiedMs: result.modifiedMs ?? null,
    };
  }
}

export async function sshRemoteWriteFile(
  context: SshRemoteFileContext,
  relativePath: string,
  content: string,
  options?: SshRemoteFileOperationOptions,
): Promise<void> {
  const spec = buildSshConnectionSpecFromLaunch(context.launch);
  try {
    await runFileOperation(context, "backgroundOperations.remoteFiles.reading", () =>
      invoke("ssh_sftp_write", { spec, path: nativeSftpPath(context, relativePath), content }), options);
  } catch {
    await runFileOperation(context, "backgroundOperations.remoteFiles.reading", () =>
      invoke("ssh_write_file", { spec, rootPath: context.rootPath, relativePath, content }), options);
  }
}

export async function sshRemoteDownloadFile(
  context: SshRemoteFileContext,
  relativePath: string,
  localPath: string,
  options?: SshRemoteFileOperationOptions,
): Promise<{ path: string; sizeBytes: number }> {
  const spec = buildSshConnectionSpecFromLaunch(context.launch);
  let unlisten: (() => void) | undefined;
  try {
    if (options?.onProgress) {
      unlisten = await listen<{ bytesDone?: number; bytesTotal?: number }>(`ssh-sftp-progress-${context.consumerId}`, (event) => {
        const done = Number(event.payload.bytesDone); const total = Number(event.payload.bytesTotal);
        if (total > 0) options.onProgress?.(Math.min(100, Math.round(done / total * 100)));
      });
    }
    return await runFileOperation(context, "backgroundOperations.remoteFiles.downloading", () =>
      invoke<{ path: string; sizeBytes: number; resumedBytes?: number }>("ssh_sftp_download", {
        spec, remotePath: nativeSftpPath(context, relativePath), localPath, transferId: context.consumerId,
      }), options);
  } catch {
    return runFileOperation(context, "backgroundOperations.remoteFiles.downloading", () =>
      invoke<{ path: string; sizeBytes: number }>("ssh_remote_file_download", {
        consumerId: context.consumerId, sshLaunch: context.launch, rootPath: context.rootPath, relativePath, localPath,
      }), options);
  } finally { unlisten?.(); }
}

export async function sshRemoteDeleteFile(
  context: SshRemoteFileContext,
  relativePath: string,
  options?: SshRemoteFileOperationOptions,
): Promise<{ relativePath: string; kind: string }> {
  const spec = buildSshConnectionSpecFromLaunch(context.launch);
  try {
    const parent = relativePath.split("/").slice(0, -1).join("/");
    const name = relativePath.split("/").pop() ?? relativePath;
    const entries = await invoke<Array<{ name: string; kind: string }>>("ssh_sftp_list", {
      spec, path: nativeSftpPath(context, parent),
    });
    const directory = entries.find((entry) => entry.name === name)?.kind === "directory";
    await runFileOperation(context, "backgroundOperations.remoteFiles.deleting", () =>
      invoke("ssh_sftp_delete", { spec, path: nativeSftpPath(context, relativePath), directory }), options);
    return { relativePath, kind: directory ? "directory" : "file" };
  } catch {
    try {
      return await runFileOperation(context, "backgroundOperations.remoteFiles.deleting", () =>
        invoke<{ relativePath: string; kind: string }>("ssh_remote_file_delete", {
          consumerId: context.consumerId, sshLaunch: context.launch, rootPath: context.rootPath, relativePath,
        }), options);
    } catch {
      return runFileOperation(context, "backgroundOperations.remoteFiles.deleting", () =>
        invoke<{ relativePath: string; kind: string }>("ssh_delete_file", { spec, rootPath: context.rootPath, relativePath }), options);
    }
  }
}

export async function sshRemoteCancelUpload(transferId: string): Promise<void> {
  await invoke("ssh_sftp_cancel_upload", { transferId: `file-put:${transferId}` });
}

export async function sshRemoteCleanupUpload(hostId: string, remotePath: string): Promise<void> {
  const launch = await buildSshDirectHostLaunch(hostId, remotePath);
  await invoke("ssh_sftp_cleanup_upload", { spec: buildSshConnectionSpecFromLaunch(launch), remotePath });
}

export async function sshRemotePutFile(
  context: SshRemoteFileContext,
  relativeDirectory: string,
  localPath: string,
  options?: SshRemoteFileOperationOptions,
): Promise<string> {
  const operationId = `remote-files:${context.consumerId}`;
  const operationOptions: SshRemoteFileOperationOptions = {
    ...options,
    cancel: context.consumerId.startsWith("file-put:")
      ? () => sshRemoteCancelUpload(context.consumerId.replace(/^file-put:/u, ""))
      : undefined,
  };
  const unlisteners: Array<() => void> = [];
  try {
    if (!options?.silent && options?.onProgress) {
      const updateProgress = (progress: number) => {
        const bounded = Math.max(0, Math.min(100, Math.round(progress)));
        useBackgroundOperationStore.getState().updateProgress(operationId, bounded);
        options.onProgress?.(bounded);
      };
      unlisteners.push(await listen<{ bytesDone?: number; bytesTotal?: number }>(`ssh-sftp-progress-${context.consumerId}`, (event) => {
        const done = Number(event.payload.bytesDone); const total = Number(event.payload.bytesTotal);
        if (total > 0) {
          options?.onProgressDetail?.({ bytesDone: done, bytesTotal: total });
          updateProgress(done / total * 100);
        }
      }));
      unlisteners.push(await listen<{ progress?: number }>(`ssh-file-upload-progress-${context.consumerId}`, (event) => {
        const progress = Number(event.payload.progress);
        if (Number.isFinite(progress)) updateProgress(progress);
      }));
    }
    try {
      const spec = buildSshConnectionSpecFromLaunch(context.launch);
      const fileName = localPath.split(/[\\/]/u).pop() ?? "upload";
      try {
        useBackgroundOperationStore.getState().updateVerification(operationId, "pending");
        const result = await runFileOperation(context, "backgroundOperations.remoteFiles.uploading", () =>
          invoke<{ resumedBytes?: number; sizeBytes?: number; sha256?: string; verification?: string }>("ssh_sftp_resume_upload", { spec, remotePath: nativeSftpPath(context, relativeDirectory ? `${relativeDirectory}/${fileName}` : fileName), localPath, transferId: context.consumerId }), operationOptions);
        useBackgroundOperationStore.getState().updateVerification(operationId, result.verification === "verified" ? "verified" : "pending");
        if (result.sizeBytes && result.resumedBytes) options?.onProgress?.(result.resumedBytes / result.sizeBytes * 100);
        return nativeSftpPath(context, relativeDirectory ? `${relativeDirectory}/${fileName}` : fileName);
      } catch (nativeError) {
        const code = String(nativeError);
        if (code.includes("ssh_sftp_checksum_mismatch") || code.includes("ssh_sftp_checksum_failed")) useBackgroundOperationStore.getState().updateVerification(operationId, "failed");
        else useBackgroundOperationStore.getState().clearVerification(operationId);
        if (code.includes("ssh_sftp_upload_cancelled") || code.includes("attachment_target_exists") || code.includes("ssh_local_file_unavailable") || code.includes("ssh_local_file_invalid")) throw nativeError;
        if (!context.launch.agentPath?.trim()) throw new Error("ssh_agent_not_installed");
      }
      return await runFileOperation(context, "backgroundOperations.remoteFiles.uploading", () =>
        invoke<string>("ssh_remote_file_put_path", {
          consumerId: context.consumerId,
          sshLaunch: context.launch,
          rootPath: context.rootPath,
          relativePath: relativeDirectory,
          localPath,
        }), operationOptions);
    } catch (agentError) {
      const code = String(agentError);
      if (code.includes("ssh_sftp_upload_cancelled") || code.includes("attachment_target_exists") || code.includes("ssh_local_file_unavailable") || code.includes("ssh_local_file_invalid")) throw agentError;
      const spec = buildSshConnectionSpecFromLaunch(context.launch);
      const relative = await runFileOperation(context, "backgroundOperations.remoteFiles.uploading", () =>
        invoke<string>("ssh_put_file", { spec, rootPath: context.rootPath, relativeDirectory, localPath }), operationOptions);
      const root = context.rootPath.replace(/\/$/u, "");
      return relative.startsWith("/") ? relative : `${root}/${relative}`;
    }
  } finally {
    unlisteners.forEach((unlisten) => unlisten());
  }
}

export async function sshRemoteSearch(
  context: SshRemoteFileContext,
  query: string,
  content = false,
): Promise<ProjectFileEntry[]> {
  const response = await runFileOperation(context, "backgroundOperations.remoteFiles.searching", () =>
    invoke<{ entries: RemoteFileEntry[] }>("ssh_remote_file_search", {
      consumerId: context.consumerId,
      sshLaunch: context.launch,
      rootPath: context.rootPath,
      query,
      content,
    }));
  return (response.entries ?? []).map(toEntry);
}

export function remoteEntryToSearchMatch(entry: ProjectFileEntry): ProjectFileContentMatch {
  return {
    path: entry.path,
    name: entry.name,
    lineNumber: 1,
    lineText: entry.name,
    before: [],
    after: [],
  };
}
