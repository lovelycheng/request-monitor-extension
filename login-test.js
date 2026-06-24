const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const STORAGE_FILE = "browser-state.json";
const CREDENTIALS_FILE = path.join(__dirname, "credentials.json");
const TARGET_URL = "https://devcloud.cn-east-3.huaweicloud.com/ipdproject/home";

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    console.error("[错误] 未找到 credentials.json，请复制 credentials.template.json 并填入真实凭据");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8")).huaweiCloud;
}

(async () => {
  const creds = loadCredentials();
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  // 1. 尝试用已有 cookie 恢复会话
  const hasState = fs.existsSync(STORAGE_FILE);
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ...(hasState ? { storageState: STORAGE_FILE } : {}),
  });
  const page = await context.newPage();

  if (hasState) {
    console.log("[检查] 发现已保存的登录状态，尝试验证...");
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(4000);

    // 判断是否还登录着
    const stillLoggedIn = !page.url().includes("auth.huaweicloud.com/authui/login");
    if (stillLoggedIn) {
      console.log("[成功] cookie 有效，跳过登录！直接进入目标页");
      console.log(`       当前: ${page.url()}`);
      console.log("\n浏览器保持打开");
      return; // ← 直接返回，不需要登录
    }
    console.log("[过期] cookie 已失效，重新登录...");
  }

  // 2. cookie 无效 → 走完整登录流程
  console.log("[1] 进入登录页");
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(3000);
  console.log(`    当前: ${page.url()}`);

  // 3. Ajax 密码登录
  console.log("[2] 密码登录...");
  const result = await page.evaluate(async (creds) => {
    const body = new URLSearchParams();
    body.append("isAjax", "true");
    body.append("Submit", "Login");
    body.append("userpasswordcredentials.username", creds.username);
    body.append("userpasswordcredentials.password", creds.password);
    body.append("userpasswordcredentials.domain", creds.domain);
    body.append("userpasswordcredentials.domainType", creds.domainType);
    body.append("userpasswordcredentials.countryCode", creds.countryCode);
    body.append("userpasswordcredentials.userInfoType", creds.userInfoType);
    body.append("userpasswordcredentials.verifycode", "");
    body.append("__checkbox_warnCheck", "true");
    const resp = await fetch("/authui/validateUser.action", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
      body: body.toString(),
    });
    return resp.json();
  }, creds);
  console.log(`    响应: ${JSON.stringify(result)}`);

  if (result.loginResult !== "success") {
    console.log("[失败] 密码验证未通过");
    await browser.close();
    return;
  }

  // 4. 跳转二次验证
  console.log("[3] 进入二次验证...");
  await page.goto("https://auth.huaweicloud.com/authui/loginVerification.html", {
    waitUntil: "domcontentloaded", timeout: 15000,
  });
  await page.waitForTimeout(4000);

  // 5. 发送短信
  console.log("[4] 发送短信验证码...");
  try {
    await page.evaluate(async () => {
      await fetch("/authui/sendLoginSms", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
        body: "",
      });
    });
    console.log("    短信已发送");
  } catch (e) {
    console.log("    页面自动触发了短信");
  }

  // 6. 等待验证码
  console.log("\n[5] 请在浏览器窗口输入短信验证码并提交");
  console.log("    完成后脚本会自动保存登录状态\n");

  // 轮询检测是否登录成功
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    try {
      const url = page.url();
      if (url.includes("devcloud") || url.includes("console")) {
        console.log("[完成] 登录成功！");
        break;
      }
    } catch {}
  }

  // 7. 保存登录状态
  const state = await context.storageState();
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(state, null, 2));
  console.log(`[保存] cookie 已写入 ${STORAGE_FILE}`);
  console.log("       下次运行将跳过登录");

  console.log("\n浏览器保持打开");
})();
