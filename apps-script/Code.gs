/**
 * Absensi Siswa QR - Google Apps Script backend (single file).
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New deployment >
 * Web app (Execute as: Me, Who has access: Anyone). Copy the /exec URL into
 * NEXT_PUBLIC_APPS_SCRIPT_URL.
 *
 * The frontend POSTs JSON (Content-Type text/plain, so no CORS preflight):
 *   { action: "...", token: "...", ...fields }
 * Responses: { success:true, data } | { success:false, code, message }
 *
 * Rules: server time (Asia/Jakarta) is authoritative; the client only sends
 * identifiers; ID_QR is never generated for existing students or changed;
 * no row is ever deleted; PASSWORD_HASH (SHA-256 hex) is never returned.
 */

var SHEET_ID = '1eTPpoc7i7T0_cpZZIIsIWGtdizEgA8QyObG_LPLb0fk';
var TZ = 'Asia/Jakarta';
var DAYS = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
var SETTING_KEYS = ['NAMA_SEKOLAH', 'BATAS_KETERLAMBATAN', 'ZONA_WAKTU', 'DURASI_SESSION', 'VALIDASI_JAM'];
var SETTING_DEFAULTS = {
  NAMA_SEKOLAH: '',
  BATAS_KETERLAMBATAN: '15',
  ZONA_WAKTU: 'Asia/Jakarta',
  DURASI_SESSION: '120',
  VALIDASI_JAM: 'true'
};
var ABSENSI_HEADERS = [
  'ID_ABSENSI', 'ID_JADWAL', 'ID_QR', 'NIS', 'NAMA', 'KELAS', 'TANGGAL', 'JAM',
  'MATA_PELAJARAN', 'ID_GURU', 'NAMA_GURU', 'STATUS', 'KETERANGAN'
];

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function doGet() {
  return jsonOut({ success: true, data: { service: 'absensi-siswa-qr', ok: true } });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = String(body.action || '');
    // Client contract: { action, token, ...fields } (fields are flat in the body).
    var payload = {};
    Object.keys(body).forEach(function (k) {
      if (k !== 'action' && k !== 'token') payload[k] = body[k];
    });
    var handler = ROUTES[action];
    if (!handler) return jsonOut(fail('VALIDATION', 'Aksi tidak dikenal.'));
    return jsonOut({ success: true, data: handler(payload, body.token || '') });
  } catch (err) {
    if (err && err.isApiError) return jsonOut(fail(err.code, err.message));
    return jsonOut(fail('SERVER_ERROR', 'Terjadi kesalahan pada server.'));
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail(code, message) {
  return { success: false, code: code, message: message };
}

function apiError(code, message) {
  var err = new Error(message);
  err.isApiError = true;
  err.code = code;
  return err;
}

var ROUTES = {
  login: login,
  getDashboard: function (p, t) { requireAuth(t); return getDashboard(p); },
  getClasses: function (p, t) { requireAuth(t); return getClasses(p); },
  getAttendance: function (p, t) { requireAuth(t); return getAttendance(p); },
  getTodaySchedule: function (p, t) { return getTodaySchedule(requireAuth(t)); },
  getSchedules: function (p, t) { requireAuth(t); return getSchedules(); },
  getStudentByQR: function (p, t) { return getStudentByQR(p, requireAuth(t)); },
  scanAttendance: function (p, t) { return scanAttendance(p, requireAuth(t)); },
  getStudents: function (p, t) { requireAdmin(t); return getStudents(); },
  getTeachers: function (p, t) { requireAdmin(t); return getTeachers(); },
  getSettings: function (p, t) { requireAdmin(t); return getSettings(); },
  saveStudent: function (p, t) { requireAdmin(t); return withLock(function () { return saveStudent(p); }); },
  saveTeacher: function (p, t) { requireAdmin(t); return withLock(function () { return saveTeacher(p); }); },
  saveSchedule: function (p, t) { requireAdmin(t); return withLock(function () { return saveSchedule(p); }); },
  updateSettings: function (p, t) { requireAdmin(t); return withLock(function () { return updateSettings(p); }); }
};

/* ------------------------------------------------------------------ */
/* Time helpers (server clock, Asia/Jakarta)                           */
/* ------------------------------------------------------------------ */

function nowDate() { return new Date(); }
function fmt(date, pattern) { return Utilities.formatDate(date, TZ, pattern); }
function todayISO(now) { return fmt(now, 'yyyy-MM-dd'); }
function timeHM(now) { return fmt(now, 'HH:mm'); }
function weekdayName(now) { return DAYS[parseInt(fmt(now, 'u'), 10) % 7]; }

function toMinutes(hm) {
  var m = /^(\d{1,2}):(\d{2})/.exec(String(hm || ''));
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Google Sheets silently converts "2026-10-05" and "07:00" into Date objects.
 * Time-only cells come back as 1899/1900 dates; real dates have a modern year.
 */
function normalizeCell(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return v.getFullYear() < 1950 ? fmt(v, 'HH:mm') : fmt(v, 'yyyy-MM-dd');
  }
  return String(v).trim();
}

function normHeader(h) {
  return String(h || '').trim().toUpperCase().replace(/\s+/g, '_');
}

/* ------------------------------------------------------------------ */
/* Sheet access                                                        */
/* ------------------------------------------------------------------ */

function getSpreadsheet() {
  try {
    return SpreadsheetApp.openById(SHEET_ID);
  } catch (e) {
    return SpreadsheetApp.getActiveSpreadsheet();
  }
}

function getSheet(name) {
  var sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw apiError('SERVER_ERROR', 'Sheet ' + name + ' tidak ditemukan.');
  return sheet;
}

/** Reads a sheet into { headers: [NORMALISED], rows: [{FIELD: value, _row: n}] }. */
function readTable(name) {
  var sheet = getSheet(name);
  var values = sheet.getDataRange().getValues();
  if (!values.length) return { sheet: sheet, headers: [], rows: [] };
  var headers = values[0].map(normHeader);
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var empty = true;
    var obj = { _row: r + 1 };
    for (var c = 0; c < headers.length; c++) {
      var v = normalizeCell(row[c]);
      if (v !== '') empty = false;
      if (headers[c]) obj[headers[c]] = v;
    }
    if (!empty) rows.push(obj);
  }
  return { sheet: sheet, headers: headers, rows: rows };
}

