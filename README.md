# mini-cursor

手写编码 Agent。当前：**Day 10（Few-shot）**。

## 命令

```bash
npm start                   # CLI（PROMPT_PROFILE=good|sloppy|fewshot）
npm run server              # SSE 演示页
npm run eval                # 默认题库
npm run eval:day9:good      # Day9 题库
npm run eval:day9:sloppy
npm run eval:day10:good     # Day10 题库（无 user 剧透）
npm run eval:day10:fewshot
npm run eval:day10:sloppy
npm run replay -- traces/xxx.json
```

## Day10 要点

- `fewshot` = good 规则 + 文字正/反例 + 一条含 `tool_calls` 的示范对话  
- 题库不在 user 里写「必须 ask_user」，用来测 few-shot / 规则是否真生效  

课时笔记见 [`lessons/`](./lessons/)。
