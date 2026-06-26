const MAX_RECORDS = 500;
let requests = [];
let tabRequestMap = {};
let seq = 1;
let cookieJar = {};
let _stateRestored = false; // 标记 restoreState 是否已完成

// 静态资源类型：这些请求不录制（JS/CSS/图片/字体/媒体/WS/ping）
const SKIP_TYPES = new Set([
  "script",
  "stylesheet",
  "image",
  "font",
  "media",
  "websocket",
  "ping",
  "other",
]);

// ════════════════════════════════════════════════════
//  Service Worker 启动时从 storage 恢复状态
//  MV3 中 SW 随时可能被 kill，内存状态会丢失，
//  必须从 chrome.storage.local 恢复
//  修复：合并而非覆盖，避免覆盖异步期间到达的消息
// ════════════════════════════════════════════════════

function restoreState() {
  // 获取所有存储数据（requests + 分散的 rm_action_* 键）
  chrome.storage.local.get(null, (result) => {
    const existingIds = new Set(requests.map(r => r._id));
    const merged = [...requests]; // 保留已通过消息到达的记录

    // 1) 恢复 requests 数组
    if (result.requests && Array.isArray(result.requests)) {
      for (const r of result.requests) {
        if (!existingIds.has(r._id)) {
          merged.push(r);
          existingIds.add(r._id);
        }
      }
    }

    // 2) 扫描孤儿 rm_action_* 键（content.js 直写但未合并的）
    const orphanKeys = [];
    for (const [key, value] of Object.entries(result)) {
      if (key.startsWith('rm_action_') && value && typeof value === 'object') {
        const isDuplicate = merged.some(r =>
          r.source === value.source && r.action === value.action &&
          r.timeStamp === value.timeStamp && r.url === value.url
        );
        if (!isDuplicate) {
          value._id = 0; // 临时 _id，后续 persistRequest 会重新分配
          merged.push(value);
        }
        orphanKeys.push(key);
      }
    }

    // 排序 + 裁剪
    merged.sort((a, b) => (a.timeStamp || 0) - (b.timeStamp || 0));
    requests = merged.length > MAX_RECORDS ? merged.slice(-MAX_RECORDS) : merged;

    // 为没有 _id 的记录重新分配 _id
    for (const r of requests) {
      if (!r._id || r._id === 0) {
        r._id = nextId();
      }
    }

    // 恢复 seq
    const maxId = requests.reduce((max, r) => Math.max(max, r._id || 0), 0);
    if (maxId >= seq) seq = maxId + 1;

    // 清理孤儿键
    if (orphanKeys.length > 0) {
      chrome.storage.local.remove(orphanKeys);
    }

    // 持久化合并后的结果
    chrome.storage.local.set({ requests: requests.slice(-200) });

    _stateRestored = true;
  });
}

restoreState();

// ════════════════════════════════════════════════════
//  监听 storage 变化：content.js 直写的 rm_action_* 键
//  实时合并到 requests 中，避免轮询延迟
// ════════════════════════════════════════════════════

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;
  const keysToRemove = [];
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith('rm_action_')) continue;
    const record = change.newValue;
    if (!record || typeof record !== 'object') { keysToRemove.push(key); continue; }

    // 去重：已存在于 requests 中则跳过
    const isDuplicate = requests.some(r =>
      r.source === record.source && r.action === record.action &&
      r.timeStamp === record.timeStamp && r.url === record.url
    );
    if (!isDuplicate) {
      persistRequest(record);
    }
    keysToRemove.push(key);
  }
  // 异步清理，不阻塞
  if (keysToRemove.length > 0) {
    chrome.storage.local.remove(keysToRemove);
  }
});

function nextId() {
  return seq++;
}

function persistRequest(data) {
  // 合并同源记录：webRequest 没有 responseBody，XHR/fetch 有
  // 同一请求会同时被 webRequest 和 XHR/fetch 捕获，合并后只保留一条完整记录
  const networkSources = ["webRequest", "xhr", "fetch"];
  if (networkSources.includes(data.source) && data.url && data.method) {
    const timeWindow = 2000; // 2 秒内视为同一请求
    const existing = requests.find(r =>
      networkSources.includes(r.source) &&
      r.url === data.url &&
      r.method === data.method &&
      Math.abs((r.timeStamp || 0) - (data.timeStamp || 0)) < timeWindow
    );
    if (existing) {
      // 合并：用新数据补全缺失字段
      if (data.requestBody && !existing.requestBody) existing.requestBody = data.requestBody;
      if (data.responseBody && !existing.responseBody) existing.responseBody = data.responseBody;
      if (data.statusCode && !existing.statusCode) existing.statusCode = data.statusCode;
      if (data.duration && !existing.duration) existing.duration = data.duration;
      if (data.requestHeaders && !existing.requestHeaders) existing.requestHeaders = data.requestHeaders;
      if (data.responseHeaders && !existing.responseHeaders) existing.responseHeaders = data.responseHeaders;
      if (data.cookies && !existing.cookies) existing.cookies = data.cookies;
      if (data.ip && !existing.ip) existing.ip = data.ip;
      if (data.error && !existing.error) existing.error = data.error;
      if (data.stack && !existing.stack) existing.stack = data.stack;
      // 保留最早的 timeStamp
      if (data.timeStamp && existing.timeStamp && data.timeStamp < existing.timeStamp) {
        existing.timeStamp = data.timeStamp;
      }
      chrome.storage.local.set({ requests: requests.slice(-200) });
      return;
    }
  }

  data._id = nextId();
  requests.push(data);
  if (requests.length > MAX_RECORDS) {
    requests = requests.slice(-MAX_RECORDS);
  }
  chrome.storage.local.set({ requests: requests.slice(-200) });
}

