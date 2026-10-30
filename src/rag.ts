/**
 * Day14：最小 RAG（切块 → 向量索引 → Top-K → 拼进 messages）
 */
import fs from "node:fs/promises";
import path from "node:path";
import { cosine, embedQuery, embedTexts, loadEmbedConfig } from "./embed.js";
import type { Message } from "./types.js";

export const RAG_MARKER = "[rag]";

export type RagChunk = {
  id: string;
  source: string;
  text: string;
  embedding: number[];
};

export type RagIndex = {
  version: 1;
  createdAt: string;
  embedMode: string;
  embedModel: string;
  chunks: RagChunk[];
};

export function ragEnabled(override?: boolean): boolean {
  if (override != null) return override;
  const v = (process.env.RAG ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function defaultRagIndexPath(repoRoot: string): string {
  const raw = process.env.RAG_INDEX?.trim();
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
  }
  return path.join(repoRoot, "memory", "rag-index.json");
}

export function defaultRagDocsDir(repoRoot: string): string {
  const raw = process.env.RAG_DOCS?.trim();
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
  }
  return path.join(repoRoot, "playground", "docs");
}

/** 按 Markdown ## 标题切块；无标题则按固定长度切 */
export function chunkMarkdown(source: string, text: string): Array<{ source: string; text: string }> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const parts = normalized.split(/\n(?=##\s)/);
  const out: Array<{ source: string; text: string }> = [];
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    if (t.length <= 800) {
      out.push({ source, text: t });
      continue;
    }
    for (let i = 0; i < t.length; i += 600) {
      out.push({ source, text: t.slice(i, i + 700) });
    }
  }
  return out;
}

export async function buildIndexFromDir(docsDir: string): Promise<RagIndex> {
  const cfg = loadEmbedConfig();
  const names = await fs.readdir(docsDir);
  const mdFiles = names.filter((n) => n.endsWith(".md"));
  const pieces: Array<{ source: string; text: string }> = [];
  for (const name of mdFiles) {
    const full = path.join(docsDir, name);
    const raw = await fs.readFile(full, "utf8");
    pieces.push(...chunkMarkdown(name, raw));
  }
  if (!pieces.length) {
    throw new Error(`目录无 .md 可索引: ${docsDir}`);
  }

  const embeddings = await embedTexts(pieces.map((p) => p.text));
  const chunks: RagChunk[] = pieces.map((p, i) => ({
    id: `c${i}`,
    source: p.source,
    text: p.text,
    embedding: embeddings[i],
  }));

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    embedMode: cfg.mode,
    embedModel: cfg.mode === "local" ? `local-hash-${cfg.localDim}` : cfg.model,
    chunks,
  };
}

export async function saveIndex(file: string, index: RagIndex): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(index), "utf8");
}

export async function loadIndex(file: string): Promise<RagIndex> {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw) as RagIndex;
}

export type RetrieveHit = {
  id: string;
  source: string;
  text: string;
  score: number;
};

export async function retrieve(
  index: RagIndex,
  query: string,
  k = 3,
): Promise<RetrieveHit[]> {
  const q = await embedQuery(query);
  const scored = index.chunks.map((c) => ({
    id: c.id,
    source: c.source,
    text: c.text,
    score: cosine(q, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, k));
}

export function renderRagBlock(hits: RetrieveHit[]): string {
  if (!hits.length) return "";
  const body = hits
    .map(
      (h, i) =>
        `### 片段${i + 1}（来源 ${h.source}，score=${h.score.toFixed(3)}）\n${h.text}`,
    )
    .join("\n\n");
  return [
    `${RAG_MARKER} 以下为检索到的资料，请优先依据资料回答；资料没有的信息请明确说不知道，不要编造。`,
    body,
  ].join("\n");
}

export function upsertRagMessage(messages: Message[], card: string): Message[] {
  if (!card.trim()) return messages.map((m) => ({ ...m }));
  const ragMsg: Message = { role: "user", content: card };
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
      m.content.startsWith(RAG_MARKER),
  );
  if (idx >= 0) {
    out[idx] = ragMsg;
    return out;
  }

  // 插在 system 后、尽量靠近用户问题前：放在最后一条 user 之前
  let lastUser = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser >= 0) {
    out.splice(lastUser, 0, ragMsg);
  } else if (out[0]?.role === "system") {
    out.splice(1, 0, ragMsg);
  } else {
    out.unshift(ragMsg);
  }
  return out;
}
