/* Runs the REAL apps-script/Code.gs inside a vm with mocked Google services.
 * Usage: npm run test:backend
 * Test-only passwords below exist only in memory; they are not real credentials. */
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");

const TZ = "Asia/Jakarta";

/** Date -> Date as Sheets would return a date-only cell. */
function sheetsDateOnly(iso) {
  return new Date(iso + "T00:00:00+07:00");
}
/** "07:00" -> Date as Sheets returns a time-only cell (1899 epoch, LMT offset). */
function sheetsTimeOnly(hm) {
  const [h, m] = hm.split(":").map(Number);
  return new Date(Date.UTC(1899, 11, 30, h - 7, m - 7, -12));
}
/** Fixed instant in Jakarta, e.g. jakarta("2026-10-05", "07:05"). */
function jakarta(date, hm) {
  return new Date(date + "T" + hm + ":00+07:00");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function pad(n, w) {
  return String(n).padStart(w || 2, "0");
}

function formatDate(date, tz, pattern) {
  const parts = {};
  new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  const u = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
  return pattern
    .replace("yyyy", parts.year).replace("yy", parts.year.slice(2))
    .replace("MM", parts.month).replace("dd", parts.day)
    .replace("HH", parts.hour).replace("mm", parts.minute).replace("ss", parts.second)
    .replace("u", String(u));
}

/** Mock sheet: cells hold raw values; text-formatted cells are never auto-converted. */
function makeSheet(name, rows) {
  const sheet = {
    name,
    data: rows.map((r) => r.slice()),
    textCells: new Set(),
    getDataRange() { return { getValues: () => sheet.data.map((r) => r.slice()) }; },
    getLastRow() { return sheet.data.length; },
    getRange(row, col, nr, nc) {
      return {
        setNumberFormat() {
          for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) sheet.textCells.add((row + r) + ":" + (col + c));
          return this;
        },
        setValues(vals) {
          for (let r = 0; r < nr; r++) {
            while (sheet.data.length < row + r) sheet.data.push([]);
            for (let c = 0; c < nc; c++) {
              let v = vals[r][c];
              if (!sheet.textCells.has((row + r) + ":" + (col + c)) && typeof v === "string") {
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v = sheetsDateOnly(v);
                else if (/^\d{1,2}:\d{2}$/.test(v)) v = sheetsTimeOnly(v.padStart(5, "0"));
              }
              sheet.data[row + r - 1][col + c - 1] = v;
            }
          }
        },
      };
    },
  };
  return sheet;
}

function buildDb() {
  const students = [["NO", "NAMA", "NIS", "NISN", "TTL", "ALAMAT", "ID_QR", "KELAS", "STATUS"]];
  const names = ["Ahmad", "Budi", "Citra", "Dewi", "Eko"];
  names.forEach((n, i) => {
    students.push([i + 1, n, "10" + (i + 1), "00" + (i + 1), "Jakarta", "Jl. Uji", "DU26" + pad(i + 1, 3), "7", i === 4 ? "NONAKTIF" : "AKTIF"]);
  });
  students.push([6, "Fani", "106", "006", "Bogor", "Jl. Uji", "DU26006", "8", "AKTIF"]);
  return {
    SISWA: makeSheet("SISWA", students),
    GURU: makeSheet("GURU", [
      ["ID_GURU", "NIP", "NAMA_GURU", "USERNAME", "PASSWORD_HASH", "STATUS", "ROLE"],
      ["G001", "1", "Guru Satu", "guru1", sha256("test-guru-1"), "AKTIF", "GURU"],
      ["G002", "2", "Guru Dua", "guru2", sha256("test-guru-2"), "AKTIF", "GURU"],
      ["G003", "3", "Admin Uji", "admin", sha256("test-admin"), "AKTIF", "ADMIN"],
      ["G004", "4", "Guru Off", "guruoff", sha256("test-off"), "NONAKTIF", "GURU"],
    ]),
    JADWAL: makeSheet("JADWAL", [
      ["ID_JADWAL", "HARI", "JAM_MULAI", "JAM_SELESAI", "KELAS", "MATA_PELAJARAN", "ID_GURU", "STATUS", "TGL_DIBUAT"],
      ["J001", "SENIN", sheetsTimeOnly("07:00"), sheetsTimeOnly("08:30"), "7", "Matematika", "G001", "AKTIF", sheetsDateOnly("2026-09-01")],
    ]),
    ABSENSI: makeSheet("ABSENSI", [[
      "ID_ABSENSI", "ID_JADWAL", "ID_QR", "NIS", "NAMA", "KELAS", "TANGGAL", "JAM",
      "MATA_PELAJARAN", "ID_GURU", "NAMA_GURU", "STATUS", "KETERANGAN",
    ]]),
    QR_CETAK: makeSheet("QR_CETAK", [["ID_QR"]]),
    PENGATURAN: makeSheet("PENGATURAN", [
      ["KEY", "VALUE"],
      ["NAMA_SEKOLAH", "SMP Uji"],
      ["BATAS_KETERLAMBATAN", "15"],
      ["ZONA_WAKTU", "Asia/Jakarta"],
      ["DURASI_SESSION", "120"],
      ["VALIDASI_JAM", "true"],
    ]),
  };
}

