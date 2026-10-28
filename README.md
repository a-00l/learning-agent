# mini-cursor

手写编码 Agent。当前：**Day 11（摘要压缩）**。

## 命令

```bash
npm start                   # CLI
npm run server              # SSE
npm run demo:day11          # 丢弃 vs 摘要对照
npm run eval
npm run eval:day9:good
npm run eval:day10:fewshot
npm run replay -- traces/xxx.json
```

## Day11 要点

- `CONTEXT_SUMMARY=1`：超预算时对丢弃段再调一次 LLM 做摘要  
- `CONTEXT_MAX_CHARS`：字符预算（演示可调小）  
- `npm run demo:day11`：同一历史对比「省略 N 条」vs「摘要」  

课时笔记见 [`lessons/`](./lessons/)。
