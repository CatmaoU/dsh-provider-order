# @dsh-external/dsh-provider-order

拖动【设置 → 模型】列表里各个模型商(provider)的顺序，输入框下方「选择模型」展开菜单里的模型商分组顺序同步跟随。

## 原理

- 设置→模型列表 与 模型选择器 的数据最终都来自 host 服务 `llm`（LlmRuntime）的两个公开 Map：`ctx.llm.adapters` 与 `ctx.llm.directory`（key 均为 provider id）。
- 本插件在设置页新增「模型商顺序」小节（settings.section，order=11），列出全部模型商并支持鼠标拖拽。
- 拖拽结果写入 settings 命名空间 `provider-order.order: string[]`（持久化到 `~/.dsh/settings.yaml`）。
- host 侧监听该命名空间变更 → 按序重排两个 Map 的插入顺序 → 广播 `llm/adapters-updated` → 两个 UI 同时刷新为新顺序。
- 重启后自动恢复：插件 apply 时读取已存顺序并重排（`llm/adapters-updated` 事件兜底）。

## 安装注意（重要）

1. **核心白名单 patch**：客户端读写 `provider-order` 命名空间要求它出现在
   `D:\dsh\resources\app\node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js`
   的 `WEB_SETTINGS_NAMESPACES` 数组中（已加）。**升级 DSH Desktop 后该改动会丢失，需重新加回**
   （把 `"provider-order"` 追加进数组，然后重启）。

2. 已知限制：`llm.providers` 视图固定为「directory 条目先、无 settingsNs 的 live provider 追加尾部」。
   若存在仅 live 注册（不在 configurable directory）的模型商，设置页中它的行会一直排在列表尾部，
   但模型选择器（按 adapters 序）会正确跟随拖拽顺序。

3. 重置按钮会把顺序恢复为插件启动时记录的自然顺序（新加入的模型商追加末尾）。

## 文件结构

- `lib/index.js` — host 端：注册命名空间、重排两个 Map、事件联动
- `lib/client.js` — Web 端：设置页拖拽列表
- `cordis.patch.yml` — bundle 装配 patch（随 bundles 列表在重启后应用）