function createSandbox(db, startAt) {
  const clock = { t: startAt.getTime() };
  class FixedDate extends Date {
    constructor(...a) { if (a.length === 0) super(clock.t); else super(...a); }
    static now() { return clock.t; }
  }
  const props = {};
  let locked = false;
  const ctx = {
    console, Date: FixedDate, JSON, Math, parseInt, String, Object, Array, RegExp, isNaN, Error,
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: (n) => db[n] || null }),
      getActiveSpreadsheet: () => ({ getSheetByName: (n) => db[n] || null }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (locked) return false; locked = true; return true; },
        releaseLock: () => { locked = false; },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
      }),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      formatDate,
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, text) => Array.from(crypto.createHash("sha256").update(text, "utf8").digest()).map((b) => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (data, key) =>
        Array.from(crypto.createHmac("sha256", key).update(data).digest()).map((b) => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (s) => Buffer.from(s, "utf8").toString("base64url"),
      base64DecodeWebSafe: (s) => Array.from(Buffer.from(s, "base64url")),
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString("utf8") }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "apps-script", "Code.gs"), "utf8"), ctx, { filename: "Code.gs" });
  return {
    ctx, db, clock, props,
    setNow(d) { clock.t = d.getTime(); },
    call(action, payload, token) {
      const out = ctx.doPost({ postData: { contents: JSON.stringify({ action, token: token || undefined, ...(payload || {}) }) } });
      return JSON.parse(out.getContent());
    },
  };
}

