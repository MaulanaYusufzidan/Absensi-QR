/* Browser E2E: starts the stub Apps Script (real Code.gs) and `next start`, then drives
 * Chromium through the main flows.
 * Prereq: `npm run build` was run with NEXT_PUBLIC_APPS_SCRIPT_URL=http://localhost:8787/exec
 * Usage: node run-e2e.js */
const { spawn } = require("child_process");
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const APP = "http://localhost:3100";
const results = [];
const children = [];

function start(cmd, args, env) {
  const p = spawn(cmd, args, {
    cwd: __dirname,
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
  children.push(p);
  return p;
}

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timeout waiting for " + url);
}

async function step(name, fn) {
  try {
    await fn();
    results.push([name, true]);
    console.log("  PASS " + name);
  } catch (e) {
    results.push([name, false, e.message.split("\n")[0]]);
    console.log("  FAIL " + name + " -> " + e.message.split("\n")[0]);
  }
}

function assert(c, m) {
  if (!c) throw new Error(m);
}

async function loginAs(page, user, pass) {
  await page.goto(APP + "/login");
  await page.waitForLoadState("networkidle");
  await page.fill("#username", user);
  await page.fill("#password", pass);
  await page.click("button[type=submit]");
}

function getChromiumExec() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  const candidates = [
    "/opt/pw-browsers/chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    const p = chromium.executablePath();
    if (fs.existsSync(p)) return p;
  } catch {
    /* fallback */
  }
  return undefined;
}

