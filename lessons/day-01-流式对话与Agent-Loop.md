# Day 0–1：LLM 调用 + `read_file` + 手写 Agent Loop

> 对应学习路径：A2、C1.1–C1.3、M1  
> 代码：`src/llm.ts`、`src/loop.ts`、`src/tools/read_file.ts`、`src/cli.ts`

---

## 本节目标

打通「能对话、会读文件」的最小 Agent，搞清 **Tool Calling 的真实数据流**。

---

## 知识点

### 1. Messages 不是「一个大字符串」

多轮对话必须是消息列表，角色不同职责不同：

| role | 谁写的 | 作用 |
|------|--------|------|
| `system` | 你的程序 | 身份、约束、工作区说明 |
| `user` | 用户 | 本轮任务 |
| `assistant` | 模型 | 回复文本，和/或 `tool_calls` |
| `tool` | 你的程序 | 工具执行结果，必须带 `tool_call_id` |

### 2. Tool Calling：模型点名，运行时执行

模型 **不会** 自己读磁盘。它只返回类似：

```json
{ "tool_calls": [{ "id": "call_xxx", "function": { "name": "read_file", "arguments": "{\"path\":\"package.json\"}" } }] }
```

你的 `loop.ts` 负责：

1. 解析 `arguments`
2. 真正调用 `read_file`
3. 把结果以 `role: "tool"` + 同一个 `tool_call_id` 塞回 `messages`
4. 再调一次 LLM

漏掉 `tool_call_id` 对不上，下一轮模型会混乱。

### 3. Agent Loop 的骨架

```
while steps < MAX:
  turn = LLM(messages, tools)
  append assistant
  if 没有 tool_calls → 输出文本，结束
  else 执行每个 tool → append tool 结果 → 继续 while
```

终止条件（本节实现了前两个）：

- 模型返回纯文本（认为完成）
- 达到最大步数（防死循环）
- （未做）用户取消

### 4. 工具错误要「回灌」而不是只打日志

`read_file` 失败时返回 JSON：`{ "ok": false, "error": "..." }`。  
这样模型在下一轮能看见失败原因，而不是你在终端看到了、模型还在瞎猜。

### 5. 路径越界的临时护栏

即使还没正式沙箱（F2），`resolve` 后也要检查文件是否落在 `workspace` 内，挡住 `../` 逃逸。

---

## 关键文件怎么读

1. `types.ts`：Message / ToolCall 形状  
2. `llm.ts`：`chat()` 一次请求；`appendAssistant` / `appendToolResult`  
3. `loop.ts`：while 循环 = Agent 本体  
4. `tools/read_file.ts`：第一个工具的 schema + 实现  

---

## 自测题（当日应能答出）

1. `tool_calls` 出现时，messages 里先后多了哪两类消息？  
2. 为什么 `tool` 消息必须带 `tool_call_id`？  
3. 把 `MAX_STEPS` 改成 1，再问「读 package.json」，会发生什么？

---

## 验收标准

- [x] 能多轮对话（至少依赖 messages 历史）
- [x] 问依赖列表时，真实调用了 `read_file` 再回答
- [x] 不依赖 LangGraph 等重框架
