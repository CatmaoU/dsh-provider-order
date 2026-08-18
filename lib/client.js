// Browser half of @dsh-external/dsh-provider-order.
//
// 拖拽增强（self-contained，不依赖修改核心 bundle 文件）。
//
// 加载协议要点（dsh-client-modules）：bundle 脚本执行只 REGISTER 工厂；
// 工厂在 materialization（首次 import/require）时执行并 memoized；apply 是否
// 被 cordis client Entry 调用没有可靠保证，因此 **启动不依赖 apply**——工厂
// 体内直接 start()（带幂等标记）。
//
// 机制：
//   1. MutationObserver 观察 documentElement，等待设置页模型商行列表出现
//      （ul[class*="_rows"]，CSS module 哈希变化免疫），React 重渲染后自动
//      重新取数，无需改动核心 bundle。
//   2. 行为一类名稳定后缀（"_rowCard"/"_rowName"）匹配；行开启原生 HTML5
//      draggable；input/button/select/textarea/链接上按压不误触发。
//   3. 释放后按行内 displayName 匹配 GET /dsh-provider-order/providers 的
//      全量列表 → provider id 序，PUT /dsh-provider-order/order 持久化；
//      host 侧重排 LlmRuntime 两个 Map 并广播 llm/adapters-updated。
//   4. 绑定成功时在列表上方插入一个品牌指示条（可随时删除），确认生效。