function formatHeaders(headers) {
  if (!headers) return {};
  const result = {};
  headers.forEach((h) => {
    result[h.name] = h.value;
  });
  return result;
}

// ════════════════════════════════════════════════════
//  webRequest 层捕获（所有浏览器级别请求）
// ════════════════════════════════════════════════════

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;            // 过滤非标签页请求
    if (SKIP_TYPES.has(details.type)) return;  // 过滤静态资源（JS/CSS/图片/字体等）
    const record = {
      source: "webRequest",
      url: details.url,
      method: details.method,
      type: details.type,
      timeStamp: details.timeStamp,
      tabId: details.tabId,
      requestBody: details.requestBody
        ? parseRequestBody(details.requestBody)
        : null,
      frameType: details.frameType || "main_frame",
      fromCache: false,
    };
    tabRequestMap[details.requestId] = record;
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

chrome.webRequest.onBeforeSendHeaders &&
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const record = tabRequestMap[details.requestId];
      if (record) {
        record.requestHeaders = formatHeaders(details.requestHeaders);
      }
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders"]
  );

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const record = tabRequestMap[details.requestId];
    if (!record) return;
    record.statusCode = details.statusCode;
    const headers = details.responseHeaders ? formatHeaders(details.responseHeaders) : null;
    record.responseHeaders = headers;
    // 提取 Set-Cookie
    if (headers && headers["set-cookie"]) {
      record.cookies = parseCookies(headers["set-cookie"]);
      mergeCookie(record.url, record.cookies);
    }
    record.fromCache = details.fromCache;
    record.ip = details.ip;
    persistRequest(record);
    delete tabRequestMap[details.requestId];
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const record = tabRequestMap[details.requestId];
    if (record) {
      record.statusCode = 0;
      record.error = details.error;
      persistRequest(record);
      delete tabRequestMap[details.requestId];
    }
  },
  { urls: ["<all_urls>"] }
);

function parseRequestBody(body) {
  if (!body) return null;
  try {
    if (body.raw) {
      const raw = body.raw[0];
      if (raw && raw.bytes) {
        const text = new TextDecoder("utf-8").decode(
          new Uint8Array(raw.bytes)
        );
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
    }
    if (body.formData) return body.formData;
    return null;
  } catch {
    return null;
  }
}

function parseCookies(setCookie) {
  try {
    const val = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!val) return [];
    return val.split(";").map((part) => {
      const [name, ...rest] = part.trim().split("=");
      return { name: name.trim(), value: (rest.join("=") || "").trim() };
    });
  } catch {
    return [];
  }
}

function mergeCookie(url, cookies) {
  if (!cookies || cookies.length === 0) return;
  try {
    const hostname = new URL(url).hostname;
    for (const c of cookies) {
      if (!c.name || !c.value) continue;
      if (!cookieJar[hostname]) cookieJar[hostname] = {};
      cookieJar[hostname][c.name] = c;
    }
  } catch {}
}

// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case "GET_REQUESTS":
      sendResponse({ requests });
      break;

    case "CLEAR_REQUESTS":
      requests = [];
      tabRequestMap = {};
      seq = 1;
      chrome.storage.local.set({ requests: [] });
      sendResponse({ success: true });
      break;

    case "EXPORT_REQUESTS":
      {
        const blob = new Blob([JSON.stringify(requests, null, 2)], {
          type: "application/json",
        });
        chrome.downloads.download({
          url: URL.createObjectURL(blob),
          filename: `requests-${Date.now()}.json`,
          saveAs: true,
        });
        sendResponse({ success: true });
      }
      break;

    case "EXPORT_SCRIPT":
      {
        const selectedIds = msg.selectedIds || [];
        const records = selectedIds.length
          ? requests.filter((r) => selectedIds.includes(r._id))
          : requests;
        const script = buildPlaywrightScript(records);
        const blob = new Blob([script], { type: "text/javascript" });
        chrome.downloads.download({
          url: URL.createObjectURL(blob),
          filename: `playwright-script-${Date.now()}.js`,
          saveAs: true,
        });
        sendResponse({ success: true });
      }
      break;

    case "EXPORT_SESSION":
      {
        chrome.cookies.getAll({}, (cookies) => {
          const state = {
            cookies: cookies.map((c) => ({
              name: c.name,
              value: c.value,
              domain: c.domain.startsWith(".") ? c.domain.substring(1) : c.domain,
              path: c.path,
              expires: c.expirationDate,
              httpOnly: c.httpOnly,
              secure: c.secure,
              sameSite: c.sameSite === "no_restriction" ? "None" : c.sameSite === "lax" ? "Lax" : "Strict",
            })),
            origins: [],
          };
          const blob = new Blob([JSON.stringify(state, null, 2)], {
            type: "application/json",
          });
          chrome.downloads.download({
            url: URL.createObjectURL(blob),
            filename: "browser-state.json",
            saveAs: true,
          });
          sendResponse({ success: true, count: state.cookies.length });
        });
      }
      break;

    // ── content.js 上报的消息 ────────────────────────

    case "XHR_COMPLETE":
    case "FETCH_COMPLETE":
      persistRequest({
        source: msg.type === "XHR_COMPLETE" ? "xhr" : "fetch",
        url: msg.data.url,
        method: msg.data.method,
        statusCode: msg.data.statusCode,
        duration: msg.data.duration,
        requestBody: msg.data.requestBody,
        responseBody: msg.data.responseBody,
        stack: msg.data.stack,
        timeStamp: msg.data.timeStamp || Date.now(),
      });
      sendResponse({ success: true });
      break;

    case "FETCH_ERROR":
      persistRequest({
        source: "fetch",
        url: msg.data.url,
        method: msg.data.method,
        statusCode: 0,
        error: msg.data.error,
        timeStamp: msg.data.timeStamp || Date.now(),
      });
      sendResponse({ success: true });
      break;

    case "DOM_TRIGGERED_REQUEST":
      persistRequest({
        source: "dom",
        url: msg.data.url,
        tag: msg.data.tag,
        cause: msg.data.cause,
        timeStamp: msg.data.timeStamp || Date.now(),
      });
      sendResponse({ success: true });
      break;

    case "USER_CLICK":
      persistRequest({
        source: "action",
        action: "click",
        tag: msg.data.tag,
        selector: msg.data.selector,
        id: msg.data.id,
        name: msg.data.name,
        placeholder: msg.data.placeholder,
        text: msg.data.text,
        type: msg.data.type,
        timeStamp: msg.data.timeStamp || Date.now(),
        url: msg.data.href || null,
      });
      sendResponse({ success: true });
      break;

    case "USER_INPUT":
      persistRequest({
        source: "action",
        action: "input",
        tag: msg.data.tag,
        selector: msg.data.selector,
        id: msg.data.id,
        name: msg.data.name,
        placeholder: msg.data.placeholder,
        value: msg.data.value,
        timeStamp: msg.data.timeStamp || Date.now(),
        url: null,
      });
      sendResponse({ success: true });
      break;

    case "USER_SUBMIT":
      persistRequest({
        source: "action",
        action: "submit",
        selector: msg.data.selector,
        url: msg.data.action,
        method: msg.data.method,
        timeStamp: msg.data.timeStamp || Date.now(),
      });
      sendResponse({ success: true });
      break;

    case "EVENT_TRIGGERED_REQUEST":
      persistRequest({
        source: "event",
        url: msg.data.url,
        method: msg.data.method,
        event: msg.data.event,
        tag: msg.data.tag,
        timeStamp: msg.data.timeStamp || Date.now(),
      });
      sendResponse({ success: true });
      break;
  }
  return true;
});

// ════════════════════════════════════════════════════
//  导出为 Playwright 脚本
// ════════════════════════════════════════════════════