/** Writes values by header order as text so Sheets never auto-converts them. */
function writeRecord(sheet, headers, record, rowNumber) {
  var rowValues = headers.map(function (h) {
    var v = record[h];
    return v === undefined || v === null ? '' : String(v);
  });
  var row = rowNumber || sheet.getLastRow() + 1;
  var range = sheet.getRange(row, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([rowValues]);
  return row;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw apiError('SERVER_BUSY', 'Server sedang sibuk. Silakan coba lagi.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function readSettingsTable() {
  var sheet = getSheet('PENGATURAN');
  var values = sheet.getDataRange().getValues();
  var found = {};
  for (var r = 0; r < values.length; r++) {
    var key = normHeader(values[r][0]);
    if (SETTING_KEYS.indexOf(key) !== -1) found[key] = { row: r + 1, value: normalizeCell(values[r][1]) };
  }
  return { sheet: sheet, found: found };
}

function getSettings() {
  var t = readSettingsTable();
  var out = {};
  SETTING_KEYS.forEach(function (k) {
    out[k] = t.found[k] && t.found[k].value !== '' ? t.found[k].value : SETTING_DEFAULTS[k];
  });
  out.ZONA_WAKTU = TZ; // locked: server clock is authoritative
  return out;
}

function updateSettings(p) {
  var incoming = p.settings || {};
  var t = readSettingsTable();
  SETTING_KEYS.forEach(function (k) {
    if (k === 'ZONA_WAKTU') return; // never changed from the client
    if (incoming[k] === undefined) return;
    var value = String(incoming[k]).trim();
    if (k === 'BATAS_KETERLAMBATAN' && !/^\d{1,3}$/.test(value)) {
      throw apiError('VALIDATION', 'Batas keterlambatan harus berupa angka menit.');
    }
    if (k === 'DURASI_SESSION' && !/^\d{1,4}$/.test(value) || k === 'DURASI_SESSION' && parseInt(value, 10) < 1) {
      throw apiError('VALIDATION', 'Durasi sesi harus berupa angka menit (minimal 1).');
    }
    if (k === 'VALIDASI_JAM') value = value === 'false' ? 'false' : 'true';
    var cellRow = t.found[k] ? t.found[k].row : t.sheet.getLastRow() + 1;
    var range = t.sheet.getRange(cellRow, 1, 1, 2);
    range.setNumberFormat('@');
    range.setValues([[k, value]]);
  });
  return getSettings();
}

/* ------------------------------------------------------------------ */
/* Crypto / auth                                                       */
/* ------------------------------------------------------------------ */

function bytesToHex(bytes) {
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function sha256Hex(text) {
  return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

function tokenSecret() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('TOKEN_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', s);
  }
  return s;
}

function sign(data) {
  return bytesToHex(Utilities.computeHmacSha256Signature(data, tokenSecret()));
}

function makeToken(user, expSeconds) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify({ idGuru: user.idGuru, role: user.role, exp: expSeconds }));
  return body + '.' + sign(body);
}

