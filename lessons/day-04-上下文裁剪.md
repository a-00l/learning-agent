# Day 4：D1 上下文裁剪

> 对应学习路径：D1.1–D1.3（会话内）  
> 代码：`src/context.ts`、`src/loop.ts`、`playground/big.txt`

---

## 本节目标

工具多跑几轮后，`messages` 会膨胀（尤其 `read_file` / `grep` 大结果）。  
学会在 **每次调用 LLM 前** 裁剪上下文，避免爆窗口或变蠢。

---

## 知识点

### 1. 上下文涨在哪里

每一轮典型增长：

- `assistant` + `tool_calls`
- 多条 `tool`（内容往往最长）
- 下一轮又来一轮

不裁剪 → token 费用升高、延迟变长、旧目标被噪声淹没。

### 2. 两级策略（本节实现）

| 级 | 做什么 | 代码 |
|----|--------|------|
| ① 截断 | 单条 `tool` 内容超过阈值则砍尾并标注 `truncated` | `shrinkToolContents` |
| ② 丢弃 | 总量仍超预算，则丢掉较早消息，保留 `system` + 尾部 | `keepTailWithinBudget` |

预算用 **字符粗算**，不是精确 tokenizer——够学原理；上线可换成 tiktoken / 官方计数。

### 3. 什么必须留、什么可以扔

- **必须留**：`system`（含 AGENTS.md）、尽量留住 **最近** 的对话与工具结果  
- **可扔/可砍**：很早以前的大段 tool 输出  
- **不能破坏协议**：不要留下「没有对应 assistant.tool_calls 的孤立 tool 消息」

### 4. 裁剪发生在「调模型之前」

```
append tool 结果 → messages 变长
  → trimMessages(messages)
  → chat(trimmed)
```

裁剪后的数组写回 `messages`，后续轮次在已瘦身历史上继续长，而不是只瘦「发给 API 的副本」、内存里无限涨。

### 5. 可观测

CLI 出现 `[trim]` 日志，结尾有 `trims=N`。  
没有日志就等于盲飞——下节 H1 trace 会把这记进文件。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/context.ts` | `trimMessages` / 字符估算 |
| `src/loop.ts` | 每轮 LLM 前调用裁剪 |
| `playground/big.txt` | ~30KB 填充文件，用来触发截断 |

默认：`maxChars=20000`，`maxToolContentChars=2500`（可在 `trimMessages` 参数改）。

---

## 建议练习

1. `先读 big.txt，再读 package.json，总结两者要点`  
   - 应看到 `[trim]` 与 `truncated tool output`  
2. 把 `DEFAULT_MAX_TOOL` 改成 `500`，再跑一次，对比截断更狠时模型是否还能答对 package.json  
3. 连续多步改文件任务，看 `trims` 是否随步数增加  

---

## 自测题

1. 为什么优先截断 `tool` 而不是删 `system`？  
2. 若裁剪后第一条非 system 消息是孤立的 `role:tool`，API 可能出什么问题？本节怎么避免？  
3. 「只 trim 发给 API 的副本、内存保留全量」和「写回 messages」各有什么利弊？  
4. 字符预算和真实 token 预算差在哪？  

---

## 验收标准

- [x] `context.ts` 提供 `trimMessages` + 统计  
- [x] loop 每轮调模型前裁剪，并打 `[trim]`  
- [x] 大 `big.txt` 读入后会出现 tool 截断  
- [x] 不破坏 assistant ↔ tool 配对  

---

## 和下节的衔接

下一节建议：**H1 Trace 落盘**——把每轮 messages 摘要、trim 统计、tool 参数写成 JSON，翻车时能回放。