(function () {
  const CSS_TAG = "@dsh-external/dsh-provider-order/dnd.css";
  const BADGE_TAG = "@dsh-external/dsh-provider-order/badge";
  const CSS = [
    '[class*="_rowCard"]{cursor:grab}',
    '[class*="_rowCard"].dpo-dragging{opacity:.45}',
    '[class*="_rowCard"].dpo-over{border-color:var(--dsw-alias-brand-primary,#3964fe);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#3964fe)}',
    '[class*="_rowCard"] input,[class*="_rowCard"] button,[class*="_rowCard"] select,[class*="_rowCard"] textarea{cursor:auto}',
  ].join("");
  const BADGE_HTML =
    '<div style="display:flex;align-items:center;gap:6px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary,#8a8f98);padding:4px 0 8px;">' +
    '<span style="opacity:.8;">⇅</span><span>拖拽排序（provider-order）</span>' +
    "</div>";

  function injectCss() {
    if (typeof document === "undefined") return;
    if (!document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]')) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "@dsh-external/dsh-provider-order";
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      (document.head || document.documentElement).appendChild(tag);
    }
  }

  function fetchJson(url, options) {
    return window.fetch(url, options || {}).then(
      (response) => response.json().catch(() => ({})),
    );
  }

  function rowCardsOf(ul) {
    return Array.prototype.slice.call(ul.querySelectorAll('li[class*="_rowCard"]'));
  }

  // 用行内 displayName 文本匹配 providers 列表，取回 provider id。
  function providerIdOf(row, providers) {
    const nameEl = row.querySelector('[class*="_rowName"]');
    if (!nameEl) return null;
    const name = (nameEl.textContent || "").trim();
    if (!name) return null;
    for (let i = 0; i < providers.length; i++) {
      if (providers[i].displayName === name) return providers[i].provider;
    }
    return null;
  }

  function persistOrder(ids) {
    const options = {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: ids }),
    };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      options.signal = AbortSignal.timeout(5000);
    }
    return fetchJson("/dsh-provider-order/order", options);
  }

  // 事件委托：一次绑定，React 增删/重排行不会产生重复监听。
  function bindRows(ul) {
    if (ul.dataset.dpoBound === "1") return;
    ul.dataset.dpoBound = "1";

    // 品牌指示条：确认插件已生效（仅设置页模型商列表出现时插入一次）。
    if (ul.parentNode && !ul.parentNode.querySelector('[data-plugin-badge="' + BADGE_TAG + '"]')) {
      const badge = document.createElement("div");
      badge.dataset.pluginBadge = BADGE_TAG;
      badge.innerHTML = BADGE_HTML;
      ul.parentNode.insertBefore(badge, ul);
    }

    let dragFrom = null;
    let overRow = null;

    const clearVisuals = () => {
      if (overRow) {
        overRow.classList.remove("dpo-over");
        overRow = null;
      }
      if (dragFrom) {
        dragFrom.classList.remove("dpo-dragging");
        dragFrom = null;
      }
    };

    ul.addEventListener("dragstart", (event) => {
      const row = event.target.closest
        ? event.target.closest('li[class*="_rowCard"]')
        : null;
      if (!row || row.parentNode !== ul) return;
      if (event.target.closest && event.target.closest("input,button,textarea,select,a")) {
        event.preventDefault();
        return;
      }
      dragFrom = row;
      dragFrom.classList.add("dpo-dragging");
      try {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", "dsh-provider-order");
      } catch (_) {}
    });

    ul.addEventListener("dragover", (event) => {
      const row = event.target.closest
        ? event.target.closest('li[class*="_rowCard"]')
        : null;
      if (!dragFrom || !row || row === dragFrom) return;
      event.preventDefault();
      try {
        event.dataTransfer.dropEffect = "move";
      } catch (_) {}
      if (overRow && overRow !== row) overRow.classList.remove("dpo-over");
      overRow = row;
      overRow.classList.add("dpo-over");
    });

    ul.addEventListener("dragleave", (event) => {
      const related = event.relatedTarget;
      if (related && ul.contains(related)) return;
      if (overRow) {
        overRow.classList.remove("dpo-over");
        overRow = null;
      }
    });

    ul.addEventListener("drop", (event) => {
      event.preventDefault();
      const target = overRow || (event.target.closest
        ? event.target.closest('li[class*="_rowCard"]')
        : null);
      if (overRow) {
        overRow.classList.remove("dpo-over");
        overRow = null;
      }
      if (!dragFrom || !target || target === dragFrom) {
        if (dragFrom) dragFrom.classList.remove("dpo-dragging");
        dragFrom = null;
        return;
      }
      try {
        ul.insertBefore(dragFrom, target);
      } catch (_) {}
      const providers = ul.__dpoProviders || [];
      const ids = rowCardsOf(ul)
        .map((row) => providerIdOf(row, providers))
        .filter((id) => typeof id === "string");
      if (dragFrom) dragFrom.classList.remove("dpo-dragging");
      dragFrom = null;
      if (ids.length === 0) {
        if (typeof console !== "undefined") console.warn("[dsh-provider-order] 未取到 provider id（displayName 映射失败）");
        return;
      }
      persistOrder(ids).then((json) => {
        if (!json || json.ok !== true) {
          if (typeof console !== "undefined") {
            console.warn("[dsh-provider-order] 保存顺序失败:", json && json.error);
          }
        }
      });
    });

    ul.addEventListener("dragend", clearVisuals);
  }

  let started = false;

  function start() {
    if (started) return;
    started = true;
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    injectCss();

    let timer = null;
    let failCount = 0;

    const refresh = () => {
      const uls = document.querySelectorAll('ul[class*="_rows"]');
      if (uls.length === 0) return;
      const ul = uls[uls.length - 1];
      fetchJson("/dsh-provider-order/providers")
        .then((json) => {
          failCount = 0;
          const providers = (json && json.providers) || [];
          if (providers.length > 0) {
            ul.__dpoProviders = providers;
            bindRows(ul);
          }
        })
        .catch(() => {
          failCount += 1;
          if (failCount < 20) setTimeout(refresh, 1500);
        });
    };

    // documentElement 先就位即观察；body 产生后由 mutation 驱动 refresh。
    const root = document.documentElement || document.body;
    if (!root) {
      window.addEventListener("DOMContentLoaded", start, { once: true });
      return;
    }
    const observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 500);
    });
    observer.observe(root, { childList: true, subtree: true });
    refresh();
    // 兜底轮询：即使 observer 错失首帧也尽量绑定。
    setTimeout(refresh, 1200);
  }

  window.__ModuleLoader__.load({
    id: "@dsh-external/dsh-provider-order",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;

      function apply() {
        start();
      }

      const plugin = {
        name: "provider-order",
        inject: [],
        apply,
      };

      // 启动不依赖 apply：材料化即尝试（幂等）。
      start();

      exports.default = plugin;
      exports.name = plugin.name;
      exports.inject = plugin.inject;
      exports.apply = plugin.apply;

      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      return module.exports;
    },
  });
})();