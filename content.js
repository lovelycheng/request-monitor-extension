(function () {
  "use strict";

  function sendToBackground(data) {
    try {
      chrome.runtime.sendMessage(data).catch(() => {});
    } catch {}
  }

  // ════════════════════════════════════════════════════
  //  元素定位：生成可用于回放的 CSS selector
  // ════════════════════════════════════════════════════

  function buildSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return null;

    // 优先级: id > name > unique class > nth-child path
    if (el.id && !/^\d/.test(el.id) && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) {
      return "#" + CSS.escape(el.id);
    }

    if (el.name && document.querySelectorAll(`[name="${el.name}"]`).length === 1) {
      return `[name="${el.name}"]`;
    }

    if (el.getAttribute("aria-label")) {
      const sel = `[aria-label="${el.getAttribute("aria-label")}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    if (el.getAttribute("data-testid")) {
      const sel = `[data-testid="${el.getAttribute("data-testid")}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    if (el.placeholder) {
      return `[placeholder="${el.placeholder}"]`;
    }

    // 文本按钮/链接
    if (["BUTTON", "A", "SPAN", "DIV"].includes(el.tagName)) {
      const text = (el.textContent || "").trim().substring(0, 30);
      if (text && text.length > 0) {
        const sel = `${el.tagName.toLowerCase()}:has-text("${text}")`;
        // 仅 Playwright 用 :has-text，这里同时存原生备选
        return sel;
      }
    }

    // class 路径
    const classes = Array.from(el.classList).filter((c) => c && !/^\d/.test(c)).slice(0, 3);
    if (classes.length > 0) {
      const sel = el.tagName.toLowerCase() + "." + classes.map((c) => CSS.escape(c)).join(".");
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    // nth-child 路径（最后手段）
    const path = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) { path.unshift("#" + CSS.escape(cur.id)); break; }
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (siblings.length > 1) {
          part += ":nth-child(" + (Array.from(parent.children).indexOf(cur) + 1) + ")";
        }
      }
      path.unshift(part);
      cur = cur.parentElement;
    }
    return path.join(" > ");
  }

  function getElInfo(el) {
    return {
      selector: buildSelector(el),
      tag: el.tagName,
      id: el.id || null,
      name: el.name || null,
      className: el.className && typeof el.className === "string" ? el.className.substring(0, 100) : null,
      type: el.type || null,
      placeholder: el.placeholder || null,
      text: (el.textContent || "").trim().substring(0, 60),
      href: el.href || null,
      value: el.value !== undefined ? String(el.value).substring(0, 200) : null,
    };
  }

  // ════════════════════════════════════════════════════
  //  用户交互：click
  // ════════════════════════════════════════════════════

  document.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    const el = e.target;
    if (!el || !el.tagName) return;
    const tag = el.tagName;
    const isInteractive =
      tag === "BUTTON" || tag === "A" || tag === "INPUT" ||
      tag === "SELECT" || tag === "TEXTAREA" || tag === "LABEL" ||
      (tag === "SPAN" || tag === "DIV") && (el.onclick || el.getAttribute("onclick") ||
        el.getAttribute("role") === "button" || el.classList.contains("btn") ||
        el.closest("button,a,[role=button]"));
    if (["HTML", "BODY", "MAIN", "HEADER", "FOOTER", "NAV", "UL", "OL", "LI", "P", "TR", "TD", "TH", "TABLE", "SECTION", "ARTICLE"].includes(tag)) return;
    if (!isInteractive && tag !== "SVG" && !el.closest("button,a,input,select,textarea,[role=button]")) return;

    const realTarget = el.closest("button,a,input,select,textarea,[role=button]") || el;
    sendToBackground({
      type: "USER_CLICK",
      data: { ...getElInfo(realTarget), timeStamp: Date.now() },
    });
  }, true);

  // ════════════════════════════════════════════════════
  //  用户交互：input
  // ════════════════════════════════════════════════════

  document.addEventListener("input", (e) => {
    if (!e.isTrusted) return;
    const el = e.target;
    if (!el || !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
    sendToBackground({
      type: "USER_INPUT",
      data: { ...getElInfo(el), value: el.value ? String(el.value).substring(0, 500) : "", timeStamp: Date.now() },
    });
  }, true);

  // ════════════════════════════════════════════════════
  //  用户交互：form submit
  // ════════════════════════════════════════════════════

  document.addEventListener("submit", (e) => {
    if (!e.isTrusted) return;
    const form = e.target;
    if (!form || !form.tagName || form.tagName !== "FORM") return;
    sendToBackground({
      type: "USER_SUBMIT",
      data: {
        selector: buildSelector(form),
        action: form.action,
        method: (form.method || "GET").toUpperCase(),
        timeStamp: Date.now(),
      },
    });
  }, true);

  // ════════════════════════════════════════════════════
  //  已有的网络拦截逻辑（保持不变）
  // ════════════════════════════════════════════════════

  // ── XMLHttpRequest ──────────────────────────────────
  const XHR = XMLHttpRequest.prototype;
  const origXHROpen = XHR.open;
  XHR.open = function (method, url) {
    this._monitor = { method, url };
    return origXHROpen.apply(this, arguments);
  };
  const origXHRSend = XHR.send;
  XHR.send = function (body) {
    const m = this._monitor;
    if (m) {
      m.requestBody = body instanceof FormData ? Object.fromEntries(body.entries()) : body instanceof Document ? "XML Document" : typeof body === "string" ? body : body;
      m.start = performance.now();
      this.addEventListener("loadend", function () {
        m.statusCode = this.status;
        m.duration = Math.round(performance.now() - m.start);
        sendToBackground({ type: "XHR_COMPLETE", data: m });
      });
    }
    return origXHRSend.apply(this, arguments);
  };

  // ── fetch ───────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    const method = (init && init.method) || "GET";
    const start = performance.now();
    return origFetch.apply(this, arguments).then((resp) => {
      const clone = resp.clone();
      const dur = Math.round(performance.now() - start);
      clone.text().then((body) => {
        let parsed = body;
        try { parsed = JSON.parse(body); } catch {}
        sendToBackground({
          type: "FETCH_COMPLETE",
          data: { url, method, statusCode: resp.status, duration: dur, requestBody: init?.body ? String(init.body) : null, responseBody: typeof parsed === "object" ? parsed : body.substring(0, 2000) },
        });
      }).catch(() => {});
      return resp;
    }).catch((err) => {
      sendToBackground({ type: "FETCH_ERROR", data: { url, method, error: err.message } });
      throw err;
    });
  };

  // ── DOM mutation ────────────────────────────────────
  function extractSrc(el) {
    const tag = el.tagName;
    if (!tag) return null;
    const src = el.src || el.href || el.getAttribute("src") || el.getAttribute("href") || el.getAttribute("data-src") || "";
    if (src && ["SCRIPT", "IMG", "IFRAME", "LINK", "VIDEO", "AUDIO", "SOURCE", "EMBED", "OBJECT"].includes(tag)) return { tag, src };
    return null;
  }
  function checkAddedNodes(nodes, cause) {
    for (const node of nodes) {
      if (node.nodeType !== 1) continue;
      const info = extractSrc(node);
      if (info) sendToBackground({ type: "DOM_TRIGGERED_REQUEST", data: { tag: info.tag, url: info.src, cause, timeStamp: Date.now() } });
      if (node.querySelectorAll) {
        node.querySelectorAll("script,img,iframe,link,video,audio,source,embed,object").forEach((c) => {
          const ci = extractSrc(c);
          if (ci) sendToBackground({ type: "DOM_TRIGGERED_REQUEST", data: { tag: ci.tag, url: ci.src, cause: cause + " (子元素)", timeStamp: Date.now() } });
        });
      }
    }
  }
  const mo = new MutationObserver((mutations) => { for (const m of mutations) checkAddedNodes(m.addedNodes, "DOM插入"); });
  if (document.documentElement) {
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "href", "data-src"] });
  } else {
    document.addEventListener("DOMContentLoaded", () => { mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "href", "data-src"] }); }, { once: true });
  }
})();
