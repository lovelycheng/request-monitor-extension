(function () {
  "use strict";

  // ════════════════════════════════════════════════════
  //  双通道发送：sendMessage (快) + storage 直写 (稳)
  //  MV3 Service Worker 随时可能被 kill/重启，
  //  纯消息通道不可靠，storage 作为兜底
  // ════════════════════════════════════════════════════

  const PAGE_URL = location.href; // 当前页面 URL，给 action 记录用

  function sendToBackground(data) {
    // 通道 1: sendMessage（实时，popup 轮询用）
    // try/catch 必须：插件重载/更新后 chrome.runtime.sendMessage 会同步抛出
    // "Extension context invalidated"，.catch() 无法捕获同步异常
    try {
      chrome.runtime.sendMessage(data).catch(err => {
        console.error('[RM] sendMessage failed:', err.message);
      });
    } catch (e) {
      // Extension context invalidated — 静默，通道 2 会兜底
    }

    // 通道 2: storage 直写（可靠，SW 重启也不丢）
    // 只对 action 类型做存储兜底，XHR/fetch 由 webRequest 兜底
    if (data.type === "USER_CLICK" || data.type === "USER_INPUT" || data.type === "USER_SUBMIT") {
      try {
        const actionRecord = normalizeAction(data, PAGE_URL);
        const key = 'rm_action_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        chrome.storage.local.set({ [key]: actionRecord }, () => {
          if (chrome.runtime.lastError) {
            console.error('[RM] storage write failed:', chrome.runtime.lastError.message);
          }
        });
      } catch (e) {
        console.error('[RM] storage fallback failed:', e.message);
      }
    }
  }

  // 将 content 消息格式标准化为 persistRequest 用的记录格式
  function normalizeAction(msg, pageUrl) {
    const base = {
      source: "action",
      url: pageUrl,  // ← 用当前页面 URL，不再是 null
      timeStamp: msg.data.timeStamp || Date.now(),
    };
    switch (msg.type) {
      case "USER_CLICK":
        return { ...base, action: "click", tag: msg.data.tag, selector: msg.data.selector,
          id: msg.data.id, name: msg.data.name, className: msg.data.className,
          placeholder: msg.data.placeholder, text: msg.data.text, type: msg.data.type,
          href: msg.data.href };
      case "USER_INPUT":
        return { ...base, action: "input", tag: msg.data.tag, selector: msg.data.selector,
          id: msg.data.id, name: msg.data.name, placeholder: msg.data.placeholder,
          value: msg.data.value };
      case "USER_SUBMIT":
        return { ...base, action: "submit", selector: msg.data.selector,
          formAction: msg.data.action, method: msg.data.method };
      default:
        return base;
    }
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
    console.log('[RM] click:', el.tagName, el.id || (el.className && typeof el.className === 'string' ? el.className.substring(0,30) : ''));
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
  //  网络拦截：XHR / fetch
  //  响应体提取为纯函数（便于单测）；消息携带发起时间
  //  initiatedAt，对齐 background 的 webRequest 合并窗口，
  //  避免慢请求(>2s)合并失败导致 responseBody 丢失。
  // ════════════════════════════════════════════════════

  // ── 响应体提取（纯函数） ───────────────────────────
  // responseType 非 text 时 responseText 不可访问，用 response 兜底
  function extractResponseBody(xhr) {
    try {
      const rt = xhr.responseType;
      let raw = null;
      if (rt === "" || rt === "text" || rt == null) {
        raw = xhr.responseText;
      } else if (xhr.response != null) {
        if (xhr.response instanceof ArrayBuffer) {
          raw = new TextDecoder("utf-8").decode(new Uint8Array(xhr.response));
        } else if (typeof xhr.response === "string") {
          raw = xhr.response;
        } else {
          raw = String(xhr.response);
        }
      }
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return raw.substring(0, 2000); }
    } catch {
      return null;
    }
  }

  function extractFetchResponseBody(body) {
    if (!body) return null;
    try { return JSON.parse(body); } catch { return body.substring(0, 2000); }
  }

  function buildXhrCompleteData(m, xhr, initiatedAt) {
    return {
      url: m.url,
      method: m.method,
      statusCode: xhr.status,
      duration: m.duration,
      requestBody: m.requestBody,
      responseBody: extractResponseBody(xhr),
      stack: m.stack,
      timeStamp: initiatedAt,
    };
  }

  function buildFetchCompleteData(url, method, resp, body, init, initiatedAt, duration) {
    return {
      url,
      method,
      statusCode: resp.status,
      duration,
      requestBody: init && init.body ? String(init.body) : null,
      responseBody: extractFetchResponseBody(body),
      timeStamp: initiatedAt,
    };
  }

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
      const initiatedAt = Date.now();
      m.start = performance.now();
      this.addEventListener("loadend", function () {
        m.statusCode = this.status;
        m.duration = Math.round(performance.now() - m.start);
        sendToBackground({ type: "XHR_COMPLETE", data: buildXhrCompleteData(m, this, initiatedAt) });
      });
    }
    return origXHRSend.apply(this, arguments);
  };

  // ── fetch ───────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    const method = (init && init.method) || "GET";
    const initiatedAt = Date.now();
    const start = performance.now();
    return origFetch.apply(this, arguments).then((resp) => {
      const clone = resp.clone();
      const dur = Math.round(performance.now() - start);
      clone.text().then((body) => {
        sendToBackground({ type: "FETCH_COMPLETE", data: buildFetchCompleteData(url, method, resp, body, init, initiatedAt, dur) });
      }).catch(() => {
        // body 读取失败也要发消息（responseBody=null），避免请求记录丢失
        sendToBackground({ type: "FETCH_COMPLETE", data: buildFetchCompleteData(url, method, resp, null, init, initiatedAt, dur) });
      });
      return resp;
    }).catch((err) => {
      sendToBackground({ type: "FETCH_ERROR", data: { url, method, error: err.message, timeStamp: initiatedAt } });
      throw err;
    });
  };

  // ── DOM 动态插入的资源已由 webRequest 在 background 层统一捕获,
  //    MutationObserver 会产生大量与用户操作无关的噪音（广告、埋点、懒加载等），故移除。
  //    如需恢复，取消下方注释即可。
  //
  // function extractSrc(el) { ... }
  // function checkAddedNodes(nodes, cause) { ... }
  // const mo = new MutationObserver((mutations) => { for (const m of mutations) checkAddedNodes(m.addedNodes, "DOM插入"); });
  // if (document.documentElement) {
  //   mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "href", "data-src"] });
  // } else {
  //   document.addEventListener("DOMContentLoaded", () => { mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "href", "data-src"] }); }, { once: true });
  // }
})();
