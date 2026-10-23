import path from "node:path";

export type ResolveOk = { ok: true; abs: string; rel: string };
export type ResolveErr = { ok: false; error: string };
export type ResolveResult = ResolveOk | ResolveErr;

/**
 * 把相对路径解析到工作区内。
 * - abs：给 fs 用的绝对路径
 * - rel：相对工作区、统一用 `/` 的路径（给模型/日志看）
 * 越界（含 `..` 逃逸）返回 error。Day2 轻量护栏，正式沙箱在 F2。
 */
export function resolveInWorkspace(workspace: string, relPath: string): ResolveResult {
  const trimmed = relPath.trim();
  if (!trimmed) {
    return { ok: false, error: "path 为空" };
  }

  const root = path.resolve(workspace);
  const abs = path.resolve(root, trimmed);
  // 必须仍落在 root 之下（或恰好等于 root）
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    return { ok: false, error: `路径越界: ${relPath}` };
  }

  return {
    ok: true,
    abs,
    // Windows `\` → `/`，避免工具结果路径风格混乱
    rel: path.relative(root, abs).split(path.sep).join("/"),
  };
}

/** 工具成功/失败统一打成 JSON 字符串，方便塞进 role:tool 消息 */
export function toolJson(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

export function toolError(error: string): string {
  return toolJson({ ok: false, error });
}
