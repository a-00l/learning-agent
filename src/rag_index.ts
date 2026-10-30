/**
 * 构建 RAG 索引：
 *   npm run rag:index
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEmbedConfig } from "./embed.js";
import {
  buildIndexFromDir,
  defaultRagDocsDir,
  defaultRagIndexPath,
  saveIndex,
} from "./rag.js";

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

async function main() {
  const docsDir = defaultRagDocsDir(root);
  const indexPath = defaultRagIndexPath(root);
  const cfg = loadEmbedConfig();
  console.log(`docs:  ${docsDir}`);
  console.log(`index: ${indexPath}`);
  console.log(`embed: mode=${cfg.mode} model=${cfg.model}`);
  if (cfg.mode === "local") {
    console.log(
      "提示: 未配置 EMBEDDING_API_KEY，使用本地哈希向量（可跑通管线；语义较弱）。",
    );
    console.log(
      "硅基流动免费 embedding：注册后设 EMBEDDING_API_KEY，EMBEDDING_MODE 可省略。",
    );
  }

  const index = await buildIndexFromDir(docsDir);
  await saveIndex(indexPath, index);
  console.log(`完成: ${index.chunks.length} chunks → ${indexPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
