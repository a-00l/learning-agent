/**
 * Day14：建索引 → 检索 → 拼 messages →（可选）DeepSeek 回答
 *
 *   npm run demo:day14
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEmbedConfig } from "./embed.js";
import { chat } from "./llm.js";
import {
  buildIndexFromDir,
  defaultRagDocsDir,
  defaultRagIndexPath,
  loadIndex,
  renderRagBlock,
  retrieve,
  saveIndex,
  upsertRagMessage,
} from "./rag.js";
import type { Message } from "./types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv(path.join(root, ".env"));

async function ensureIndex() {
  const indexPath = defaultRagIndexPath(root);
  const docsDir = defaultRagDocsDir(root);
  try {
    return await loadIndex(indexPath);
  } catch {
    console.log("索引不存在，正在构建…");
    const index = await buildIndexFromDir(docsDir);
    await saveIndex(indexPath, index);
    console.log(`已写入 ${indexPath}（${index.chunks.length} chunks）\n`);
    return index;
  }
}

async function main() {
  const cfg = loadEmbedConfig();
  console.log(`Embedding: mode=${cfg.mode} model=${cfg.model}\n`);

  const index = await ensureIndex();
  const query = process.argv[2]?.trim() || "Webhook 失败会重试几次？";
  console.log(`问题: ${query}\n`);

  const hits = await retrieve(index, query, 3);
  console.log("—— Top-K 检索 ——");
  for (const h of hits) {
    console.log(
      `  [${h.score.toFixed(3)}] ${h.source} :: ${h.text.slice(0, 60).replace(/\n/g, " ")}…`,
    );
  }

  const card = renderRagBlock(hits);
  let messages: Message[] = [
    {
      role: "system",
      content:
        "你是文档助手。只根据 [rag] 资料回答；资料没有就说不知道。用简洁中文。",
    },
    { role: "user", content: query },
  ];
  messages = upsertRagMessage(messages, card);

  console.log("\n—— 拼进 messages 后 ——");
  for (const m of messages) {
    const preview = (m.content ?? "").slice(0, 180).replace(/\n/g, "\\n");
    console.log(`[${m.role}] ${preview}${((m.content ?? "").length > 180 ? "…" : "")}`);
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.log("\n未配置 OPENAI_API_KEY，跳过生成。检索管线已完成。");
    return;
  }

  console.log("\n—— DeepSeek 生成 ——");
  const turn = await chat(messages, undefined);
  console.log(turn.content?.trim() || "(空)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