function run() {
  let pass = 0;
  const failures = [];
  function test(name, fn) {
    try { fn(); pass++; console.log("  ok   " + name); }
    catch (e) { failures.push(name); console.log("  FAIL " + name + "\n       " + (e && e.message)); }
  }
  const MON_0705 = jakarta("2026-10-05", "07:05");
  const fresh = (at) => createSandbox(buildDb(), at || MON_0705);
  const login = (sb, u, p) => sb.call("login", { username: u, password: p });
  const tokenOf = (sb, u, p) => login(sb, u, p).data.token;

  console.log("auth");
  test("login ok for valid SHA-256 password, hash never returned", () => {
    const sb = fresh();
    const r = login(sb, "guru1", "test-guru-1");
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.data.role, "GURU");
    assert.ok(!JSON.stringify(r).toLowerCase().includes("password_hash"));
    assert.ok(!JSON.stringify(r).includes(sha256("test-guru-1")));
  });
  test("login wrong password -> INVALID_CREDENTIALS", () => {
    assert.strictEqual(login(fresh(), "guru1", "salah").code, "INVALID_CREDENTIALS");
  });
  test("login unknown user -> INVALID_CREDENTIALS", () => {
    assert.strictEqual(login(fresh(), "nobody", "x").code, "INVALID_CREDENTIALS");
  });
  test("login inactive account -> ACCOUNT_INACTIVE", () => {
    assert.strictEqual(login(fresh(), "guruoff", "test-off").code, "ACCOUNT_INACTIVE");
  });
  test("missing token -> UNAUTHENTICATED", () => {
    assert.strictEqual(fresh().call("getDashboard", {}, "").code, "UNAUTHENTICATED");
  });
  test("tampered token -> UNAUTHENTICATED", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    assert.strictEqual(sb.call("getDashboard", {}, t.slice(0, -2) + "00").code, "UNAUTHENTICATED");
  });
  test("expired token -> UNAUTHENTICATED", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    sb.setNow(new Date(MON_0705.getTime() + 121 * 60 * 1000));
    assert.strictEqual(sb.call("getDashboard", {}, t).code, "UNAUTHENTICATED");
  });
  test("deactivated teacher's old token is rejected", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    sb.db.GURU.data[1][5] = "NONAKTIF";
    assert.strictEqual(sb.call("getDashboard", {}, t).code, "UNAUTHENTICATED");
  });
  test("guru blocked from admin endpoints (FORBIDDEN)", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    ["getStudents", "getTeachers", "getSettings", "saveStudent", "saveTeacher", "saveSchedule", "updateSettings"].forEach((a) => {
      assert.strictEqual(sb.call(a, {}, t).code, "FORBIDDEN", a);
    });
  });

  console.log("scan");
  test("getStudentByQR resolves everything server-side (Date cells normalised)", () => {
    const sb = fresh();
    const r = sb.call("getStudentByQR", { idQr: "DU26001" }, tokenOf(sb, "guru1", "test-guru-1"));
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.strictEqual(r.data.student.nama, "Ahmad");
    assert.strictEqual(r.data.schedule.idJadwal, "J001");
    assert.strictEqual(r.data.schedule.jamMulai, "07:00");
    assert.strictEqual(r.data.status, "HADIR");
    assert.strictEqual(r.data.jam, "07:05");
  });
  test("scanAttendance HADIR writes one row with text date/time", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    const r = sb.call("scanAttendance", { idQr: "DU26001" }, t);
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.strictEqual(r.data.status, "HADIR");
    const row = sb.db.ABSENSI.data[1];
    assert.strictEqual(sb.db.ABSENSI.data.length, 2);
    assert.strictEqual(row[6], "2026-10-05");
    assert.strictEqual(row[7], "07:05");
    assert.strictEqual(row[3], "101");
    assert.strictEqual(row[10], "Guru Satu");
  });
  test("TERLAMBAT after BATAS_KETERLAMBATAN", () => {
    const sb = fresh(jakarta("2026-10-05", "07:20"));
    const r = sb.call("scanAttendance", { idQr: "DU26001" }, tokenOf(sb, "guru1", "test-guru-1"));
    assert.strictEqual(r.data.status, "TERLAMBAT");
  });
  test("exactly on the limit (07:15) is still HADIR", () => {
    const sb = fresh(jakarta("2026-10-05", "07:15"));
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26001" }, tokenOf(sb, "guru1", "test-guru-1")).data.status, "HADIR");
  });
  test("duplicate scan -> DUPLICATE_ATTENDANCE, no extra row", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    sb.call("scanAttendance", { idQr: "DU26001" }, t);
    const r = sb.call("scanAttendance", { idQr: "DU26001" }, t);
    assert.strictEqual(r.code, "DUPLICATE_ATTENDANCE");
    assert.strictEqual(sb.db.ABSENSI.data.length, 2);
  });
  test("getStudentByQR reports alreadyRecorded after a scan", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    sb.call("scanAttendance", { idQr: "DU26001" }, t);
    const r = sb.call("getStudentByQR", { idQr: "DU26001" }, t);
    assert.strictEqual(r.data.alreadyRecorded.jam, "07:05");
    assert.strictEqual(r.data.alreadyRecorded.status, "HADIR");
  });
  test("unknown QR -> QR_NOT_REGISTERED", () => {
    const sb = fresh();
    assert.strictEqual(sb.call("scanAttendance", { idQr: "ZZZ999" }, tokenOf(sb, "guru1", "test-guru-1")).code, "QR_NOT_REGISTERED");
  });
  test("malformed QR text -> QR_NOT_REGISTERED", () => {
    const sb = fresh();
    assert.strictEqual(sb.call("scanAttendance", { idQr: "<script>" }, tokenOf(sb, "guru1", "test-guru-1")).code, "QR_NOT_REGISTERED");
  });
  test("inactive student -> STUDENT_INACTIVE", () => {
    const sb = fresh();
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26005" }, tokenOf(sb, "guru1", "test-guru-1")).code, "STUDENT_INACTIVE");
  });
  test("class without schedule -> NO_ACTIVE_SCHEDULE", () => {
    const sb = fresh();
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26006" }, tokenOf(sb, "guru1", "test-guru-1")).code, "NO_ACTIVE_SCHEDULE");
  });
  test("wrong teacher -> NO_ACTIVE_SCHEDULE", () => {
    const sb = fresh();
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26001" }, tokenOf(sb, "guru2", "test-guru-2")).code, "NO_ACTIVE_SCHEDULE");
  });
  test("wrong weekday (Tuesday) -> NO_ACTIVE_SCHEDULE", () => {
    const sb = fresh(jakarta("2026-10-06", "07:05"));
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26001" }, tokenOf(sb, "guru1", "test-guru-1")).code, "NO_ACTIVE_SCHEDULE");
  });
  test("outside time window -> OUT_OF_SCHEDULE_TIME; allowed when VALIDASI_JAM=false", () => {
    const sb = fresh(jakarta("2026-10-05", "10:00"));
    const t = tokenOf(sb, "guru1", "test-guru-1");
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26001" }, t).code, "OUT_OF_SCHEDULE_TIME");
    sb.db.PENGATURAN.data[5][1] = "false";
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26001" }, t).success, true);
  });
  test("inactive schedule is ignored", () => {
    const sb = fresh();
    sb.db.JADWAL.data[1][7] = "NONAKTIF";
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26001" }, tokenOf(sb, "guru1", "test-guru-1")).code, "NO_ACTIVE_SCHEDULE");
  });
  test("busy lock -> SERVER_BUSY", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    sb.ctx.LockService.getScriptLock().tryLock();
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26001" }, t).code, "SERVER_BUSY");
  });
  test("lock is released after an error", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    sb.call("scanAttendance", { idQr: "ZZZ999" }, t);
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26001" }, t).success, true);
  });

  console.log("dashboard & history");
  test("dashboard counts come from sheet data", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    sb.call("scanAttendance", { idQr: "DU26001" }, t);
    sb.setNow(jakarta("2026-10-05", "07:20"));
    sb.call("scanAttendance", { idQr: "DU26002" }, t);
    const d = sb.call("getDashboard", {}, t).data;
    assert.deepStrictEqual(
      { total: d.totalSiswa, hadir: d.hadir, terlambat: d.terlambat, tanpa: d.tanpaKeterangan },
      { total: 5, hadir: 1, terlambat: 1, tanpa: 3 }
    );
  });
  test("getClasses: per-class belumHadir", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    sb.call("scanAttendance", { idQr: "DU26001" }, t);
    const c = sb.call("getClasses", {}, t).data;
    const k7 = c.filter((x) => x.kelas === "7")[0];
    assert.deepStrictEqual([k7.total, k7.hadir, k7.belumHadir], [4, 1, 3]);
  });
  test("getAttendance returns today's history (limit, newest first) after a scan", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    sb.call("scanAttendance", { idQr: "DU26001" }, t);
    sb.setNow(jakarta("2026-10-05", "07:10"));
    sb.call("scanAttendance", { idQr: "DU26002" }, t);
    const h = sb.call("getAttendance", { tanggal: "2026-10-05", limit: 10 }, t).data;
    assert.strictEqual(h.length, 2);
    assert.strictEqual(h[0].nama, "Budi");
    assert.strictEqual(h[0].tanggal, "2026-10-05");
    assert.strictEqual(h[0].jam, "07:10");
  });
  test("getAttendance date filter excludes other days", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    sb.call("scanAttendance", { idQr: "DU26001" }, t);
    assert.strictEqual(sb.call("getAttendance", { tanggal: "2026-10-04" }, t).data.length, 0);
  });
  test("bad date format -> VALIDATION", () => {
    const sb = fresh();
    assert.strictEqual(sb.call("getDashboard", { tanggal: "05/10/2026" }, tokenOf(sb, "guru1", "test-guru-1")).code, "VALIDATION");
  });
  test("getTodaySchedule: owner sees it, other teacher does not", () => {
    const sb = fresh();
    assert.strictEqual(sb.call("getTodaySchedule", {}, tokenOf(sb, "guru1", "test-guru-1")).data.length, 1);
    assert.strictEqual(sb.call("getTodaySchedule", {}, tokenOf(sb, "guru2", "test-guru-2")).data.length, 0);
  });

  console.log("admin");
  test("saveStudent creates DU26### id; existing ID_QR never changes", () => {
    const sb = fresh();
    const t = tokenOf(sb, "admin", "test-admin");
    const c = sb.call("saveStudent", { student: { nama: "Gita", nis: "107", kelas: "7" } }, t);
    assert.strictEqual(c.success, true, JSON.stringify(c));
    assert.strictEqual(c.data.idQr, "DU26007");
    const e = sb.call("saveStudent", { student: { idQr: "DU26001", nama: "Ahmad R", nis: "101", kelas: "7", status: "AKTIF" } }, t);
    assert.strictEqual(e.data.idQr, "DU26001");
    assert.strictEqual(sb.db.SISWA.data[1][1], "Ahmad R");
    assert.strictEqual(sb.db.SISWA.data[1][6], "DU26001");
    assert.strictEqual(sb.db.SISWA.data.length, 8);
  });
  test("saveStudent duplicate NIS rejected", () => {
    const sb = fresh();
    assert.strictEqual(sb.call("saveStudent", { student: { nama: "X", nis: "101", kelas: "7" } }, tokenOf(sb, "admin", "test-admin")).code, "VALIDATION");
  });
  test("saveTeacher: new gets G005 + SHA-256 hash; username clash rejected", () => {
    const sb = fresh();
    const t = tokenOf(sb, "admin", "test-admin");
    const c = sb.call("saveTeacher", { teacher: { namaGuru: "Guru Baru", username: "Baru", password: "pw-baru-1" } }, t);
    assert.strictEqual(c.data.idGuru, "G005");
    assert.strictEqual(sb.db.GURU.data[5][4], sha256("pw-baru-1"));
    assert.ok(!JSON.stringify(c).includes(sha256("pw-baru-1")));
    assert.strictEqual(login(sb, "baru", "pw-baru-1").success, true);
    assert.strictEqual(sb.call("saveTeacher", { teacher: { namaGuru: "Dup", username: "GURU1", password: "x" } }, t).code, "USERNAME_TAKEN");
  });
  test("saveTeacher without password keeps existing hash", () => {
    const sb = fresh();
    const before = sb.db.GURU.data[1][4];
    sb.call("saveTeacher", { teacher: { idGuru: "G001", namaGuru: "Guru Satu", username: "guru1", status: "NONAKTIF", role: "GURU" } }, tokenOf(sb, "admin", "test-admin"));
    assert.strictEqual(sb.db.GURU.data[1][4], before);
    assert.strictEqual(sb.db.GURU.data[1][5], "NONAKTIF");
  });
  test("saveSchedule creates J002 as text and validates input", () => {
    const sb = fresh();
    const t = tokenOf(sb, "admin", "test-admin");
    const c = sb.call("saveSchedule", { schedule: { hari: "SELASA", jamMulai: "8:00", jamSelesai: "09:30", kelas: "8", mataPelajaran: "IPA", idGuru: "G002" } }, t);
    assert.strictEqual(c.success, true, JSON.stringify(c));
    assert.strictEqual(c.data.idJadwal, "J002");
    assert.strictEqual(sb.db.JADWAL.data[2][2], "08:00");
    assert.strictEqual(typeof sb.db.JADWAL.data[2][2], "string");
    assert.strictEqual(sb.call("saveSchedule", { schedule: { hari: "SELASA", jamMulai: "09:00", jamSelesai: "08:00", kelas: "8", mataPelajaran: "IPA", idGuru: "G002" } }, t).code, "VALIDATION");
    assert.strictEqual(sb.call("saveSchedule", { schedule: { hari: "SELASA", jamMulai: "08:00", jamSelesai: "09:00", kelas: "8", mataPelajaran: "IPA", idGuru: "G999" } }, t).code, "VALIDATION");
  });
  test("a new schedule is immediately usable for scanning", () => {
    const sb = fresh(jakarta("2026-10-06", "08:05"));
    const t = tokenOf(sb, "admin", "test-admin");
    sb.call("saveSchedule", { schedule: { hari: "SELASA", jamMulai: "08:00", jamSelesai: "09:30", kelas: "8", mataPelajaran: "IPA", idGuru: "G002" } }, t);
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26006" }, tokenOf(sb, "guru2", "test-guru-2")).data.status, "HADIR");
  });
  test("updateSettings saves values but ZONA_WAKTU stays locked", () => {
    const sb = fresh();
    const t = tokenOf(sb, "admin", "test-admin");
    const r = sb.call("updateSettings", { settings: { NAMA_SEKOLAH: "SMP Baru", BATAS_KETERLAMBATAN: "10", ZONA_WAKTU: "UTC", VALIDASI_JAM: "false" } }, t);
    assert.strictEqual(r.data.NAMA_SEKOLAH, "SMP Baru");
    assert.strictEqual(r.data.BATAS_KETERLAMBATAN, "10");
    assert.strictEqual(r.data.ZONA_WAKTU, "Asia/Jakarta");
    assert.strictEqual(r.data.VALIDASI_JAM, "false");
    assert.strictEqual(sb.call("updateSettings", { settings: { BATAS_KETERLAMBATAN: "abc" } }, t).code, "VALIDATION");
  });
  test("no sheet row is ever deleted by any action", () => {
    const sb = fresh();
    const t = tokenOf(sb, "admin", "test-admin");
    const sizes = () => Object.keys(sb.db).map((k) => sb.db[k].data.length).join(",");
    const before = sizes();
    ["getStudents", "getTeachers", "getSchedules", "getSettings", "getDashboard", "getClasses", "getAttendance"].forEach((a) => sb.call(a, {}, t));
    assert.strictEqual(sizes(), before);
  });
  test("unknown action -> VALIDATION", () => {
    assert.strictEqual(fresh().call("dropEverything", {}, "").code, "VALIDATION");
  });

  console.log("\n" + pass + "/" + (pass + failures.length) + " passed");
  if (failures.length) {
    console.log("FAILED: " + failures.join("; "));
    process.exitCode = 1;
  }
}

module.exports = { createSandbox, buildDb, jakarta, sheetsTimeOnly, sheetsDateOnly, sha256, TZ };
if (require.main === module) run();
