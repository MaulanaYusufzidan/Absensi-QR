/* Local stand-in for the Apps Script web app: runs the REAL apps-script/Code.gs
 * against an in-memory fake spreadsheet. For local dev and E2E only.
 *   node stub-server.js            -> http://localhost:8787/exec
 * Then: NEXT_PUBLIC_APPS_SCRIPT_URL=http://localhost:8787/exec
 * Test accounts (in-memory only): guru1/test-guru-1, admin/test-admin.
 * Env STUB_NOW=2026-10-05T07:05:00+07:00 freezes the server clock. */
const http = require("http");
const { createSandbox, buildDb } = require("./run-codegs-tests.js");

const port = Number(process.env.STUB_PORT || 8787);
const sb = createSandbox(buildDb(), process.env.STUB_NOW ? new Date(process.env.STUB_NOW) : new Date());
if (!process.env.STUB_NOW) {
  // Seed an all-day schedule for today's weekday (kelas 7, guru G001) so scanning
  // works at any real time of day during local dev / E2E.
  const days = ["MINGGU", "SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU"];
  const today = days[parseInt(sb.ctx.Utilities.formatDate(new Date(), "Asia/Jakarta", "u"), 10) % 7];
  sb.db.JADWAL.data.push(["J900", today, "00:00", "23:59", "7", "Seni Budaya", "G001", "AKTIF", "2026-10-01"]);
  // Follow the real clock when not frozen.
  setInterval(() => sb.setNow(new Date()), 1000).unref();
}

const server = http.createServer((req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  if (req.method === "POST" && req.url.startsWith("/exec")) {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const out = sb.ctx.doPost({ postData: { contents: body } });
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(out.getContent());
    });
    return;
  }
  res.writeHead(200, { ...cors, "Content-Type": "application/json" });
  res.end(sb.ctx.doGet().getContent());
});

server.listen(port, () => console.log("stub Apps Script on http://localhost:" + port + "/exec"));
