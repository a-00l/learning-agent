/**
 * Day13：长期记忆（D2.1 / D2.2 起步）
 *
 * - 存盘：memory/user.json（跨会话）
 * - 写入：用户显式「记住：…」
 * - 读取：新任务开场 pick 几条，钉成 [long-term memory] 消息
 *
 * LONG_TERM_MEMORY=1 开启读取注入；写入命令在 CLI 始终可用（便于演示）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Message } from "./types.js";

export const LONG_TERM_MARKER = "[long-term memory]";

export type MemoryItem = {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
};

export type MemoryStore = {
  items: MemoryItem[];
};

export function memoryEnabled(override?: boolean): boolean {
  if (override != null) return override;
  const v = (process.env.LONG_TERM_MEMORY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function defaultMemoryPath(repoRoot: string): string {
  const raw = process.env.MEMORY_FILE?.trim();
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
  }
  return path.join(repoRoot, "memory", "user.json");
}

export function emptyStore(): MemoryStore {
  return { items: [] };
}

export async function loadMemory(file: string): Promise<MemoryStore> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as MemoryStore;
    if (!parsed || !Array.isArray(parsed.items)) return emptyStore();
    return {
      items: parsed.items.filter(
        (it) => it && typeof it.text === "string" && it.text.trim(),
      ),
    };
  } catch {
    return emptyStore();
  }
}

export async function saveMemory(
  file: string,
  store: MemoryStore,
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2), "utf8");
}

/** 解析「记住：xxx」；匹配则写入并返回新条目 */
export async function rememberFromUser(
  file: string,
  userText: string,
): Promise<MemoryItem | null> {
  const m = userText.trim().match(/^记住[:：]\s*(.+)$/s);
  if (!m) return null;
  const text = m[1].trim();
  if (!text) return null;

  const store = await loadMemory(file);
  // 去重：相同文本不重复加
  const exists = store.items.some(
    (it) => it.text.toLowerCase() === text.toLowerCase(),
  );
  if (exists) {
    return store.items.find((it) => it.text.toLowerCase() === text.toLowerCase())!;
  }

  const item: MemoryItem = {
    id: `m-${Date.now().toString(36)}`,
    text,
    tags: ["user", "preference"],
    createdAt: new Date().toISOString(),
  };
  store.items.push(item);
  await saveMemory(file, store);
  return item;
}

/** 按关键词删一条；无关键词则无效 */
export async function forgetByText(
  file: string,
  needle: string,
): Promise<MemoryItem | null> {
  const q = needle.trim().toLowerCase();
  if (!q) return null;
  const store = await loadMemory(file);
  const idx = store.items.findIndex(
    (it) =>
      it.id.toLowerCase() === q || it.text.toLowerCase().includes(q),
  );
  if (idx < 0) return null;
  const [removed] = store.items.splice(idx, 1);
  await saveMemory(file, store);
  return removed;
}

/**
 * 选进 prompt 的条目：优先带 preference/user tag，再按时间取最近 limit 条。
 * 若提供 query，简单子串加分（非向量 RAG）。
 */
export function pickForPrompt(
  store: MemoryStore,
  opts: { limit?: number; query?: string } = {},
): MemoryItem[] {
  const limit = opts.limit ?? 5;
  const query = (opts.query ?? "").trim().toLowerCase();

  const scored = store.items.map((it, index) => {
    let score = index; // 越新越高（后面再按 createdAt）
    if (it.tags.includes("preference") || it.tags.includes("user")) score += 100;
    if (query && it.text.toLowerCase().includes(query)) score += 50;
    const t = Date.parse(it.createdAt);
    if (!Number.isNaN(t)) score += t / 1e15;
    return { it, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.it);
}

export function renderLongTermMemory(items: MemoryItem[]): string {
  if (!items.length) return "";
  const lines = items.map((it, i) => `${i + 1}. ${it.text}`);
  return [
    `${LONG_TERM_MARKER} 以下为跨会话长期记忆，请遵守（优先级高于临时闲聊偏好）：`,
    ...lines,
  ].join("\n");
}

/** 钉在 system 后；已有旧卡则替换（与 facts 类似） */
export function upsertLongTermMessage(
  messages: Message[],
  card: string,
): Message[] {
  if (!card.trim()) return messages.map((m) => ({ ...m }));

  const memMsg: Message = { role: "user", content: card };
  const out: Message[] = messages.map((m) => ({
    ...m,
    tool_calls: m.tool_calls?.map((c) => ({
      ...c,
      function: { ...c.function },
    })),
  }));

  const idx = out.findIndex(
    (m) =>
      m.role === "user" &&
      typeof m.content === "string" &&
      m.content.startsWith(LONG_TERM_MARKER),
  );
  if (idx >= 0) {
    out[idx] = memMsg;
    return out;
  }

  // 插在 system 后；若已有 [task facts]，插在事实卡后，避免冲掉看板位置习惯
  if (out[0]?.role === "system") {
    const factsIdx = out.findIndex(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.startsWith("[task facts]"),
    );
    const at = factsIdx >= 0 ? factsIdx + 1 : 1;
    out.splice(at, 0, memMsg);
  } else {
    out.unshift(memMsg);
  }
  return out;
}
