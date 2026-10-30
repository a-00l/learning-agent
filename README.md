# mini-cursor

手写编码 Agent。当前：**Day 14（RAG）**。

## 命令

```bash
npm start
npm run rag:index             # 建向量索引
npm run demo:day14            # 检索 + DeepSeek 回答
npm run demo:day13
npm run server
```

## Day14 要点

- 语料：`playground/docs/api.md`  
- Embedding：硅基流动 `BAAI/bge-m3`（或无 key 时 local 哈希）  
- 生成：DeepSeek  
- `RAG=1` 时开场检索 Top-K 注入 `[rag]`  

课时笔记见 [`lessons/`](./lessons/)。
