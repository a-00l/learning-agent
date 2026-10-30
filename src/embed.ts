/**
 * Day14：Embedding
 *
 * 默认：硅基流动 OpenAI 兼容接口（BAAI/bge-m3）
 * 无 key / EMBEDDING_MODE=local：本地哈希向量（仅保证管线可跑，语义弱）
 */

export type EmbedConfig = {
  mode: "siliconflow" | "local";
  apiKey?: string;
  baseUrl: string;
  model: string;
  /** local 模式向量维度 */
  localDim: number;
};

export function loadEmbedConfig(): EmbedConfig {
  const modeRaw = (process.env.EMBEDDING_MODE ?? "").trim().toLowerCase();
  const apiKey =
    process.env.EMBEDDING_API_KEY?.trim() ||
    process.env.SILICONFLOW_API_KEY?.trim() ||
    "";
  const forceLocal = modeRaw === "local" || modeRaw === "hash";
  const mode: EmbedConfig["mode"] =
    !forceLocal && apiKey ? "siliconflow" : "local";

  return {
    mode,
    apiKey: apiKey || undefined,
    baseUrl: (
      process.env.EMBEDDING_BASE_URL ?? "https://api.siliconflow.cn/v1"
    ).replace(/\/$/, ""),
    model: process.env.EMBEDDING_MODEL?.trim() || "BAAI/bge-m3",
    localDim: Number(process.env.EMBEDDING_LOCAL_DIM || 256) || 256,
  };
}

/** 本地确定性伪向量：学习管线用，语义检索效果弱 */
export function localEmbed(text: string, dim = 256): number[] {
  const v = new Array(dim).fill(0);
  const s = text.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const i1 = (code * 17 + i * 3) % dim;
    const i2 = (code * 31 + i * 7) % dim;
    v[i1] += 1;
    v[i2] += 0.5;
  }
  // 简单 bigram
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.charCodeAt(i) * 131 + s.charCodeAt(i + 1);
    v[bg % dim] += 1.2;
  }
  return l2Normalize(v);
}

function l2Normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  return v.map((x) => x / n);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const cfg = loadEmbedConfig();
  if (cfg.mode === "local") {
    return texts.map((t) => localEmbed(t, cfg.localDim));
  }
  return embedViaApi(texts, cfg);
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedTexts([text]);
  return v;
}

async function embedViaApi(
  texts: string[],
  cfg: EmbedConfig,
): Promise<number[][]> {
  if (!cfg.apiKey) {
    throw new Error("EMBEDDING_API_KEY / SILICONFLOW_API_KEY 未配置");
  }
  // 硅基流动等兼容接口：input 可为 string 或 string[]
  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      input: texts.length === 1 ? texts[0] : texts,
      encoding_format: "float",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embedding HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ embedding: number[]; index?: number }>;
  };
  const rows = data.data ?? [];
  if (!rows.length) {
    throw new Error("Embedding 返回空 data");
  }
  // 按 index 排序，保证与输入对齐
  rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return rows.map((r) => l2Normalize(r.embedding));
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // 已 L2 归一化时，点积=余弦
}
