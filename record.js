const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const TARGET_URL = process.argv[2] || "https://httpbin.org/get";
const OUTPUT_DIR = path.join(__dirname, "recordings");
let seq = 0;

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const records = [];

  function record(data) {
    data._id = ++seq;
    data.timeStamp = Date.now();
    records.push(data);
  }

  // ── 1. 拦截所有 HTTP 请求（浏览器级）──────────────────

  page.on("request", (req) => {
    const entry = {
      source: "webRequest",
      url: req.url(),
      method: req.method(),
      type: req.resourceType(),
      requestHeaders: req.headers(),
      postData: req.postData() || null,
    };
    try {
      if (entry.postData) entry.requestBody = JSON.parse(entry.postData);
    } catch {}
    record(entry);
  });

  page.on("response", async (resp) => {
    const req = resp.request();
    // 找到对应的记录并补全
    const match = records.find(
      (r) => r.url === req.url() && r.method === req.method() && !r.statusCode
    );
    if (match) {
      match.statusCode = resp.status();
      match.responseHeaders = resp.headers();
    }

    // xhr/fetch 类型尝试读取响应体
    if (
      ["xhr", "fetch"].includes(req.resourceType()) ||
      req.resourceType() === "document"
    ) {
      try {
        const body = await resp.text();
        match.responseBody = body.length > 5000 ? body.substring(0, 5000) + "..." : body;
        try {
          match.responseBody = JSON.parse(match.responseBody);
        } catch {}
      } catch {}
    }
  });

  // ── 2. 注入 content script 拦截 XHR/fetch ──────────────

  await page.addInitScript(() => {
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input.url;
      const method = (init && init.method) || "GET";
      const start = performance.now();

      return origFetch.apply(this, arguments).then((resp) => {
        const clone = resp.clone();
        clone.text().then((body) => {
          console.log(
            "__RECORD__" +
              JSON.stringify({
                source: "fetch",
                url,
                method,
                statusCode: resp.status,
                duration: Math.round(performance.now() - start),
                requestBody: init?.body
                  ? typeof init.body === "string"
                    ? init.body
                    : "[FormData/Blob]"
                  : null,
                responseBody: body
                  ? body.length > 3000
                    ? body.substring(0, 3000) + "..."
                    : body
                  : null,
              })
          );
        }).catch(() => {});
        return resp;
      });
    };

    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    const origSend = XHR.send;
    XHR.open = function (method, url) {
      this.__rec = { method, url };
      return origOpen.apply(this, arguments);
    };
    XHR.send = function (body) {
      const rec = this.__rec;
      if (rec) {
        rec.start = performance.now();
        rec.requestBody = body instanceof FormData
          ? "[FormData]"
          : typeof body === "string"
          ? body
          : body;
        this.addEventListener("loadend", function () {
          console.log(
            "__RECORD__" +
              JSON.stringify({
                source: "xhr",
                url: rec.url,
                method: rec.method,
                statusCode: this.status,
                duration: Math.round(performance.now() - rec.start),
                requestBody: rec.requestBody,
                responseBody: this.responseText
                  ? this.responseText.length > 3000
                    ? this.responseText.substring(0, 3000) + "..."
                    : this.responseText
                  : null,
              })
          );
        });
      }
      return origSend.apply(this, arguments);
    };
  });

  // 监听 content script 的 console 消息
  page.on("console", (msg) => {
    if (msg.text().startsWith("__RECORD__")) {
      try {
        const data = JSON.parse(msg.text().replace("__RECORD__", ""));
        record(data);
      } catch {}
    }
  });

  // ── 3. 监听 DOM 级网络请求 ──────────────────────────────

  await page.addInitScript(() => {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const tag = node.tagName;
          const src =
            node.src || node.href || node.getAttribute("data-src") || "";
          if (
            src &&
            ["SCRIPT", "IMG", "IFRAME", "LINK", "VIDEO"].includes(tag)
          ) {
            console.log(
              "__RECORD__" +
                JSON.stringify({
                  source: "dom",
                  url: src,
                  tag,
                  cause: "DOM动态插入",
                })
            );
          }
        }
      }
    });
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "href"],
      });
    }
  });

  // ── 4. 导航到目标页面 ──────────────────────────────────

  console.log(`[记录中] 打开: ${TARGET_URL}`);
  await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // ── 5. 输出结果 ────────────────────────────────────────

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(OUTPUT_DIR, `recording-${ts}.json`);
  fs.writeFileSync(outFile, JSON.stringify(records, null, 2));
  console.log(`[完成] ${records.length} 条请求 → ${outFile}`);

  await browser.close();
})();