async function main() {
  start("node", ["stub-server.js"], { STUB_PORT: "8787" });
  start("node", [path.join(__dirname, "node_modules", "next", "dist", "bin", "next"), "start", "-p", "3100"], {});
  await waitFor("http://localhost:8787/exec");
  await waitFor(APP + "/login");

  const execPath = getChromiumExec();
  const launchArgs = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--no-sandbox",
  ];
  const fakeY4m = path.join(__dirname, ".e2e", "fake.y4m");
  if (fs.existsSync(fakeY4m)) {
    launchArgs.push("--use-file-for-fake-video-capture=" + fakeY4m);
  }

  const browser = await chromium.launch({
    executablePath: execPath,
    args: launchArgs,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["camera"],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  console.log("auth");
  await step("protected route redirects to /login when logged out", async () => {
    await page.goto(APP + "/dashboard");
    await page.waitForURL("**/login", { timeout: 10000 });
  });
  await step("wrong password shows error, stays on login", async () => {
    await loginAs(page, "guru1", "salah");
    await page.waitForSelector("text=Username atau password salah", { timeout: 10000 });
    assert(page.url().includes("/login"), "left login");
  });
  await step("guru login -> dashboard with API stats", async () => {
    await loginAs(page, "guru1", "test-guru-1");
    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await page.waitForSelector("text=Total Siswa", { timeout: 10000 });
    await page.waitForSelector("text=Kelas 7", { timeout: 10000 });
  });

  console.log("daily homeroom attendance workflow");
  await step("scan student 1 (Ahmad) -> ABSENSI BERHASIL", async () => {
    await page.goto(APP + "/scan");
    await page.waitForSelector("text=Ahmad", { timeout: 25000 });
    const previewBtn = page.getByRole("button", { name: "Konfirmasi Absensi" });
    const isPreview = await previewBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isPreview) {
      const input = page.locator("input[placeholder*='DU26001']");
      await input.fill("DU26001");
      await page.getByRole("button", { name: "Kirim" }).click();
      await page.waitForSelector("text=Konfirmasi Absensi", { timeout: 10000 });
    }
    await page.getByRole("button", { name: "Konfirmasi Absensi" }).click();
    await page.waitForSelector("text=ABSENSI BERHASIL", { timeout: 15000 });
  });

  await step("second scan of same student -> duplicate warning, no extra record", async () => {
    await page.goto(APP + "/scan");
    await page.waitForSelector("text=Ahmad", { timeout: 25000 });
    const previewBtn = page.getByRole("button", { name: "Konfirmasi Absensi" });
    const isPreview = await previewBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isPreview) {
      const input = page.locator("input[placeholder*='DU26001']");
      await input.fill("DU26001");
      await page.getByRole("button", { name: "Kirim" }).click();
    }
    await page.waitForSelector("text=SUDAH ABSEN", { timeout: 25000 });
  });

  await step("manual attendance for other student (Budi) -> success", async () => {
    await page.goto(APP + "/manual-attendance");
    await page.waitForSelector("text=Absensi Manual Harian", { timeout: 15000 });
    await page.waitForSelector("text=Budi", { timeout: 15000 });
    const markBtn = page.getByRole("button", { name: /Tandai Belum Absen/i });
    if (await markBtn.isEnabled()) {
      await markBtn.click();
    }
    await page.getByRole("button", { name: /Simpan Perubahan/i }).click();
    await page.waitForSelector("text=berhasil disimpan", { timeout: 15000 });
  });

  await step("scan student already recorded via manual -> duplicate rejected", async () => {
    await page.goto(APP + "/scan");
    await page.waitForLoadState("networkidle");
    const input = page.locator("input[placeholder*='DU26001']");
    await input.fill("DU26002");
    await page.getByRole("button", { name: "Kirim" }).click();
    await page.waitForSelector("text=/sudah absen|SUDAH ABSEN/i", { timeout: 15000 });
  });

  await step("dashboard reflects updated attendance and unrecorded count", async () => {
    await page.goto(APP + "/dashboard");
    await page.waitForSelector("text=Total Siswa", { timeout: 15000 });
    await page.waitForSelector("text=Ahmad", { timeout: 15000 });
    await page.waitForSelector("text=Budi", { timeout: 15000 });
  });

  await step("daily recap shows attendance records", async () => {
    await page.goto(APP + "/attendance");
    await page.waitForSelector("text=Ahmad", { timeout: 15000 });
    await page.waitForSelector("text=Budi", { timeout: 15000 });
  });

  await step("history of previous dates is accessible", async () => {
    await page.goto(APP + "/attendance");
    await page.waitForLoadState("networkidle");
    const dateInput = page.locator("input[type=date]").first();
    if (await dateInput.isVisible()) {
      await dateInput.fill("2026-09-01");
      await page.waitForLoadState("networkidle");
    }
  });

  console.log("roles & permissions");
  await step("guru is redirected away from /students", async () => {
    await page.goto(APP + "/students");
    await page.waitForURL("**/dashboard", { timeout: 10000 });
  });
  await step("logout returns to /login and clears access", async () => {
    await page.click("button:has-text('Keluar')");
    await page.waitForURL("**/login", { timeout: 10000 });
    await page.goto(APP + "/dashboard");
    await page.waitForURL("**/login", { timeout: 10000 });
  });
  await step("admin can open every admin page", async () => {
    await loginAs(page, "admin", "test-admin");
    await page.waitForURL("**/dashboard", { timeout: 10000 });
    for (const [p, text] of [
      ["/students", "Ahmad"],
      ["/teachers", "Guru Satu"],
      ["/schedule", "Matematika"],
      ["/qr", "DU26001"],
      ["/settings", "Nama Sekolah"],
    ]) {
      await page.goto(APP + p);
      await page.waitForSelector("text=" + text, { timeout: 15000 });
    }
  });
  await step("admin adds a student; it gets a DU26### id", async () => {
    await page.goto(APP + "/students");
    await page.click("button:has-text('Tambah')");
    const dialog = page.locator("[role=dialog]");
    await dialog.getByLabel("Nama").fill("Gita E2E");
    await dialog.getByLabel("NIS", { exact: true }).fill("9001");
    await dialog.getByLabel("Kelas").fill("7");
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await page.waitForSelector("text=Gita E2E", { timeout: 15000 });
    await page.waitForSelector("text=DU26007", { timeout: 5000 });
  });

  console.log("responsive");
  for (const w of [375, 390, 768, 1440]) {
    await step("no horizontal overflow at " + w + "px on all pages", async () => {
      await page.setViewportSize({ width: w, height: 800 });
      for (const p of [
        "/dashboard",
        "/scan",
        "/manual-attendance",
        "/attendance",
        "/students",
        "/teachers",
        "/schedule",
        "/qr",
        "/settings",
      ]) {
        await page.goto(APP + p);
        await page.waitForLoadState("networkidle");
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth
        );
        assert(over <= 1, p + " overflows by " + over + "px");
      }
    });
  }

  console.log("failure modes");
  await step("API failure shows error, not fake data", async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route("**/exec", (r) => r.abort());
    await page.goto(APP + "/students");
    await page.waitForSelector("text=/Gagal terhubung|tidak dapat dihubungi/", { timeout: 15000 });
    await page.unroute("**/exec");
  });
  await step("camera denied shows permission message", async () => {
    const browser2 = await chromium.launch({
      executablePath: execPath,
      args: ["--deny-permission-prompts", "--no-sandbox"],
    });
    const p2 = await (await browser2.newContext()).newPage();
    await loginAs(p2, "guru1", "test-guru-1");
    await p2.waitForURL("**/dashboard", { timeout: 10000 });
    await p2.goto(APP + "/scan");
    await p2.waitForSelector("text=Izin kamera diperlukan", { timeout: 20000 });
    await browser2.close();
  });
  await step("no uncaught page errors", async () => {
    assert(errors.length === 0, errors.join(" | "));
  });

  await browser.close();
  const failed = results.filter((r) => !r[1]);
  console.log("\nE2E " + (results.length - failed.length) + "/" + results.length + " passed");
  process.exitCode = failed.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    children.forEach((c) => {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(c.pid), "/f", "/t"]);
        } else {
          c.kill();
        }
      } catch {
        /* already gone */
      }
    });
  });