function buildPlaywrightScript(records) {
  const lines = [];
  lines.push(`const { chromium } = require("playwright");`);
  lines.push(`const fs = require("fs");`);
  lines.push(`const STORAGE_FILE = "browser-state.json";`);
  lines.push(``);
  lines.push(`(async () => {`);
  lines.push(`  const browser = await chromium.launch({ headless: false });`);
  lines.push(``);
  lines.push(`  // 如果有上次保存的登录状态，直接恢复（跳过重新登录）`);
  lines.push(`  const storageState = fs.existsSync(STORAGE_FILE)`);
  lines.push(`    ? JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8"))`);
  lines.push(`    : {};`);
  lines.push(`  const context = await browser.newContext({ storageState: fs.existsSync(STORAGE_FILE) ? STORAGE_FILE : undefined });`);
  lines.push(`  const page = await context.newPage();`);
  lines.push(``);

  // 内嵌插件 cookieJar（录制过程中从 Set-Cookie 积累）
  const allCookies = [];
  for (const [domain, cookies] of Object.entries(cookieJar)) {
    for (const [, c] of Object.entries(cookies)) {
      allCookies.push({ domain, name: c.name, value: c.value, path: c.path || "/", httpOnly: c.httpOnly, secure: c.secure });
    }
  }
  if (allCookies.length > 0) {
    lines.push(`  // 从录制中提取的 cookies（共 ${allCookies.length} 个）`);
    lines.push(`  const recordedCookies = ${JSON.stringify(allCookies)};`);
    lines.push(`  await context.addCookies(recordedCookies);`);
    lines.push(``);
  }

  // 主入口 URL（第一个 main_frame 或第一个请求）
  const firstPage = records.find(
    (r) => r.type === "main_frame" || r.action === "click"
  );
  const firstUrl = firstPage
    ? firstPage.url
    : records.find((r) => r.url)?.url;

  if (firstUrl) {
    lines.push(`  await page.goto("${firstUrl}", { waitUntil: "domcontentloaded", timeout: 30000 });`);
    lines.push(`  await page.waitForTimeout(2000);`);
    lines.push(``);
  }

  // 按时间排序后依次重放
  const sorted = [...records].sort(
    (a, b) => (a.timeStamp || 0) - (b.timeStamp || 0)
  );

  for (const r of sorted) {
    if (r.source === "action") {
      if (r.action === "click") {
        const loc = buildLocator(r);
        lines.push(`  // 点击 ${r.selector || r.text || r.tag}`);
        lines.push(`  await ${loc}.click();`);
        lines.push(`  await page.waitForTimeout(500);`);
      } else if (r.action === "input") {
        const loc = buildLocator(r);
        const val = (r.value || "").replace(/`/g, "\\`").replace(/\$/g, "\\$");
        lines.push(`  // 输入 ${r.selector || r.placeholder || r.tag}`);
        lines.push(`  await ${loc}.fill(\`${val}\`);`);
      }
    } else if (r.source === "webRequest" || r.source === "xhr" || r.source === "fetch") {
      const method = r.method || "GET";
      if (method === "GET" && !r.requestBody) continue;
      const url = r.url.replace(/'/g, "\\'");
      let body = "null";
      if (r.requestBody) {
        if (typeof r.requestBody === "object") {
          body = `JSON.stringify(${JSON.stringify(r.requestBody)})`;
        } else {
          const s = String(r.requestBody).replace(/'/g, "\\'").replace(/\n/g, "\\n");
          body = `'${s}'`;
        }
      }
      lines.push(`  // [${r.source}] ${r.statusCode || "?"} ${method} ${url.substring(0, 80)}`);
      lines.push(`  await page.evaluate(async () => {`);
      lines.push(`    await fetch('${url}', { method: '${method}', body: ${body} });`);
      lines.push(`  });`);
    }
    lines.push(``);
  }

  lines.push(`  // 保存登录状态（cookies + localStorage），下次运行可复用`);
  lines.push(`  const state = await context.storageState();`);
  lines.push(`  fs.writeFileSync(STORAGE_FILE, JSON.stringify(state, null, 2));`);
  lines.push(`  console.log("[完成] 浏览器状态已保存到 " + STORAGE_FILE);`);
  lines.push(``);
  lines.push(`  // 不自动关闭，保留登录态供调试`);
  lines.push(`  // await browser.close();`);
  lines.push(`})();`);
  return lines.join("\n");
}

function buildLocator(r) {
  if (r.selector) {
    if (r.selector.startsWith("#")) return `page.locator("${r.selector}")`;
    if (r.selector.startsWith("[name=")) return `page.locator('${r.selector}')`;
    if (r.selector.includes(":has-text")) {
      const m = r.selector.match(/:has-text\("(.+)"\)/);
      if (m) return `page.getByText("${m[1]}")`;
    }
    return `page.locator("${r.selector}")`;
  }
  if (r.id) return `page.locator("#${r.id}")`;
  if (r.name) return `page.locator('[name="${r.name}"]')`;
  if (r.placeholder) return `page.getByPlaceholder("${r.placeholder}")`;
  if (r.text && r.text.length < 40) return `page.getByText("${r.text}")`;
  if (r.tag === "A" && r.url) return `page.locator('a[href="${r.url}"]')`;
  return `page.locator("${r.tag ? r.tag.toLowerCase() : '*'}:visible")`;
}
