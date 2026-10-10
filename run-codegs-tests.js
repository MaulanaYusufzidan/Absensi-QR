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
      ["ID_GURU", "NIP", "NAMA_GURU", "USERNAME", "PASSWORD_HASH", "STATUS", "ROLE", "KELAS"],
      ["G001", "1", "Guru Satu", "guru1", sha256("test-guru-1"), "AKTIF", "GURU", "7"],
      ["G002", "2", "Guru Dua", "guru2", sha256("test-guru-2"), "AKTIF", "GURU", "8"],
      ["G003", "3", "Admin Uji", "admin", sha256("test-admin"), "AKTIF", "ADMIN", ""],
      ["G004", "4", "Guru Off", "guruoff", sha256("test-off"), "NONAKTIF", "GURU", "7"],
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
    SESI_ABSENSI: makeSheet("SESI_ABSENSI", [[
      "ID_SESI", "ID_GURU", "ID_JADWAL", "KELAS", "MATA_PELAJARAN", "TANGGAL", "JAM_MULAI", "STATUS", "CREATED_AT",
    ]]),
    PENGATURAN: makeSheet("PENGATURAN", [
      ["KEY", "VALUE"],
      ["NAMA_SEKOLAH", "SMP Uji"],
      ["BATAS_KETERLAMBATAN", "15"],
      ["ZONA_WAKTU", "Asia/Jakarta"],
      ["DURASI_SESSION", "120"],
      ["VALIDASI_JAM", "true"],
      ["JAM_MASUK", "07:00"],
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
      openById: (id) => ({
        getId: () => id || "MOCK_SPREADSHEET_ID",
        getName: () => "Mock Spreadsheet",
        getSheets: () => Object.keys(db).map((k) => ({ getName: () => k })),
        getSheetByName: (n) => db[n] || null,
        insertSheet: (n) => {
          if (!db[n]) db[n] = makeSheet(n, []);
          return db[n];
        },
      }),
      getActiveSpreadsheet: () => ({
        getId: () => "ACTIVE_MOCK_SPREADSHEET_ID",
        getName: () => "Active Mock Spreadsheet",
        getSheets: () => Object.keys(db).map((k) => ({ getName: () => k })),
        getSheetByName: (n) => db[n] || null,
        insertSheet: (n) => {
          if (!db[n]) db[n] = makeSheet(n, []);
          return db[n];
        },
      }),
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
  test("student from different class -> WRONG_CLASS", () => {
    const sb = fresh();
    // DU26006 (Fani) is class 8, guru1 is wali kelas 7
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26006" }, tokenOf(sb, "guru1", "test-guru-1")).code, "WRONG_CLASS");
  });
  test("wrong wali kelas -> WRONG_CLASS", () => {
    const sb = fresh();
    // DU26001 (Ahmad) is class 7, guru2 is wali kelas 8
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26001" }, tokenOf(sb, "guru2", "test-guru-2")).code, "WRONG_CLASS");
  });
  test("daily attendance works on any weekday (no schedule dependency)", () => {
    const sb = fresh(jakarta("2026-10-06", "07:05"));
    // Tuesday: no schedule on Tuesday, but daily attendance is schedule-independent
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26001" }, tokenOf(sb, "guru1", "test-guru-1")).success, true);
  });
  test("daily attendance works outside old schedule time window (TERLAMBAT status applies)", () => {
    const sb = fresh(jakarta("2026-10-05", "10:00"));
    const t = tokenOf(sb, "guru1", "test-guru-1");
    // At 10:00 with JAM_MASUK 07:00 + limit 15min -> TERLAMBAT
    const r = sb.call("scanAttendance", { idQr: "DU26001" }, t);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.data.status, "TERLAMBAT");
  });
  test("daily attendance works even when schedule is inactive", () => {
    const sb = fresh();
    sb.db.JADWAL.data[1][7] = "NONAKTIF";
    // Schedule is inactive but daily attendance is schedule-independent
    assert.strictEqual(sb.call("scanAttendance", { idQr: "DU26001" }, tokenOf(sb, "guru1", "test-guru-1")).success, true);
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
  test("dashboard counts come from sheet data (class-filtered for wali kelas)", () => {
    const sb = fresh();
    const t = tokenOf(sb, "guru1", "test-guru-1");
    // guru1 is wali kelas 7: 4 active students (Ahmad, Budi, Citra, Dewi; Eko is NONAKTIF)
    sb.call("scanAttendance", { idQr: "DU26001" }, t);
    sb.setNow(jakarta("2026-10-05", "07:20"));
    sb.call("scanAttendance", { idQr: "DU26002" }, t);
    const d = sb.call("getDashboard", {}, t).data;
    assert.deepStrictEqual(
      { total: d.totalSiswa, hadir: d.hadir, terlambat: d.terlambat, tanpa: d.tanpaKeterangan },
      { total: 4, hadir: 1, terlambat: 1, tanpa: 2 }
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

  console.log("teacher sessions & recap");
  test("teacher creates schedule for themselves, cannot impersonate other teacher", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    // Guru 1 creates schedule: idGuru automatically bound to G001
    const res = sb.call("createSchedule", {
      schedule: { hari: "RABU", jamMulai: "08:00", jamSelesai: "09:30", kelas: "7", mataPelajaran: "IPA", idGuru: "G002" }
    }, tGuru1);
    assert.strictEqual(res.success, true, JSON.stringify(res));
    assert.strictEqual(res.data.idGuru, "G001"); // Enforced to G001, ignored attempt to impersonate G002
    assert.strictEqual(res.data.kelas, "7");
    assert.strictEqual(res.data.mataPelajaran, "IPA");
  });

  test("start session creates ACTIVE session and prevents unauthorized access", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    const tGuru2 = tokenOf(sb, "guru2", "test-guru-2");

    // Guru 2 cannot start session for Guru 1's schedule (J001)
    const fail = sb.call("startAttendanceSession", { idJadwal: "J001" }, tGuru2);
    assert.strictEqual(fail.code, "FORBIDDEN");

    // Guru 1 starts session
    const res = sb.call("startAttendanceSession", { idJadwal: "J001" }, tGuru1);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.status, "ACTIVE");
    assert.strictEqual(res.data.idJadwal, "J001");
    assert.strictEqual(res.data.kelas, "7");

    // Re-calling startAttendanceSession returns the same active session
    const res2 = sb.call("startAttendanceSession", { idJadwal: "J001" }, tGuru1);
    assert.strictEqual(res2.data.idSesi, res.data.idSesi);
  });

  test("scanSessionAttendance validates QR, class, duplicates, and inactive students", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    const ses = sb.call("startAttendanceSession", { idJadwal: "J001" }, tGuru1).data;

    // Scan student 1 (Ahmad - Class 7) -> HADIR
    const scan1 = sb.call("scanSessionAttendance", { idSesi: ses.idSesi, idQr: "DU26001" }, tGuru1);
    assert.strictEqual(scan1.success, true, JSON.stringify(scan1));
    assert.strictEqual(scan1.data.student.nama, "Ahmad");
    assert.strictEqual(scan1.data.status, "HADIR");

    // Duplicate scan -> DUPLICATE_ATTENDANCE
    const dup = sb.call("scanSessionAttendance", { idSesi: ses.idSesi, idQr: "DU26001" }, tGuru1);
    assert.strictEqual(dup.code, "DUPLICATE_ATTENDANCE");

    // Scan student from wrong class (Fani is Class 8, session is Class 7)
    const wrongClass = sb.call("scanSessionAttendance", { idSesi: ses.idSesi, idQr: "DU26006" }, tGuru1);
    assert.strictEqual(wrongClass.code, "WRONG_CLASS");

    // Scan unknown student
    const unknown = sb.call("scanSessionAttendance", { idSesi: ses.idSesi, idQr: "UNKNOWN999" }, tGuru1);
    assert.strictEqual(unknown.code, "STUDENT_NOT_FOUND");

    // Scan inactive student (Eko is NONAKTIF)
    const inactive = sb.call("scanSessionAttendance", { idSesi: ses.idSesi, idQr: "DU26005" }, tGuru1);
    assert.strictEqual(inactive.code, "STUDENT_INACTIVE");
  });

  test("closeAttendanceSession disables further scanning and marks unrecorded students as ALPHA if requested", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    const ses = sb.call("startAttendanceSession", { idJadwal: "J001" }, tGuru1).data;

    // Scan Ahmad (DU26001)
    sb.call("scanSessionAttendance", { idSesi: ses.idSesi, idQr: "DU26001" }, tGuru1);

    // Close session with markAlphaForUnrecorded: true
    const closed = sb.call("closeAttendanceSession", { idSesi: ses.idSesi, markAlphaForUnrecorded: true }, tGuru1);
    assert.strictEqual(closed.success, true);
    assert.strictEqual(closed.data.session.status, "CLOSED");

    // Subsequent scan attempt is rejected because session is closed
    const afterClose = sb.call("scanSessionAttendance", { idSesi: ses.idSesi, idQr: "DU26002" }, tGuru1);
    assert.strictEqual(afterClose.code, "SESSION_CLOSED");

    // Check attendance records: Ahmad is HADIR, other active class 7 students (Budi, Citra, Dewi) are ALPHA
    const list = sb.call("getSessionAttendance", { idSesi: ses.idSesi }, tGuru1).data.items;
    const ahmad = list.find((x) => x.student.nama === "Ahmad");
    const budi = list.find((x) => x.student.nama === "Budi");
    assert.strictEqual(ahmad.status, "HADIR");
    assert.strictEqual(budi.status, "ALPHA");
  });

  test("updateAttendanceStatus updates existing record without duplicates, enforces teacher authorization", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    const tGuru2 = tokenOf(sb, "guru2", "test-guru-2");
    const ses = sb.call("startAttendanceSession", { idJadwal: "J001" }, tGuru1).data;

    // Scan Ahmad -> HADIR
    sb.call("scanSessionAttendance", { idSesi: ses.idSesi, idQr: "DU26001" }, tGuru1);
    const initialRows = sb.db.ABSENSI.data.length;

    // Guru 2 cannot edit Guru 1's record
    const fail = sb.call("updateAttendanceStatus", {
      idJadwal: "J001",
      nis: "101",
      status: "IZIN",
      tanggal: "2026-10-05"
    }, tGuru2);
    assert.strictEqual(fail.code, "FORBIDDEN");

    // Guru 1 edits Ahmad: HADIR -> IZIN
    const editRes = sb.call("updateAttendanceStatus", {
      idJadwal: "J001",
      nis: "101",
      status: "IZIN",
      keterangan: "Surat izin dari orang tua",
      tanggal: "2026-10-05"
    }, tGuru1);
    assert.strictEqual(editRes.success, true);
    assert.strictEqual(editRes.data.status, "IZIN");
    assert.strictEqual(editRes.data.keterangan, "Surat izin dari orang tua");

    // Must NOT add duplicate rows!
    assert.strictEqual(sb.db.ABSENSI.data.length, initialRows);
  });

  test("getAttendanceRecap enforces strict teacher isolation and calculates summary percentages", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    const tGuru2 = tokenOf(sb, "guru2", "test-guru-2");

    // Create session and records for Guru 1
    const ses = sb.call("startAttendanceSession", { idJadwal: "J001" }, tGuru1).data;
    sb.call("scanSessionAttendance", { idSesi: ses.idSesi, idQr: "DU26001" }, tGuru1);

    // Guru 1 requests recap: only sees their own attendance
    const recapGuru1 = sb.call("getAttendanceRecap", { tanggalMulai: "2026-10-05", tanggalAkhir: "2026-10-05" }, tGuru1);
    assert.strictEqual(recapGuru1.success, true);
    assert.strictEqual(recapGuru1.data.detail.length, 1);
    assert.strictEqual(recapGuru1.data.detail[0].nama, "Ahmad");
    assert.strictEqual(recapGuru1.data.summary[0].hadir, 1);
    assert.strictEqual(recapGuru1.data.summary[0].persentaseKehadiran, "100%");

    // Guru 2 requests recap: sees 0 records even if passing idGuru: G001
    const recapGuru2 = sb.call("getAttendanceRecap", { idGuru: "G001", tanggalMulai: "2026-10-05" }, tGuru2);
    assert.strictEqual(recapGuru2.data.detail.length, 0);
  });

  console.log("strict teacher data isolation (Test 1 - Test 8)");

  test("Test 1 & 2: Login as Guru 01 vs Guru 02 - each only sees their own data", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    const tGuru2 = tokenOf(sb, "guru2", "test-guru-2");

    // Add schedule for Guru 2 (J002) in class 8
    sb.db.JADWAL.data.push(["J002", "SENIN", "07:00", "08:30", "8", "Bahasa Inggris", "G002", "AKTIF", "2026-10-01"]);

    // Guru 1 queries schedules: sees J001 (Matematika), not J002
    const schedG1 = sb.call("getSchedules", {}, tGuru1).data;
    assert.strictEqual(schedG1.some((s) => s.idJadwal === "J001"), true);
    assert.strictEqual(schedG1.some((s) => s.idJadwal === "J002"), false);

    // Guru 2 queries schedules: sees J002 (Bahasa Inggris), not J001
    const schedG2 = sb.call("getSchedules", {}, tGuru2).data;
    assert.strictEqual(schedG2.some((s) => s.idJadwal === "J002"), true);
    assert.strictEqual(schedG2.some((s) => s.idJadwal === "J001"), false);
  });

  test("Test 3: Guru 01 attempts to open/modify Guru 02 schedule or session -> FORBIDDEN (403)", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    const tGuru2 = tokenOf(sb, "guru2", "test-guru-2");

    sb.db.JADWAL.data.push(["J002", "SENIN", "07:00", "08:30", "8", "Bahasa Inggris", "G002", "AKTIF", "2026-10-01"]);

    // Guru 1 attempts to start attendance session on Guru 2's schedule
    const startRes = sb.call("startAttendanceSession", { idJadwal: "J002" }, tGuru1);
    assert.strictEqual(startRes.success, false);
    assert.strictEqual(startRes.code, "FORBIDDEN");

    // Guru 2 starts their session legally
    const sesG2 = sb.call("startAttendanceSession", { idJadwal: "J002" }, tGuru2).data;

    // Guru 1 attempts to get student list of Guru 2's session
    const accessRes = sb.call("getSessionAttendance", { idSesi: sesG2.idSesi }, tGuru1);
    assert.strictEqual(accessRes.success, false);
    assert.strictEqual(accessRes.code, "FORBIDDEN");

    // Guru 1 attempts to close Guru 2's session
    const closeRes = sb.call("closeAttendanceSession", { idSesi: sesG2.idSesi }, tGuru1);
    assert.strictEqual(closeRes.success, false);
    assert.strictEqual(closeRes.code, "FORBIDDEN");

    // Guru 1 attempts to modify Guru 2's schedule directly
    const editSchedRes = sb.call("saveTeacherSchedule", {
      schedule: { idJadwal: "J002", hari: "SENIN", jamMulai: "07:00", jamSelesai: "08:30", kelas: "8", mataPelajaran: "Hack", idGuru: "G002" }
    }, tGuru1);
    assert.strictEqual(editSchedRes.success, false);
    assert.strictEqual(editSchedRes.code, "FORBIDDEN");
  });

  test("Test 4 & 5: Guru 01 and Guru 02 report/recap export isolation", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    const tGuru2 = tokenOf(sb, "guru2", "test-guru-2");

    sb.db.JADWAL.data.push(["J002", "SENIN", "07:00", "08:30", "8", "Bahasa Inggris", "G002", "AKTIF", "2026-10-01"]);

    // Guru 1 records Ahmad (DU26001) in Class 7
    sb.call("scanAttendance", { idQr: "DU26001" }, tGuru1);

    // Guru 2 records Fani (DU26006) in Class 8
    const sesG2 = sb.call("startAttendanceSession", { idJadwal: "J002" }, tGuru2).data;
    sb.call("scanSessionAttendance", { idSesi: sesG2.idSesi, idQr: "DU26006" }, tGuru2);

    // Guru 1 report export: ONLY contains Ahmad, 0 records from Guru 2
    const recapG1 = sb.call("getAttendanceRecap", { tanggalMulai: "2026-10-05", tanggalAkhir: "2026-10-05" }, tGuru1).data;
    assert.strictEqual(recapG1.detail.length, 1);
    assert.strictEqual(recapG1.detail[0].idGuru, "G001");
    assert.strictEqual(recapG1.detail[0].nama, "Ahmad");
    assert.strictEqual(recapG1.summary[0].kelas, "7");

    // Guru 2 report export: ONLY contains Fani, 0 records from Guru 1
    const recapG2 = sb.call("getAttendanceRecap", { tanggalMulai: "2026-10-05", tanggalAkhir: "2026-10-05" }, tGuru2).data;
    assert.strictEqual(recapG2.detail.length, 1);
    assert.strictEqual(recapG2.detail[0].idGuru, "G002");
    assert.strictEqual(recapG2.detail[0].nama, "Fani");
    assert.strictEqual(recapG2.summary[0].kelas, "8");

    // Even if Guru 1 maliciously passes idGuru: 'G002' in query, server ignores it and keeps G001
    const hijacked = sb.call("getAttendanceRecap", { idGuru: "G002", tanggalMulai: "2026-10-05", tanggalAkhir: "2026-10-05" }, tGuru1).data;
    assert.strictEqual(hijacked.detail.length, 1);
    assert.strictEqual(hijacked.detail[0].idGuru, "G001");
  });

  test("Test 6: Guru 01 creates a new schedule -> strictly belongs to Guru 01", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    const tGuru2 = tokenOf(sb, "guru2", "test-guru-2");

    // Guru 1 creates schedule, maliciously trying to assign it to Guru 2 (G002)
    const newSched = sb.call("createSchedule", {
      schedule: {
        hari: "SELASA",
        jamMulai: "08:00",
        jamSelesai: "09:30",
        kelas: "7",
        mataPelajaran: "Fisika",
        idGuru: "G002" // spoof attempt
      }
    }, tGuru1).data;

    // Server must override idGuru with authenticated user (G001)
    assert.strictEqual(newSched.idGuru, "G001");

    // Guru 1 can see it
    const g1List = sb.call("getSchedules", {}, tGuru1).data;
    assert.strictEqual(g1List.some((s) => s.idJadwal === newSched.idJadwal), true);

    // Guru 2 CANNOT see it
    const g2List = sb.call("getSchedules", {}, tGuru2).data;
    assert.strictEqual(g2List.some((s) => s.idJadwal === newSched.idJadwal), false);
  });

  test("Test 7: Guru 01 performs manual attendance -> strictly bound to Guru 01", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    const tGuru2 = tokenOf(sb, "guru2", "test-guru-2");

    // Guru 1 marks manual attendance for Budi (DU26002, NIS 102) in J001
    const res = sb.call("updateAttendanceStatus", {
      idJadwal: "J001",
      nis: "102",
      status: "HADIR",
      keterangan: "Absensi Manual",
      tanggal: "2026-10-05"
    }, tGuru1);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.idGuru, "G001");
    assert.strictEqual(res.data.status, "HADIR");

    // Guru 2 tries to update that attendance record -> FORBIDDEN
    const editByG2 = sb.call("updateAttendanceStatus", {
      idAbsensi: res.data.idAbsensi,
      idJadwal: "J001",
      nis: "102",
      status: "ALPHA"
    }, tGuru2);
    assert.strictEqual(editByG2.success, false);
    assert.strictEqual(editByG2.code, "FORBIDDEN");
  });

  test("Test 8: Guru 01 performs QR scan attendance -> strictly bound to Guru 01 and isolated", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");
    const tGuru2 = tokenOf(sb, "guru2", "test-guru-2");

    // Guru 1 scans student Ahmad (DU26001)
    const scanRes = sb.call("scanAttendance", { idQr: "DU26001" }, tGuru1);
    assert.strictEqual(scanRes.success, true);
    assert.strictEqual(scanRes.data.schedule.idGuru, "G001");

    // Check attendance row in database: ID_GURU is G001
    const lastRow = sb.db.ABSENSI.data[sb.db.ABSENSI.data.length - 1];
    assert.strictEqual(lastRow[9], "G001"); // ID_GURU index in ABSENSI

    // Guru 2 cannot see this attendance in getAttendance
    const hGuru2 = sb.call("getAttendance", { tanggal: "2026-10-05" }, tGuru2).data;
    assert.strictEqual(hGuru2.length, 0);

    // Guru 1 sees it in getAttendance
    const hGuru1 = sb.call("getAttendance", { tanggal: "2026-10-05" }, tGuru1).data;
    assert.strictEqual(hGuru1.length, 1);
    assert.strictEqual(hGuru1[0].nama, "Ahmad");
  });

  console.log("daily homeroom attendance migration validation");
  test("manual attendance first, then QR scan -> DUPLICATE_ATTENDANCE", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");

    // 1. Guru 1 creates manual attendance for Budi (DU26002, NIS 102)
    const mRes = sb.call("updateAttendanceStatus", {
      nis: "102",
      status: "IZIN",
      keterangan: "Surat dokter",
      tanggal: "2026-10-05"
    }, tGuru1);
    assert.strictEqual(mRes.success, true);
    assert.strictEqual(mRes.data.status, "IZIN");

    // 2. Scan attempt for the same student on the same day -> rejected
    const scanRes = sb.call("scanAttendance", { idQr: "DU26002" }, tGuru1);
    assert.strictEqual(scanRes.success, false);
    assert.strictEqual(scanRes.code, "DUPLICATE_ATTENDANCE");

    // 3. Verify exactly 1 attendance record exists for Budi
    const budiRows = sb.db.ABSENSI.data.filter((r) => r[2] === "DU26002");
    assert.strictEqual(budiRows.length, 1);
    assert.strictEqual(budiRows[0][11], "IZIN");
  });

  test("QR scan first, then manual edit -> updates in-place without duplicate row", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");

    // 1. Scan Ahmad
    const scanRes = sb.call("scanAttendance", { idQr: "DU26001" }, tGuru1);
    assert.strictEqual(scanRes.success, true);
    assert.strictEqual(scanRes.data.status, "HADIR");

    const countBefore = sb.db.ABSENSI.data.length;

    // 2. Homeroom teacher updates status to TERLAMBAT with note
    const updateRes = sb.call("updateAttendanceStatus", {
      nis: "101",
      status: "TERLAMBAT",
      keterangan: "Terjebak macet",
      tanggal: "2026-10-05"
    }, tGuru1);
    assert.strictEqual(updateRes.success, true);
    assert.strictEqual(updateRes.data.status, "TERLAMBAT");

    // Total rows in database must remain unchanged (in-place correction)
    assert.strictEqual(sb.db.ABSENSI.data.length, countBefore);

    const ahmadRows = sb.db.ABSENSI.data.filter((r) => r[2] === "DU26001");
    assert.strictEqual(ahmadRows.length, 1);
    assert.strictEqual(ahmadRows[0][11], "TERLAMBAT");
    assert.strictEqual(ahmadRows[0][12], "Terjebak macet");
  });

  test("same QR code can be reused on the next day", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");

    // Day 1: 2026-10-05 (Monday)
    const scanDay1 = sb.call("scanAttendance", { idQr: "DU26001" }, tGuru1);
    assert.strictEqual(scanDay1.success, true);

    // Advance clock to Day 2: 2026-10-06 (Tuesday 07:05)
    sb.setNow(jakarta("2026-10-06", "07:05"));
    const tGuru1Day2 = tokenOf(sb, "guru1", "test-guru-1");

    // Day 2 scan with the same permanent QR
    const scanDay2 = sb.call("scanAttendance", { idQr: "DU26001" }, tGuru1Day2);
    assert.strictEqual(scanDay2.success, true);
    assert.strictEqual(scanDay2.data.tanggal, "2026-10-06");

    // There should now be two distinct daily attendance rows for Ahmad
    const ahmadRows = sb.db.ABSENSI.data.filter((r) => r[2] === "DU26001");
    assert.strictEqual(ahmadRows.length, 2);
    assert.strictEqual(ahmadRows[0][6], "2026-10-05");
    assert.strictEqual(ahmadRows[1][6], "2026-10-06");
  });

  test("payload manipulation cannot bypass class restrictions in manual attendance", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1"); // Class 7 teacher

    // Fani is in Class 8 (NIS 106)
    const hackAttempt = sb.call("updateAttendanceStatus", {
      nis: "106",
      status: "HADIR",
      kelas: "7", // Tampered parameter attempting to fake class
      tanggal: "2026-10-05"
    }, tGuru1);

    assert.strictEqual(hackAttempt.success, false);
    assert.strictEqual(hackAttempt.code, "WRONG_CLASS");
  });

  test("historical records with old ID_JADWAL and MATA_PELAJARAN remain readable", () => {
    const sb = fresh();
    const tGuru1 = tokenOf(sb, "guru1", "test-guru-1");

    // Inject historical attendance row from previous subject-based system
    sb.db.ABSENSI.data.push([
      "ABS_HIST_01",
      "J001",
      "DU26001",
      "101",
      "Ahmad",
      "7",
      "2026-09-01",
      "08:30",
      "Matematika",
      "G001",
      "Guru Satu",
      "HADIR",
      "Sesi Pelajaran 1"
    ]);

    // Read attendance for the historical date
    const hist = sb.call("getAttendance", { tanggal: "2026-09-01" }, tGuru1);
    assert.strictEqual(hist.success, true);
    assert.strictEqual(hist.data.length, 1);
    assert.strictEqual(hist.data[0].idJadwal, "J001");
    assert.strictEqual(hist.data[0].mataPelajaran, "Matematika");
    assert.strictEqual(hist.data[0].nama, "Ahmad");

    // Read recap across date range including historical date
    const recap = sb.call("getAttendanceRecap", {
      tanggalMulai: "2026-09-01",
      tanggalAkhir: "2026-09-01"
    }, tGuru1);
    assert.strictEqual(recap.success, true);
    assert.strictEqual(recap.data.detail.length, 1);
    assert.strictEqual(recap.data.detail[0].mataPelajaran, "Matematika");
  });

  console.log("\n" + pass + "/" + (pass + failures.length) + " passed");
  if (failures.length) {
    console.log("FAILED: " + failures.join("; "));
    process.exitCode = 1;
  }
}

module.exports = { createSandbox, buildDb, jakarta, sheetsTimeOnly, sheetsDateOnly, sha256, TZ };
if (require.main === module) run();
