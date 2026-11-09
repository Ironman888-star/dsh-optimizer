# v0.3.6 事故修复：上下文替换事件缺少消息身份

## 影响

在 v0.3.5 及之前的相关实现中，插件对 Session surface 进行 `replace` 时，用 `session.append('user/message', {...}, { surfaceOp: ... })` 写入了没有 `data.id` 的占位消息。DSH V4 持久化读取器要求可见消息具有唯一身份。结果是在重启后加载部分会话时出现：

```text
session event at seq <N> lacks an identified message
```

这类报错不必然意味着 Zstandard 压缩文件截断或磁盘损坏；需要使用原生 DSH 会话重放器确认。

## 根因与修复

修复点：`lib/context-packing.js` 中替换占位事件的 payload。v0.3.6 在每条替换消息的 `data.id` 上写入 `crypto.randomUUID()`。这与事件自身 seq 不同：消息身份必须存在于**消息 data 对象**内。

```js
session.append('user/message', {
  id: randomUUID(),
  role: 'user',
  content: [{ type: 'text', text: MARKER }],
  source: { kind: SOURCE_KIND },
}, { surfaceOp: { op: 'replace', startSeq, endSeq }, sourceEventSeqs })
```

代码示例用于解释修复语义，具体操作以源码为准。

## 修复边界

- **预防：** 新生成的替换标记包含身份，已补回归测试。
- **非自动恢复：** 旧会话磁盘中已有的无 ID 事件不会因为升级插件被自动重写。
- **安全恢复：** 只在完整备份、精确事件匹配、候选文件验证、DSH 完全退出后才允许覆盖；不修改其他角色、工具调用、事件次序或原始日志。
- **不能跨来源套用：** 其他插件产生的匿名消息可能还缺 `role` 等字段，不能因为症状相同就一律只补 `id`。

## 验收证据（脱敏）

已报告的 DSH Desktop 实测中：升级后 14 个新裁剪标记全部含 UUID；连续 12 轮并重启后，本机 V4 读取器验证成功，未再报消息身份校验失败。该验证不代表对所有 DSH 版本的保证。
