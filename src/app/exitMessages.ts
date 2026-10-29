import { pickByLanguage, type AppLanguage } from "../shared/i18n/index";

const resources: Record<string, [string, string]> = {
  side_question: ["侧问进程", "Side-question process"],
  cc_connect: ["消息连接桥", "Messaging bridge"],
  live_server: ["预览服务器", "Preview server"],
  web_server: ["Web 服务器", "Web server"],
  web_device: ["Web 设备", "Web device"],
  pty_owner: ["终端实例", "Terminal owner"],
  pty_session: ["终端会话", "Terminal session"],
  worker: ["清理工作线程", "Cleanup worker"],
  prepare: ["退出准备", "Exit preparation"],
};
export function exitResourceLabel(language: AppLanguage, id: string, kind?: string): string {
  const labels = resources[kind ?? id];
  return labels ? `${pickByLanguage(language, ...labels)} (${id})` : id;
}
export function exitFailureLabel(language: AppLanguage, code: string): string {
  if (code.includes("timeout")) return pickByLanguage(language, "等待资源停止超时；不会强制退出。", "Timed out waiting for the resource; exit will not be forced.");
  if (code.includes("unsupported")) return pickByLanguage(language, "当前资源不支持此操作。", "This resource does not support the operation.");
  if (code.includes("worker_running")) return pickByLanguage(language, "清理仍在执行，请稍后重试。", "Cleanup is still running. Retry later.");
  if (code.includes("stale")) return pickByLanguage(language, "已拒绝过期的退出回执。", "An outdated exit receipt was rejected.");
  return pickByLanguage(language, "资源操作失败，请重试或恢复使用。", "Resource operation failed. Retry or resume the application.");
}
