# mini-cursor 演示 API 手册

> Day14 RAG 语料：故意写进可检索的事实，便于对照「有无检索」。

## 认证

所有请求需在 Header 携带：

```
Authorization: Bearer <token>
```

Token 在控制台「密钥管理」创建。过期时间默认 30 天。

## 限流

- 默认：每分钟最多 **60** 次请求
- 触发限流时返回 HTTP 429
- 企业版可提升至每分钟 600 次

## Webhook

配置回调 URL 后，任务完成会 POST 通知。

- 失败重试次数：**3** 次
- 重试间隔：指数退避（1s / 2s / 4s）
- 签名 Header：`X-Webhook-Signature`

## 错误码

| 代码 | 含义 |
|------|------|
| 4001 | 参数缺失 |
| 4002 | Token 无效 |
| 4290 | 触发限流 |
| 5000 | 服务内部错误 |

## 联系

技术支持邮箱：support@example.invalid（演示用，非真实地址）
