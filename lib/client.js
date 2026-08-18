// Browser half of @dsh-external/dsh-provider-order.
//
// 用户最终形态：直接在「设置 → 模型」页的模型商行上拖动排序（拖拽本体 patch
// 在核心 bundle @deepseek-ai/dsh-client-ui-settings-models/lib/client.js，备份
// 为同目录 client.js.dpo-bak），本 client 半不再注册任何设置分区——原
// 「模型商顺序」占位卡已按用户要求删除。
//
// host 半（lib/index.js）负责：收到 provider-order.order 变更后重排
// LlmRuntime 的 adapters/directory 两个 Map 并广播 llm/adapters-updated，
// 使「设置→模型」列表与输入框下方模型选择器同步跟随。
//
// 依赖：命名空间 provider-order 必须出现在 dsh-host-apiproxy 的
// WEB_SETTINGS_NAMESPACES 白名单中（已 patch，D:\dsh\resources\app\node_modules\
// @deepseek-ai\dsh-host-apiproxy\lib\index.js:892-906），升级后需重加。

window.__ModuleLoader__.load({
  id: "@dsh-external/dsh-provider-order",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // 无 UI：拖拽能力由核心 bundle patch 提供。
    function apply() {}

    const plugin = {
      name: "provider-order",
      inject: [],
      apply,
    };

    exports.default = plugin;
    exports.name = plugin.name;
    exports.inject = plugin.inject;
    exports.apply = plugin.apply;

    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    return module.exports;
  },
});