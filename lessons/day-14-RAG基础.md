# Day 14：RAG 基础（D2.3）

> 对应：D2.3  
> 代码：`src/embed.ts`、`src/rag.ts`、`src/rag_index.ts`、`src/demo_day14.ts`、`playground/docs/api.md`

---

## 选型

- **Embedding**：硅基流动 `BAAI/bge-m3`（国内、OpenAI 兼容、常有免费档）  
- **生成**：继续用项目 DeepSeek Chat  
- **无 embedding key**：自动 `local` 哈希向量（管线可跑，语义弱）

---

## 管线

```
playground/docs/*.md
  → chunkMarkdown
  → embedTexts
  → memory/rag-index.json
用户问题
  → embedQuery → cosine Top-K
  → [rag] 拼进 messages
  → DeepSeek 生成
```

---

## 命令

```bash
# 建索引（无 SILICONFLOW key 也能用 local）
npm run rag:index

# 检索 +（有 OPENAI_API_KEY 则）生成
npm run demo:day14
npm run demo:day14 -- "限流每分钟多少次？"
```

交互：

```bash
set RAG=1
npm start
# 先确保已 rag:index
```

硅基流动：

1. 打开 https://siliconflow.cn 注册  
2. 创建 API Key  
3. `.env` 写入：

```env
EMBEDDING_API_KEY=sk-你的硅基流动key
EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
EMBEDDING_MODEL=BAAI/bge-m3
RAG=1
```

再 `npm run rag:index`（用真向量重建索引）。

---

## 自测题

1. 为什么 DeepSeek 不能单独完成「出向量」？  
2. Top-K=3 时 messages 里大概多了什么？  
3. local 哈希和 bge-m3 差在哪？  

---

## 验收

- [x] 切块 + 索引落盘  
- [x] Top-K 检索 + `[rag]` 注入  
- [x] demo / rag:index / loop 开关  
- [x] 硅基流动 + local 双模式  