function parseToken(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  if (sign(parts[0]) !== parts[1]) return null;
  try {
    var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function requireAuth(token) {
  var claims = parseToken(token);
  var nowSec = Math.floor(nowDate().getTime() / 1000);
  if (!claims || !claims.exp || claims.exp < nowSec) {
    throw apiError('UNAUTHENTICATED', 'Sesi berakhir. Silakan login kembali.');
  }
  var teacher = readTable('GURU').rows.filter(function (r) { return r.ID_GURU === claims.idGuru; })[0];
  if (!teacher || teacher.STATUS !== 'AKTIF') {
    throw apiError('UNAUTHENTICATED', 'Akun tidak aktif. Silakan login kembali.');
  }
  return {
    idGuru: teacher.ID_GURU,
    namaGuru: teacher.NAMA_GURU,
    role: teacher.ROLE === 'ADMIN' ? 'ADMIN' : 'GURU'
  };
}

function requireAdmin(token) {
  var user = requireAuth(token);
  if (user.role !== 'ADMIN') throw apiError('FORBIDDEN', 'Anda tidak memiliki akses untuk tindakan ini.');
  return user;
}

function login(p) {
  var username = String(p.username || '').trim().toLowerCase();
  var password = String(p.password || '');
  if (!username || !password) throw apiError('VALIDATION', 'Username dan password wajib diisi.');
  var teacher = readTable('GURU').rows.filter(function (r) {
    return String(r.USERNAME || '').toLowerCase() === username;
  })[0];
  var hash = sha256Hex(password);
  if (!teacher || String(teacher.PASSWORD_HASH || '').toLowerCase() !== hash) {
    throw apiError('INVALID_CREDENTIALS', 'Username atau password salah.');
  }
  if (teacher.STATUS !== 'AKTIF') throw apiError('ACCOUNT_INACTIVE', 'Akun tidak aktif. Hubungi admin.');
  var settings = getSettings();
  var minutes = parseInt(settings.DURASI_SESSION, 10) || 120;
  var expSeconds = Math.floor(nowDate().getTime() / 1000) + minutes * 60;
  var role = teacher.ROLE === 'ADMIN' ? 'ADMIN' : 'GURU';
  return {
    idGuru: teacher.ID_GURU,
    namaGuru: teacher.NAMA_GURU,
    username: teacher.USERNAME,
    role: role,
    token: makeToken({ idGuru: teacher.ID_GURU, role: role }, expSeconds),
    expiresAt: expSeconds * 1000
  };
}

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

function mapStudent(r) {
  return {
    no: parseInt(r.NO, 10) || 0,
    nama: r.NAMA || '',
    nis: r.NIS || '',
    nisn: r.NISN || '',
    ttl: r.TTL || '',
    alamat: r.ALAMAT || '',
    idQr: r.ID_QR || '',
    kelas: r.KELAS || '',
    status: r.STATUS === 'NONAKTIF' ? 'NONAKTIF' : 'AKTIF'
  };
}

function mapTeacher(r) {
  return {
    idGuru: r.ID_GURU || '',
    nip: r.NIP || '',
    namaGuru: r.NAMA_GURU || '',
    username: r.USERNAME || '',
    status: r.STATUS === 'NONAKTIF' ? 'NONAKTIF' : 'AKTIF',
    role: r.ROLE === 'ADMIN' ? 'ADMIN' : 'GURU'
  };
}

function teacherNameMap() {
  var map = {};
  readTable('GURU').rows.forEach(function (r) { map[r.ID_GURU] = r.NAMA_GURU; });
  return map;
}

function mapSchedule(r, names) {
  return {
    idJadwal: r.ID_JADWAL || '',
    hari: (r.HARI || '').toUpperCase(),
    jamMulai: r.JAM_MULAI || '',
    jamSelesai: r.JAM_SELESAI || '',
    kelas: r.KELAS || '',
    mataPelajaran: r.MATA_PELAJARAN || '',
    idGuru: r.ID_GURU || '',
    namaGuru: names[r.ID_GURU] || '',
    status: r.STATUS === 'NONAKTIF' ? 'NONAKTIF' : 'AKTIF',
    tglDibuat: r.TGL_DIBUAT || ''
  };
}

function mapAttendance(r) {
  return {
    idAbsensi: r.ID_ABSENSI || '',
    idJadwal: r.ID_JADWAL || '',
    idQr: r.ID_QR || '',
    nis: r.NIS || '',
    nama: r.NAMA || '',
    kelas: r.KELAS || '',
    tanggal: r.TANGGAL || '',
    jam: r.JAM || '',
    mataPelajaran: r.MATA_PELAJARAN || '',
    idGuru: r.ID_GURU || '',
    namaGuru: r.NAMA_GURU || '',
    status: r.STATUS || 'HADIR',
    keterangan: r.KETERANGAN || ''
  };
}

/* ------------------------------------------------------------------ */
/* Read endpoints                                                      */
/* ------------------------------------------------------------------ */

function getStudents() {
  return readTable('SISWA').rows.map(mapStudent);
}

function getTeachers() {
  return readTable('GURU').rows.map(mapTeacher);
}

function getSchedules() {
  var names = teacherNameMap();
  return readTable('JADWAL').rows.map(function (r) { return mapSchedule(r, names); });
}

function dateParam(p) {
  var d = String(p.tanggal || '').trim();
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw apiError('VALIDATION', 'Format tanggal harus yyyy-MM-dd.');
  return d || todayISO(nowDate());
}

function attendanceOn(tanggal) {
  return readTable('ABSENSI').rows.filter(function (r) { return r.TANGGAL === tanggal; });
}

function getDashboard(p) {
  var tanggal = dateParam(p);
  var active = readTable('SISWA').rows.filter(function (r) { return r.STATUS !== 'NONAKTIF'; });
  var records = attendanceOn(tanggal);
  var count = function (s) { return records.filter(function (r) { return r.STATUS === s; }).length; };
  var seen = {};
  records.forEach(function (r) { seen[r.ID_QR] = true; });
  var present = active.filter(function (s) { return seen[s.ID_QR]; }).length;
  return {
    totalSiswa: active.length,
    hadir: count('HADIR'),
    terlambat: count('TERLAMBAT'),
    izin: count('IZIN'),
    sakit: count('SAKIT'),
    alpha: count('ALPHA'),
    tanpaKeterangan: active.length - present
  };
}

function getClasses(p) {
  var tanggal = dateParam(p);
  var active = readTable('SISWA').rows.filter(function (r) { return r.STATUS !== 'NONAKTIF'; });
  var records = attendanceOn(tanggal);
  var seen = {};
  records.forEach(function (r) { seen[r.ID_QR] = true; });
  var byClass = {};
  active.forEach(function (s) {
    var k = s.KELAS || '-';
    if (!byClass[k]) byClass[k] = { kelas: k, total: 0, hadir: 0, terlambat: 0, belumHadir: 0 };
    byClass[k].total++;
    if (!seen[s.ID_QR]) byClass[k].belumHadir++;
  });
  records.forEach(function (r) {
    var c = byClass[r.KELAS];
    if (!c) return;
    if (r.STATUS === 'HADIR') c.hadir++;
    if (r.STATUS === 'TERLAMBAT') c.terlambat++;
  });
  return Object.keys(byClass).sort().map(function (k) { return byClass[k]; });
}

function getAttendance(p) {
  var rows = readTable('ABSENSI').rows;
  if (p.tanggal) rows = rows.filter(function (r) { return r.TANGGAL === String(p.tanggal); });
  if (p.kelas) rows = rows.filter(function (r) { return r.KELAS === String(p.kelas); });
  rows.sort(function (a, b) {
    var ka = (a.TANGGAL || '') + ' ' + (a.JAM || '');
    var kb = (b.TANGGAL || '') + ' ' + (b.JAM || '');
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  var limit = parseInt(p.limit, 10);
  if (limit > 0) rows = rows.slice(0, limit);
  return rows.map(mapAttendance);
}

function getTodaySchedule(user) {
  var day = weekdayName(nowDate());
  var names = teacherNameMap();
  return readTable('JADWAL').rows
    .filter(function (r) {
      return r.STATUS !== 'NONAKTIF' && String(r.HARI).toUpperCase() === day &&
        (user.role === 'ADMIN' || r.ID_GURU === user.idGuru);
    })
    .map(function (r) { return mapSchedule(r, names); });
}

/* ------------------------------------------------------------------ */
/* Scan                                                                */
/* ------------------------------------------------------------------ */

function findStudentByQr(idQr) {
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(idQr)) throw apiError('QR_NOT_REGISTERED', 'QR tidak terdaftar.');
  var s = readTable('SISWA').rows.filter(function (r) { return r.ID_QR === idQr; })[0];
  if (!s) throw apiError('QR_NOT_REGISTERED', 'QR tidak terdaftar.');
  if (s.STATUS === 'NONAKTIF') throw apiError('STUDENT_INACTIVE', 'Siswa tidak aktif.');
  return s;
}

/** Finds today's schedule for the student's class that this user may scan for. */
function resolveActiveSchedule(student, user, now, settings) {
  var day = weekdayName(now);
  var names = teacherNameMap();
  var candidates = readTable('JADWAL').rows.filter(function (r) {
    return r.STATUS !== 'NONAKTIF' && String(r.HARI).toUpperCase() === day &&
      r.KELAS === student.KELAS && (user.role === 'ADMIN' || r.ID_GURU === user.idGuru);
  });
  if (!candidates.length) throw apiError('NO_ACTIVE_SCHEDULE', 'Tidak ada jadwal aktif untuk kelas ini hari ini.');
  if (settings.VALIDASI_JAM === 'false') return mapSchedule(candidates[0], names);
  var nowMin = toMinutes(timeHM(now));
  var inWindow = candidates.filter(function (r) {
    return nowMin >= toMinutes(r.JAM_MULAI) && nowMin <= toMinutes(r.JAM_SELESAI);
  })[0];
  if (!inWindow) throw apiError('OUT_OF_SCHEDULE_TIME', 'Di luar jam pelajaran yang dijadwalkan.');
  return mapSchedule(inWindow, names);
}

function computeStatus(schedule, now, settings) {
  var limit = parseInt(settings.BATAS_KETERLAMBATAN, 10);
  if (isNaN(limit)) limit = 15;
  return toMinutes(timeHM(now)) <= toMinutes(schedule.jamMulai) + limit ? 'HADIR' : 'TERLAMBAT';
}

function findDuplicate(idQr, idJadwal, tanggal) {
  return readTable('ABSENSI').rows.filter(function (r) {
    return r.ID_QR === idQr && r.ID_JADWAL === idJadwal && r.TANGGAL === tanggal;
  })[0];
}

function getStudentByQR(p, user) {
  var student = findStudentByQr(String(p.idQr || '').trim());
  var now = nowDate();
  var settings = getSettings();
  var schedule = resolveActiveSchedule(student, user, now, settings);
  var result = {
    student: mapStudent(student),
    schedule: schedule,
    status: computeStatus(schedule, now, settings),
    jam: timeHM(now)
  };
  var dup = findDuplicate(student.ID_QR, schedule.idJadwal, todayISO(now));
  if (dup) result.alreadyRecorded = { jam: dup.JAM, status: dup.STATUS };
  return result;
}

function scanAttendance(p, user) {
  return withLock(function () {
    var student = findStudentByQr(String(p.idQr || '').trim());
    var now = nowDate();
    var settings = getSettings();
    var schedule = resolveActiveSchedule(student, user, now, settings);
    var tanggal = todayISO(now);
    var dup = findDuplicate(student.ID_QR, schedule.idJadwal, tanggal);
    if (dup) throw apiError('DUPLICATE_ATTENDANCE', 'Siswa sudah absen pada jadwal ini (pukul ' + dup.JAM + ').');
    var status = computeStatus(schedule, now, settings);
    var jam = timeHM(now);
    var table = readTable('ABSENSI');
    var headers = table.headers.length ? table.headers : ABSENSI_HEADERS;
    var record = {
      ID_ABSENSI: 'ABS' + fmt(now, 'yyyyMMddHHmmss') + String(table.rows.length + 1),
      ID_JADWAL: schedule.idJadwal,
      ID_QR: student.ID_QR,
      NIS: student.NIS,
      NAMA: student.NAMA,
      KELAS: student.KELAS,
      TANGGAL: tanggal,
      JAM: jam,
      MATA_PELAJARAN: schedule.mataPelajaran,
      ID_GURU: schedule.idGuru,
      NAMA_GURU: schedule.namaGuru,
      STATUS: status,
      KETERANGAN: ''
    };
    writeRecord(table.sheet, headers, record);
    return { student: mapStudent(student), schedule: schedule, status: status, jam: jam };
  });
}

/* ------------------------------------------------------------------ */
/* Admin writes                                                        */
/* ------------------------------------------------------------------ */

function str(v) { return v === undefined || v === null ? '' : String(v).trim(); }

function nextSequentialId(rows, field, prefix, width) {
  var max = 0;
  rows.forEach(function (r) {
    var m = new RegExp('^' + prefix + '(\\d+)$').exec(r[field] || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var n = String(max + 1);
  while (n.length < width) n = '0' + n;
  return prefix + n;
}

function nextStudentQr(rows) {
  var yy = fmt(nowDate(), 'yy');
  var prefix = 'DU' + yy;
  var max = 0;
  rows.forEach(function (r) {
    var m = new RegExp('^' + prefix + '(\\d{3})$').exec(r.ID_QR || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var n = String(max + 1);
  while (n.length < 3) n = '0' + n;
  return prefix + n;
}

function saveStudent(p) {
  var s = p.student || {};
  var nama = str(s.nama), nis = str(s.nis), kelas = str(s.kelas);
  if (!nama || !nis || !kelas) throw apiError('VALIDATION', 'Nama, NIS, dan Kelas wajib diisi.');
  var t = readTable('SISWA');
  var status = str(s.status) === 'NONAKTIF' ? 'NONAKTIF' : 'AKTIF';
  var existing = t.rows.filter(function (r) { return str(s.idQr) && r.ID_QR === str(s.idQr); })[0];
  if (existing) {
    // ID_QR is permanent: only editable fields change, row stays in place.
    var updated = {};
    Object.keys(existing).forEach(function (k) { updated[k] = existing[k]; });
    updated.NAMA = nama; updated.NISN = str(s.nisn); updated.KELAS = kelas;
    updated.TTL = str(s.ttl); updated.ALAMAT = str(s.alamat); updated.STATUS = status;
    writeRecord(t.sheet, t.headers, updated, existing._row);
    return mapStudent(updated);
  }
  if (t.rows.some(function (r) { return r.NIS === nis; })) {
    throw apiError('VALIDATION', 'NIS sudah terdaftar.');
  }
  var created = {
    NO: String(t.rows.reduce(function (m, r) { return Math.max(m, parseInt(r.NO, 10) || 0); }, 0) + 1),
    NAMA: nama, NIS: nis, NISN: str(s.nisn), TTL: str(s.ttl), ALAMAT: str(s.alamat),
    ID_QR: nextStudentQr(t.rows), KELAS: kelas, STATUS: status
  };
  writeRecord(t.sheet, t.headers, created);
  return mapStudent(created);
}

function saveTeacher(p) {
  var g = p.teacher || {};
  var nama = str(g.namaGuru), username = str(g.username).toLowerCase();
  if (!nama || !username) throw apiError('VALIDATION', 'Nama dan username wajib diisi.');
  var t = readTable('GURU');
  var status = str(g.status) === 'NONAKTIF' ? 'NONAKTIF' : 'AKTIF';
  var role = str(g.role) === 'ADMIN' ? 'ADMIN' : 'GURU';
  var existing = t.rows.filter(function (r) { return str(g.idGuru) && r.ID_GURU === str(g.idGuru); })[0];
  var clash = t.rows.filter(function (r) {
    return String(r.USERNAME || '').toLowerCase() === username && (!existing || r.ID_GURU !== existing.ID_GURU);
  })[0];
  if (clash) throw apiError('USERNAME_TAKEN', 'Username sudah digunakan.');
  var password = str(g.password);
  if (existing) {
    var updated = {};
    Object.keys(existing).forEach(function (k) { updated[k] = existing[k]; });
    updated.NIP = str(g.nip); updated.NAMA_GURU = nama; updated.USERNAME = username;
    updated.STATUS = status; updated.ROLE = role;
    if (password) updated.PASSWORD_HASH = sha256Hex(password); // otherwise hash is kept untouched
    writeRecord(t.sheet, t.headers, updated, existing._row);
    return mapTeacher(updated);
  }
  if (!password) throw apiError('VALIDATION', 'Password wajib diisi untuk guru baru.');
  var created = {
    ID_GURU: nextSequentialId(t.rows, 'ID_GURU', 'G', 3),
    NIP: str(g.nip), NAMA_GURU: nama, USERNAME: username,
    PASSWORD_HASH: sha256Hex(password), STATUS: status, ROLE: role
  };
  writeRecord(t.sheet, t.headers, created);
  return mapTeacher(created);
}

function validHM(v) { return /^([01]?\d|2[0-3]):[0-5]\d$/.test(v); }

function padHM(v) { return v.length === 4 ? '0' + v : v; }

function saveSchedule(p) {
  var j = p.schedule || {};
  var hari = str(j.hari).toUpperCase();
  var mulai = str(j.jamMulai), selesai = str(j.jamSelesai);
  var kelas = str(j.kelas), mapel = str(j.mataPelajaran), idGuru = str(j.idGuru);
  if (!hari || !mulai || !selesai || !kelas || !mapel || !idGuru) {
    throw apiError('VALIDATION', 'Semua field jadwal wajib diisi.');
  }
  if (DAYS.indexOf(hari) === -1) throw apiError('VALIDATION', 'Hari tidak valid.');
  if (!validHM(mulai) || !validHM(selesai)) throw apiError('VALIDATION', 'Format jam harus HH:mm.');
  mulai = padHM(mulai); selesai = padHM(selesai);
  if (toMinutes(selesai) <= toMinutes(mulai)) throw apiError('VALIDATION', 'Jam selesai harus setelah jam mulai.');
  if (!teacherNameMap()[idGuru]) throw apiError('VALIDATION', 'Guru tidak ditemukan.');
  var t = readTable('JADWAL');
  var status = str(j.status) === 'NONAKTIF' ? 'NONAKTIF' : 'AKTIF';
  var existing = t.rows.filter(function (r) { return str(j.idJadwal) && r.ID_JADWAL === str(j.idJadwal); })[0];
  var record = {};
  if (existing) Object.keys(existing).forEach(function (k) { record[k] = existing[k]; });
  record.HARI = hari; record.JAM_MULAI = mulai; record.JAM_SELESAI = selesai;
  record.KELAS = kelas; record.MATA_PELAJARAN = mapel; record.ID_GURU = idGuru; record.STATUS = status;
  if (!existing) {
    record.ID_JADWAL = nextSequentialId(t.rows, 'ID_JADWAL', 'J', 3);
    record.TGL_DIBUAT = todayISO(nowDate());
  }
  writeRecord(t.sheet, t.headers, record, existing ? existing._row : undefined);
  return mapSchedule(record, teacherNameMap());
}
