/**
 * Absensi Siswa QR - Google Apps Script backend (single file).
 * Migrasi: Absensi Harian Khusus Wali Kelas.
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New deployment >
 * Web app (Execute as: Me, Who has access: Anyone). Copy the /exec URL into
 * NEXT_PUBLIC_APPS_SCRIPT_URL.
 *
 * Kontrak:
 * - Server time (Asia/Jakarta) adalah sumber waktu otoritatif.
 * - Kunci unik absensi harian: ID_QR + TANGGAL (satu absensi per siswa per hari).
 * - Pengguna utama adalah Wali Kelas, dengan isolasi data kelas yang ketat.
 * - ID_QR siswa permanen dan tidak diubah.
 * - Tidak ada baris yang dihapus dari spreadsheet.
 * - PASSWORD_HASH tidak pernah dikembalikan ke client.
 */

var SHEET_ID = '1eTPpoc7i7T0_cpZZIIsIWGtdizEgA8QyObG_LPLb0fk';
var TZ = 'Asia/Jakarta';
var DAYS = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
var SETTING_KEYS = ['NAMA_SEKOLAH', 'BATAS_KETERLAMBATAN', 'ZONA_WAKTU', 'DURASI_SESSION', 'VALIDASI_JAM', 'JAM_MASUK'];
var SETTING_DEFAULTS = {
  NAMA_SEKOLAH: '',
  BATAS_KETERLAMBATAN: '15',
  ZONA_WAKTU: 'Asia/Jakarta',
  DURASI_SESSION: '120',
  VALIDASI_JAM: 'true',
  JAM_MASUK: '07:00'
};
var ABSENSI_HEADERS = [
  'ID_ABSENSI', 'ID_JADWAL', 'ID_QR', 'NIS', 'NAMA', 'KELAS', 'TANGGAL', 'JAM',
  'MATA_PELAJARAN', 'ID_GURU', 'NAMA_GURU', 'STATUS', 'KETERANGAN'
];
var SESI_HEADERS = [
  'ID_SESI', 'ID_GURU', 'ID_JADWAL', 'KELAS', 'MATA_PELAJARAN', 'TANGGAL', 'JAM_MULAI', 'STATUS', 'CREATED_AT'
];

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function doGet() {
  var info = {
    service: 'absensi-siswa-qr',
    mode: 'wali-kelas-harian',
    ok: true
  };
  try {
    var ss = getSpreadsheet();
    if (ss) {
      info.spreadsheetId = ss.getId();
      info.spreadsheetName = ss.getName();
      info.sheets = ss.getSheets().map(function (s) { return s.getName(); });
    }
  } catch (err) {
    info.spreadsheetError = err.message;
  }
  return jsonOut({ success: true, data: info });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = String(body.action || '');
    var payload = {};
    Object.keys(body).forEach(function (k) {
      if (k !== 'action' && k !== 'token') payload[k] = body[k];
    });
    var handler = ROUTES[action];
    if (!handler) return jsonOut(fail('VALIDATION', 'Aksi tidak dikenal.'));
    return jsonOut({ success: true, data: handler(payload, body.token || '') });
  } catch (err) {
    if (err && err.isApiError) return jsonOut(fail(err.code, err.message));
    return jsonOut(fail('SERVER_ERROR', (err && err.message) || 'Terjadi kesalahan pada server.'));
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
  getDashboard: function (p, t) { return getDashboard(p, requireAuth(t)); },
  getClasses: function (p, t) { return getClasses(p, requireAuth(t)); },
  getAttendance: function (p, t) { return getAttendance(p, requireAuth(t)); },
  getClassAttendance: function (p, t) { return getClassAttendance(p, requireAuth(t)); },
  getTodaySchedule: function (p, t) { return getTodaySchedule(requireAuth(t)); },
  getSchedules: function (p, t) { return getSchedules(requireAuth(t)); },
  getStudentByQR: function (p, t) { return getStudentByQR(p, requireAuth(t)); },
  scanAttendance: function (p, t) { return scanAttendance(p, requireAuth(t)); },
  getStudents: function (p, t) { requireAdmin(t); return getStudents(); },
  getTeachers: function (p, t) { requireAdmin(t); return getTeachers(); },
  getSettings: function (p, t) { requireAdmin(t); return getSettings(); },
  saveStudent: function (p, t) { requireAdmin(t); return withLock(function () { return saveStudent(p); }); },
  saveTeacher: function (p, t) { requireAdmin(t); return withLock(function () { return saveTeacher(p); }); },
  saveSchedule: function (p, t) { requireAdmin(t); return withLock(function () { return saveSchedule(p); }); },
  createSchedule: function (p, t) { return withLock(function () { return saveTeacherSchedule(p, requireAuth(t)); }); },
  saveTeacherSchedule: function (p, t) { return withLock(function () { return saveTeacherSchedule(p, requireAuth(t)); }); },
  updateSettings: function (p, t) { requireAdmin(t); return withLock(function () { return updateSettings(p); }); },

  // Teacher Attendance Session & Management (kompatibilitas alur yang ada)
  startAttendanceSession: function (p, t) { return withLock(function () { return startAttendanceSession(p, requireAuth(t)); }); },
  closeAttendanceSession: function (p, t) { return withLock(function () { return closeAttendanceSession(p, requireAuth(t)); }); },
  getActiveSession: function (p, t) { return getActiveSession(p, requireAuth(t)); },
  getSessionAttendance: function (p, t) { return getSessionAttendance(p, requireAuth(t)); },
  scanSessionAttendance: function (p, t) { return withLock(function () { return scanSessionAttendance(p, requireAuth(t)); }); },
  updateAttendanceStatus: function (p, t) { return updateAttendanceStatus(p, requireAuth(t)); },
  getAttendanceRecap: function (p, t) { return getAttendanceRecap(p, requireAuth(t)); }
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
  // 1. Cek bound container (jika script dibuat dari menu Extensions > Apps Script pada spreadsheet hasil clone)
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {}

  // 2. Cek apakah ada SPREADSHEET_ID yang dikonfigurasikan di Script Properties
  try {
    var propId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (propId && String(propId).trim() !== '') {
      return SpreadsheetApp.openById(String(propId).trim());
    }
  } catch (e) {}

  // 3. Fallback ke konstanta SHEET_ID
  if (typeof SHEET_ID === 'string' && SHEET_ID.trim() !== '') {
    return SpreadsheetApp.openById(SHEET_ID.trim());
  }

  throw apiError('SERVER_ERROR', 'Spreadsheet tidak ditemukan. Pastikan script terikat ke Google Sheets atau isi SPREADSHEET_ID.');
}

function getOrCreateSheet(name, defaultHeaders) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet ? ss.insertSheet(name) : null;
    if (sheet && defaultHeaders && defaultHeaders.length) {
      var range = sheet.getRange(1, 1, 1, defaultHeaders.length);
      range.setNumberFormat('@');
      range.setValues([defaultHeaders]);
    }
  }
  return sheet;
}

function getSheet(name) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    if (name === 'SESI_ABSENSI') return getOrCreateSheet(name, SESI_HEADERS);
    throw apiError('SERVER_ERROR', 'Sheet ' + name + ' tidak ditemukan.');
  }
  return sheet;
}

function readTable(name) {
  var sheet = getSheet(name);
  var values = sheet.getDataRange().getValues();
  if (!values.length || (values.length === 1 && !values[0].some(function (v) { return v !== ''; }))) {
    var def = name === 'SESI_ABSENSI' ? SESI_HEADERS : (name === 'ABSENSI' ? ABSENSI_HEADERS : []);
    return { sheet: sheet, headers: def, rows: [] };
  }
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
    if (k === 'ZONA_WAKTU') return;
    if (incoming[k] === undefined) return;
    var value = String(incoming[k]).trim();
    if (k === 'BATAS_KETERLAMBATAN' && !/^\d{1,3}$/.test(value)) {
      throw apiError('VALIDATION', 'Batas keterlambatan harus berupa angka menit.');
    }
    if (k === 'DURASI_SESSION' && (!/^\d{1,4}$/.test(value) || parseInt(value, 10) < 1)) {
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
/* Crypto / auth / Wali Kelas relation                                 */
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
  var body = Utilities.base64EncodeWebSafe(JSON.stringify({
    idGuru: user.idGuru,
    role: user.role,
    kelas: user.kelas || '',
    exp: expSeconds
  }));
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

/**
 * Mendapatkan kelas yang diampu oleh wali kelas.
 * Prioritas:
 * 1. Kolom KELAS / KELAS_WALI / WALI_KELAS di sheet GURU.
 * 2. Fallback relasi dari JADWAL jika sheet GURU belum memiliki kolom kelas.
 */
function getTeacherClass(teacherId) {
  var teacher = readTable('GURU').rows.filter(function (r) { return r.ID_GURU === teacherId; })[0];
  if (!teacher) return '';
  var k = teacher.KELAS || teacher.KELAS_WALI || teacher.WALI_KELAS || '';
  if (k) return String(k).trim();

  // Fallback to JADWAL
  var sched = readTable('JADWAL').rows.filter(function (r) { return r.ID_GURU === teacherId; })[0];
  return sched ? String(sched.KELAS || '').trim() : '';
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
  var teacherClass = getTeacherClass(teacher.ID_GURU);
  return {
    idGuru: teacher.ID_GURU,
    namaGuru: teacher.NAMA_GURU,
    role: teacher.ROLE === 'ADMIN' ? 'ADMIN' : 'GURU',
    kelas: teacherClass
  };
}

function requireAdmin(token) {
  var user = requireAuth(token);
  if (user.role !== 'ADMIN') throw apiError('FORBIDDEN', 'Anda tidak memiliki akses untuk tindakan ini.');
  return user;
}

function parseAuthOrNull(token) {
  if (!token) return null;
  try {
    return requireAuth(token);
  } catch (e) {
    return null;
  }
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
  var teacherClass = getTeacherClass(teacher.ID_GURU);
  return {
    idGuru: teacher.ID_GURU,
    namaGuru: teacher.NAMA_GURU,
    username: teacher.USERNAME,
    role: role,
    kelas: teacherClass,
    token: makeToken({ idGuru: teacher.ID_GURU, role: role, kelas: teacherClass }, expSeconds),
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
    role: r.ROLE === 'ADMIN' ? 'ADMIN' : 'GURU',
    kelas: r.KELAS || r.KELAS_WALI || r.WALI_KELAS || ''
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
    idJadwal: r.ID_JADWAL || 'HARIAN',
    idQr: r.ID_QR || '',
    nis: r.NIS || '',
    nama: r.NAMA || '',
    kelas: r.KELAS || '',
    tanggal: r.TANGGAL || '',
    jam: r.JAM || '',
    mataPelajaran: r.MATA_PELAJARAN || 'Harian',
    idGuru: r.ID_GURU || '',
    namaGuru: r.NAMA_GURU || '',
    status: r.STATUS || 'HADIR',
    keterangan: r.KETERANGAN || ''
  };
}

function mapSession(r) {
  return {
    idSesi: r.ID_SESI || '',
    idGuru: r.ID_GURU || '',
    idJadwal: r.ID_JADWAL || '',
    kelas: r.KELAS || '',
    mataPelajaran: r.MATA_PELAJARAN || '',
    tanggal: r.TANGGAL || '',
    jamMulai: r.JAM_MULAI || '',
    status: r.STATUS || 'ACTIVE',
    createdAt: r.CREATED_AT || ''
  };
}

/* ------------------------------------------------------------------ */
/* Read endpoints                                                      */
/* ------------------------------------------------------------------ */

function getStudents(user) {
  var rows = readTable('SISWA').rows;
  if (user && user.role !== 'ADMIN') {
    var targetClass = user.kelas || '';
    rows = rows.filter(function (r) { return r.KELAS === targetClass; });
  }
  return rows.map(mapStudent);
}

function getTeachers() {
  return readTable('GURU').rows.map(mapTeacher);
}

function getSchedules(user) {
  var names = teacherNameMap();
  var rows = readTable('JADWAL').rows;
  if (user && user.role !== 'ADMIN') {
    rows = rows.filter(function (r) { return r.ID_GURU === user.idGuru; });
  }
  return rows.map(function (r) { return mapSchedule(r, names); });
}

function dateParam(p) {
  var d = String(p.tanggal || '').trim();
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw apiError('VALIDATION', 'Format tanggal harus yyyy-MM-dd.');
  return d || todayISO(nowDate());
}

function attendanceOn(tanggal) {
  return readTable('ABSENSI').rows.filter(function (r) { return r.TANGGAL === tanggal; });
}

/**
 * Dashboard wali kelas:
 * Menampilkan ringkasan dan daftar siswa kelas yang diampu secara real-time.
 */
function getDashboard(p, user) {
  var tanggal = dateParam(p);
  var activeStudents = readTable('SISWA').rows.filter(function (r) { return r.STATUS !== 'NONAKTIF'; });
  var records = attendanceOn(tanggal);

  var targetClass = '';
  if (user && user.role !== 'ADMIN') {
    targetClass = user.kelas || '';
    if (p.kelas && p.kelas !== targetClass) {
      throw apiError('FORBIDDEN', 'Anda tidak memiliki hak untuk mengakses kelas ini.');
    }
  } else if (p.kelas) {
    targetClass = String(p.kelas).trim();
  }

  if (targetClass) {
    activeStudents = activeStudents.filter(function (s) { return s.KELAS === targetClass; });
    records = records.filter(function (r) { return r.KELAS === targetClass; });
  }

  var count = function (s) { return records.filter(function (r) { return r.STATUS === s; }).length; };
  var seen = {};
  records.forEach(function (r) {
    if (r.ID_QR) seen[r.ID_QR] = true;
    if (r.NIS) seen[r.NIS] = true;
  });

  var presentCount = activeStudents.filter(function (s) { return seen[s.ID_QR] || seen[s.NIS]; }).length;
  var belumAbsenCount = Math.max(0, activeStudents.length - presentCount);
  var totalSiswa = activeStudents.length;
  var hadir = count('HADIR');
  var terlambat = count('TERLAMBAT');
  var izin = count('IZIN');
  var sakit = count('SAKIT');
  var alpha = count('ALPHA');
  var pct = totalSiswa > 0 ? Math.round(((hadir + terlambat) / totalSiswa) * 100) : 0;

  var recMap = {};
  records.forEach(function (r) {
    if (r.NIS) recMap[r.NIS] = r;
    if (r.ID_QR) recMap[r.ID_QR] = r;
  });

  var daftarSiswa = activeStudents.map(function (s) {
    var rec = recMap[s.NIS] || recMap[s.ID_QR] || null;
    return {
      student: mapStudent(s),
      attendance: rec ? mapAttendance(rec) : null,
      status: rec ? rec.STATUS : 'BELUM_ABSEN',
      jam: rec ? rec.JAM : '',
      keterangan: rec ? (rec.KETERANGAN || '') : ''
    };
  });

  return {
    kelas: targetClass,
    totalSiswa: totalSiswa,
    hadir: hadir,
    terlambat: terlambat,
    izin: izin,
    sakit: sakit,
    alpha: alpha,
    sudahAbsen: presentCount,
    belumAbsen: belumAbsenCount,
    tanpaKeterangan: belumAbsenCount, // kompatibilitas
    persentaseKehadiran: pct + '%',
    daftarSiswa: daftarSiswa
  };
}

function getClasses(p, user) {
  var tanggal = dateParam(p);
  var active = readTable('SISWA').rows.filter(function (r) { return r.STATUS !== 'NONAKTIF'; });
  var records = attendanceOn(tanggal);

  if (user && user.role !== 'ADMIN') {
    var targetClass = user.kelas || '';
    active = active.filter(function (s) { return s.KELAS === targetClass; });
    records = records.filter(function (r) { return r.KELAS === targetClass; });
  }

  var seen = {};
  records.forEach(function (r) {
    if (r.ID_QR) seen[r.ID_QR] = true;
    if (r.NIS) seen[r.NIS] = true;
  });

  var byClass = {};
  active.forEach(function (s) {
    var k = s.KELAS || '-';
    if (!byClass[k]) {
      byClass[k] = {
        kelas: k,
        total: 0,
        hadir: 0,
        terlambat: 0,
        izin: 0,
        sakit: 0,
        alpha: 0,
        sudahAbsen: 0,
        belumHadir: 0
      };
    }
    byClass[k].total++;
    if (!seen[s.ID_QR] && !seen[s.NIS]) {
      byClass[k].belumHadir++;
    } else {
      byClass[k].sudahAbsen++;
    }
  });

  records.forEach(function (r) {
    var c = byClass[r.KELAS];
    if (!c) return;
    if (r.STATUS === 'HADIR') c.hadir++;
    else if (r.STATUS === 'TERLAMBAT') c.terlambat++;
    else if (r.STATUS === 'IZIN') c.izin++;
    else if (r.STATUS === 'SAKIT') c.sakit++;
    else if (r.STATUS === 'ALPHA') c.alpha++;
  });

  return Object.keys(byClass).sort().map(function (k) { return byClass[k]; });
}

function getAttendance(p, user) {
  var rows = readTable('ABSENSI').rows;

  if (user && user.role !== 'ADMIN') {
    var targetClass = user.kelas || '';
    if (p.kelas && p.kelas !== targetClass) {
      throw apiError('FORBIDDEN', 'Anda tidak memiliki hak untuk mengakses kelas ini.');
    }
    rows = rows.filter(function (r) { return r.KELAS === targetClass; });
  } else if (p.kelas) {
    rows = rows.filter(function (r) { return r.KELAS === String(p.kelas); });
  }

  if (p.tanggal) rows = rows.filter(function (r) { return r.TANGGAL === String(p.tanggal); });
  if (p.idGuru && user && user.role === 'ADMIN') {
    rows = rows.filter(function (r) { return r.ID_GURU === String(p.idGuru); });
  }

  rows.sort(function (a, b) {
    var ka = (a.TANGGAL || '') + ' ' + (a.JAM || '');
    var kb = (b.TANGGAL || '') + ' ' + (b.JAM || '');
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });

  var limit = parseInt(p.limit, 10);
  if (limit > 0) rows = rows.slice(0, limit);
  return rows.map(mapAttendance);
}

function getClassAttendance(p, user) {
  var tanggal = dateParam(p);
  var targetClass = '';
  if (user && user.role !== 'ADMIN') {
    targetClass = user.kelas || '';
    if (p.kelas && p.kelas !== targetClass) {
      throw apiError('FORBIDDEN', 'Anda tidak memiliki hak untuk mengakses kelas ini.');
    }
  } else {
    targetClass = str(p.kelas);
  }

  var students = readTable('SISWA').rows.filter(function (s) {
    return s.STATUS !== 'NONAKTIF' && (!targetClass || s.KELAS === targetClass);
  });

  var absRows = attendanceOn(tanggal);
  if (targetClass) {
    absRows = absRows.filter(function (r) { return r.KELAS === targetClass; });
  }

  var absMap = {};
  absRows.forEach(function (r) {
    if (r.NIS) absMap[r.NIS] = r;
    if (r.ID_QR) absMap[r.ID_QR] = r;
  });

  var items = students.map(function (s) {
    var rec = absMap[s.NIS] || absMap[s.ID_QR] || null;
    return {
      student: mapStudent(s),
      attendance: rec ? mapAttendance(rec) : null,
      status: rec ? rec.STATUS : 'BELUM_ABSEN',
      jam: rec ? rec.JAM : '',
      keterangan: rec ? (rec.KETERANGAN || '') : ''
    };
  });

  return {
    kelas: targetClass,
    tanggal: tanggal,
    items: items
  };
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
/* Scan & Absensi Harian                                               */
/* ------------------------------------------------------------------ */

function findStudentByQr(idQr) {
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(idQr)) throw apiError('QR_NOT_REGISTERED', 'QR tidak terdaftar.');
  var s = readTable('SISWA').rows.filter(function (r) { return r.ID_QR === idQr; })[0];
  if (!s) throw apiError('QR_NOT_REGISTERED', 'QR tidak terdaftar.');
  if (s.STATUS === 'NONAKTIF') throw apiError('STUDENT_INACTIVE', 'Siswa tidak aktif.');
  return s;
}

/**
 * Mencari catatan duplikasi absensi siswa pada tanggal berjalan.
 * Kunci unik: ID_QR + TANGGAL (atau NIS + TANGGAL).
 */
function findDailyDuplicate(idQr, nis, tanggal) {
  return readTable('ABSENSI').rows.filter(function (r) {
    var matchQr = Boolean(idQr && r.ID_QR && r.ID_QR === idQr);
    var matchNis = Boolean(nis && r.NIS && r.NIS === nis);
    return (matchQr || matchNis) && r.TANGGAL === tanggal;
  })[0];
}

function findDuplicate(idQr, idJadwal, tanggal) {
  return findDailyDuplicate(idQr, '', tanggal);
}

function resolveJamMasuk(student, now, settings) {
  try {
    var day = weekdayName(now);
    var sched = readTable('JADWAL').rows.filter(function (r) {
      return r.STATUS !== 'NONAKTIF' && String(r.HARI).toUpperCase() === day &&
        r.KELAS === student.KELAS;
    })[0];
    if (sched && sched.JAM_MULAI) return sched.JAM_MULAI;
  } catch (e) {}
  return settings.JAM_MASUK || '07:00';
}

function computeDailyStatus(student, now, settings) {
  var limit = parseInt(settings.BATAS_KETERLAMBATAN, 10);
  if (isNaN(limit)) limit = 15;
  var jamMasuk = resolveJamMasuk(student, now, settings);
  return toMinutes(timeHM(now)) <= toMinutes(jamMasuk) + limit ? 'HADIR' : 'TERLAMBAT';
}

function computeStatus(schedule, now, settings) {
  var limit = parseInt(settings.BATAS_KETERLAMBATAN, 10);
  if (isNaN(limit)) limit = 15;
  var jamMulai = schedule && schedule.jamMulai ? schedule.jamMulai : (settings.JAM_MASUK || '07:00');
  return toMinutes(timeHM(now)) <= toMinutes(jamMulai) + limit ? 'HADIR' : 'TERLAMBAT';
}

function getStudentByQR(p, user) {
  var rawQr = String(p.idQr || '').trim();
  var student = findStudentByQr(rawQr);

  // Verifikasi kecocokan kelas wali kelas
  if (user && user.role !== 'ADMIN') {
    if (!user.kelas) throw apiError('FORBIDDEN', 'Akun wali kelas belum memiliki kelas yang diampu.');
    if (student.KELAS !== user.kelas) {
      throw apiError('WRONG_CLASS', 'Siswa tidak terdaftar di kelas yang Anda ampu (Kelas ' + user.kelas + ').');
    }
  }

  var now = nowDate();
  var settings = getSettings();
  var status = computeDailyStatus(student, now, settings);
  var jam = timeHM(now);
  var tanggal = todayISO(now);

  var sched = null;
  try {
    var day = weekdayName(now);
    var names = teacherNameMap();
    var candidates = readTable('JADWAL').rows.filter(function (r) {
      return r.STATUS !== 'NONAKTIF' && String(r.HARI).toUpperCase() === day &&
        r.KELAS === student.KELAS;
    });
    if (candidates.length) sched = mapSchedule(candidates[0], names);
  } catch (e) {}

  var result = {
    student: mapStudent(student),
    status: status,
    jam: jam,
    schedule: sched || {
      idJadwal: 'HARIAN',
      hari: weekdayName(now),
      jamMulai: resolveJamMasuk(student, now, settings),
      jamSelesai: '23:59',
      kelas: student.KELAS,
      mataPelajaran: 'Harian',
      idGuru: user ? user.idGuru : '',
      namaGuru: user ? user.namaGuru : '',
      status: 'AKTIF'
    }
  };

  var dup = findDailyDuplicate(student.ID_QR, student.NIS, tanggal);
  if (dup) {
    result.alreadyRecorded = { jam: dup.JAM, status: dup.STATUS };
  }
  return result;
}

function scanAttendance(p, user) {
  return withLock(function () {
    var rawQr = String(p.idQr || p.nis || '').trim();
    if (!rawQr) throw apiError('VALIDATION', 'QR Code wajib diisi.');
    var student = findStudentByQr(rawQr);

    // Verifikasi kelas wali kelas
    if (user && user.role !== 'ADMIN') {
      if (!user.kelas) throw apiError('FORBIDDEN', 'Akun wali kelas belum memiliki kelas yang diampu.');
      if (student.KELAS !== user.kelas) {
        throw apiError('WRONG_CLASS', 'Siswa tidak terdaftar di kelas yang Anda ampu (Kelas ' + user.kelas + ').');
      }
    }

    var now = nowDate();
    var tanggal = todayISO(now);
    var jam = timeHM(now);

    // Cek duplikasi absensi harian
    var dup = findDailyDuplicate(student.ID_QR, student.NIS, tanggal);
    if (dup) {
      throw apiError('DUPLICATE_ATTENDANCE', 'Siswa sudah absen hari ini (pukul ' + dup.JAM + ').');
    }

    var settings = getSettings();
    var status = computeDailyStatus(student, now, settings);

    var sched = null;
    try {
      var day = weekdayName(now);
      var names = teacherNameMap();
      var candidates = readTable('JADWAL').rows.filter(function (r) {
        return r.STATUS !== 'NONAKTIF' && String(r.HARI).toUpperCase() === day &&
          r.KELAS === student.KELAS;
      });
      if (candidates.length) sched = mapSchedule(candidates[0], names);
    } catch (e) {}

    var table = readTable('ABSENSI');
    var headers = table.headers.length ? table.headers : ABSENSI_HEADERS;
    var record = {
      ID_ABSENSI: 'ABS' + fmt(now, 'yyyyMMddHHmmss') + String(table.rows.length + 1),
      ID_JADWAL: sched ? sched.idJadwal : str(p.idJadwal || 'HARIAN'),
      ID_QR: student.ID_QR,
      NIS: student.NIS,
      NAMA: student.NAMA,
      KELAS: student.KELAS,
      TANGGAL: tanggal,
      JAM: jam,
      MATA_PELAJARAN: sched ? sched.mataPelajaran : str(p.mataPelajaran || 'Harian'),
      ID_GURU: user.idGuru,
      NAMA_GURU: user.namaGuru,
      STATUS: status,
      KETERANGAN: str(p.keterangan || '')
    };
    writeRecord(table.sheet, headers, record);

    return {
      student: mapStudent(student),
      status: status,
      jam: jam,
      tanggal: tanggal,
      attendance: mapAttendance(record),
      schedule: sched || {
        idJadwal: 'HARIAN',
        hari: weekdayName(now),
        jamMulai: resolveJamMasuk(student, now, settings),
        jamSelesai: '23:59',
        kelas: student.KELAS,
        mataPelajaran: 'Harian',
        idGuru: user.idGuru,
        namaGuru: user.namaGuru,
        status: 'AKTIF'
      }
    };
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
    if (g.kelas !== undefined) updated.KELAS = str(g.kelas);
    if (password) updated.PASSWORD_HASH = sha256Hex(password);
    writeRecord(t.sheet, t.headers, updated, existing._row);
    return mapTeacher(updated);
  }
  if (!password) throw apiError('VALIDATION', 'Password wajib diisi untuk guru baru.');
  var created = {
    ID_GURU: nextSequentialId(t.rows, 'ID_GURU', 'G', 3),
    NIP: str(g.nip), NAMA_GURU: nama, USERNAME: username,
    PASSWORD_HASH: sha256Hex(password), STATUS: status, ROLE: role,
    KELAS: str(g.kelas)
  };
  writeRecord(t.sheet, t.headers, created);
  return mapTeacher(created);
}

function validHM(v) { return /^([01]?\d|2[0-3]):[0-5]\d$/.test(v); }
function padHM(v) { return v.length === 4 ? '0' + v : v; }

function saveSchedule(p, user) {
  var j = p.schedule || {};
  var hari = str(j.hari).toUpperCase();
  var mulai = str(j.jamMulai), selesai = str(j.jamSelesai);
  var kelas = str(j.kelas), mapel = str(j.mataPelajaran);
  var idGuru = str(j.idGuru);

  if (user && user.role !== 'ADMIN') {
    idGuru = user.idGuru;
  }

  if (j.tanggal && (!hari || hari === '')) {
    var parts = String(j.tanggal).split('-');
    if (parts.length === 3) {
      var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      hari = DAYS[d.getDay()];
    }
  }

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
  if (existing && user && user.role !== 'ADMIN' && existing.ID_GURU !== user.idGuru) {
    throw apiError('FORBIDDEN', 'Anda tidak memiliki hak untuk mengubah jadwal ini.');
  }

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

function saveTeacherSchedule(p, user) {
  var j = p.schedule || {};
  var schedPayload = {};
  Object.keys(j).forEach(function (k) { schedPayload[k] = j[k]; });
  if (user && user.role !== 'ADMIN') {
    schedPayload.idGuru = user.idGuru;
  }
  return saveSchedule({ schedule: schedPayload }, user);
}

/* ------------------------------------------------------------------ */
/* Sesi Absensi & Manual Attendance                                   */
/* ------------------------------------------------------------------ */

function startAttendanceSession(p, user) {
  var idJadwal = str(p.idJadwal);
  if (!idJadwal) throw apiError('VALIDATION', 'ID Jadwal wajib diisi.');
  var schedules = readTable('JADWAL').rows;
  var sched = schedules.filter(function (r) { return r.ID_JADWAL === idJadwal; })[0];
  if (!sched) throw apiError('NOT_FOUND', 'Jadwal tidak ditemukan.');
  if (sched.STATUS === 'NONAKTIF') throw apiError('VALIDATION', 'Jadwal tidak aktif.');
  if (user.role !== 'ADMIN' && sched.ID_GURU !== user.idGuru) {
    throw apiError('FORBIDDEN', 'Anda tidak memiliki hak untuk memulai absensi jadwal ini.');
  }

  var now = nowDate();
  var tgl = todayISO(now);
  var sesiTable = readTable('SESI_ABSENSI');
  var headers = sesiTable.headers.length ? sesiTable.headers : SESI_HEADERS;

  var existing = sesiTable.rows.filter(function (r) {
    return r.ID_JADWAL === idJadwal && r.TANGGAL === tgl && r.STATUS === 'ACTIVE';
  })[0];
  if (existing) {
    return mapSession(existing);
  }

  var idSesi = 'SES' + fmt(now, 'yyyyMMddHHmmss') + String(sesiTable.rows.length + 1);
  var record = {
    ID_SESI: idSesi,
    ID_GURU: sched.ID_GURU,
    ID_JADWAL: sched.ID_JADWAL,
    KELAS: sched.KELAS,
    MATA_PELAJARAN: sched.MATA_PELAJARAN,
    TANGGAL: tgl,
    JAM_MULAI: timeHM(now),
    STATUS: 'ACTIVE',
    CREATED_AT: fmt(now, 'yyyy-MM-dd HH:mm:ss')
  };
  writeRecord(sesiTable.sheet, headers, record);
  return mapSession(record);
}

function closeAttendanceSession(p, user) {
  var idSesi = str(p.idSesi);
  if (!idSesi) throw apiError('VALIDATION', 'ID Sesi wajib diisi.');
  var sesiTable = readTable('SESI_ABSENSI');
  var session = sesiTable.rows.filter(function (r) { return r.ID_SESI === idSesi; })[0];
  if (!session) throw apiError('NOT_FOUND', 'Sesi tidak ditemukan.');
  if (user.role !== 'ADMIN' && session.ID_GURU !== user.idGuru) {
    throw apiError('FORBIDDEN', 'Anda tidak memiliki akses untuk menutup sesi ini.');
  }

  var updated = {};
  Object.keys(session).forEach(function (k) { updated[k] = session[k]; });
  updated.STATUS = 'CLOSED';
  writeRecord(sesiTable.sheet, sesiTable.headers, updated, session._row);

  if (p.markAlphaForUnrecorded) {
    var absTable = readTable('ABSENSI');
    var absHeaders = absTable.headers.length ? absTable.headers : ABSENSI_HEADERS;
    var activeStudents = readTable('SISWA').rows.filter(function (s) {
      return s.STATUS !== 'NONAKTIF' && s.KELAS === session.KELAS;
    });

    var recordedNis = {};
    absTable.rows.forEach(function (r) {
      if (r.TANGGAL === session.TANGGAL) {
        if (r.NIS) recordedNis[r.NIS] = true;
        if (r.ID_QR) recordedNis[r.ID_QR] = true;
      }
    });

    var names = teacherNameMap();
    var now = nowDate();
    var unrecorded = activeStudents.filter(function (s) {
      return !recordedNis[s.NIS] && !recordedNis[s.ID_QR];
    });

    unrecorded.forEach(function (s, idx) {
      var record = {
        ID_ABSENSI: 'ABS' + fmt(now, 'yyyyMMddHHmmss') + String(absTable.rows.length + idx + 1),
        ID_JADWAL: session.ID_JADWAL || 'HARIAN',
        ID_QR: s.ID_QR || '',
        NIS: s.NIS,
        NAMA: s.NAMA,
        KELAS: s.KELAS,
        TANGGAL: session.TANGGAL,
        JAM: timeHM(now),
        MATA_PELAJARAN: session.MATA_PELAJARAN || 'Harian',
        ID_GURU: session.ID_GURU,
        NAMA_GURU: names[session.ID_GURU] || '',
        STATUS: 'ALPHA',
        KETERANGAN: 'Tidak hadir (ditutup sesi)'
      };
      writeRecord(absTable.sheet, absHeaders, record);
    });
  }

  return { closed: true, session: mapSession(updated) };
}

function getActiveSession(p, user) {
  var sesiTable = readTable('SESI_ABSENSI');
  if (p && p.idSesi) {
    var found = sesiTable.rows.filter(function (r) { return r.ID_SESI === str(p.idSesi); })[0];
    if (!found) return null;
    if (user.role !== 'ADMIN' && found.ID_GURU !== user.idGuru) {
      throw apiError('FORBIDDEN', 'Akses ditolak.');
    }
    return mapSession(found);
  }
  var tgl = todayISO(nowDate());
  var activeSessions = sesiTable.rows.filter(function (r) {
    return r.STATUS === 'ACTIVE' && r.TANGGAL === tgl && (user.role === 'ADMIN' || r.ID_GURU === user.idGuru);
  });
  if (p && p.idJadwal) {
    activeSessions = activeSessions.filter(function (r) { return r.ID_JADWAL === str(p.idJadwal); });
  }
  if (!activeSessions.length) return null;
  return mapSession(activeSessions[activeSessions.length - 1]);
}

function getSessionAttendance(p, user) {
  var idSesi = str(p.idSesi);
  if (!idSesi) throw apiError('VALIDATION', 'ID Sesi wajib diisi.');
  var sesiTable = readTable('SESI_ABSENSI');
  var session = sesiTable.rows.filter(function (r) { return r.ID_SESI === idSesi; })[0];
  if (!session) throw apiError('NOT_FOUND', 'Sesi tidak ditemukan.');
  if (user.role !== 'ADMIN' && session.ID_GURU !== user.idGuru) {
    throw apiError('FORBIDDEN', 'Akses ditolak.');
  }

  var students = readTable('SISWA').rows.filter(function (s) {
    return s.STATUS !== 'NONAKTIF' && s.KELAS === session.KELAS;
  });

  var absRows = readTable('ABSENSI').rows.filter(function (r) {
    return r.KELAS === session.KELAS && r.TANGGAL === session.TANGGAL;
  });

  var absMap = {};
  absRows.forEach(function (r) {
    if (r.NIS) absMap[r.NIS] = r;
    if (r.ID_QR) absMap[r.ID_QR] = r;
  });

  var items = students.map(function (s) {
    var rec = absMap[s.NIS] || absMap[s.ID_QR] || null;
    return {
      student: mapStudent(s),
      attendance: rec ? mapAttendance(rec) : null,
      status: rec ? rec.STATUS : 'BELUM_ABSEN',
      jam: rec ? rec.JAM : ''
    };
  });

  return {
    session: mapSession(session),
    items: items
  };
}

function scanSessionAttendance(p, user) {
  var idSesi = str(p.idSesi);
  var rawQr = str(p.idQr || p.nis || '');
  if (!idSesi) throw apiError('VALIDATION', 'ID Sesi wajib diisi.');
  if (!rawQr) throw apiError('VALIDATION', 'QR Code / NIS wajib diisi.');

  var sesiTable = readTable('SESI_ABSENSI');
  var session = sesiTable.rows.filter(function (r) { return r.ID_SESI === idSesi; })[0];
  if (!session) throw apiError('NOT_FOUND', 'Sesi tidak ditemukan.');
  if (session.STATUS !== 'ACTIVE') {
    throw apiError('SESSION_CLOSED', 'Sesi absensi sudah ditutup.');
  }
  if (user.role !== 'ADMIN' && session.ID_GURU !== user.idGuru) {
    throw apiError('FORBIDDEN', 'Akses ditolak.');
  }

  var siswaRows = readTable('SISWA').rows;
  var student = siswaRows.filter(function (s) {
    return s.ID_QR === rawQr || s.NIS === rawQr;
  })[0];
  if (!student) {
    throw apiError('STUDENT_NOT_FOUND', 'Siswa tidak ditemukan.');
  }
  if (student.STATUS === 'NONAKTIF') {
    throw apiError('STUDENT_INACTIVE', 'Siswa tidak aktif.');
  }

  if (student.KELAS !== session.KELAS) {
    throw apiError('WRONG_CLASS', 'Siswa tidak terdaftar di kelas ini.');
  }

  // Cek duplikasi harian
  var absTable = readTable('ABSENSI');
  var dup = findDailyDuplicate(student.ID_QR, student.NIS, session.TANGGAL);
  if (dup) {
    throw apiError('DUPLICATE_ATTENDANCE', 'Siswa sudah melakukan absensi hari ini.');
  }

  var now = nowDate();
  var jam = timeHM(now);
  var names = teacherNameMap();
  var headers = absTable.headers.length ? absTable.headers : ABSENSI_HEADERS;

  var record = {
    ID_ABSENSI: 'ABS' + fmt(now, 'yyyyMMddHHmmss') + String(absTable.rows.length + 1),
    ID_JADWAL: session.ID_JADWAL || 'HARIAN',
    ID_QR: student.ID_QR,
    NIS: student.NIS,
    NAMA: student.NAMA,
    KELAS: student.KELAS,
    TANGGAL: session.TANGGAL,
    JAM: jam,
    MATA_PELAJARAN: session.MATA_PELAJARAN || 'Harian',
    ID_GURU: session.ID_GURU,
    NAMA_GURU: names[session.ID_GURU] || '',
    STATUS: 'HADIR',
    KETERANGAN: str(p.keterangan || '')
  };
  writeRecord(absTable.sheet, headers, record);

  return {
    student: mapStudent(student),
    status: 'HADIR',
    jam: jam,
    attendance: mapAttendance(record)
  };
}

/**
 * Absensi manual & koreksi status absensi harian.
 * Jika catatan sudah ada -> perbarui in-place (mekanisme koreksi terlindungi).
 * Jika belum ada -> buat catatan baru harian.
 */
function updateAttendanceStatus(p, user) {
  return withLock(function () {
    var validStatuses = ['HADIR', 'TERLAMBAT', 'IZIN', 'SAKIT', 'ALPHA'];
    var newStatus = str(p.status).toUpperCase();
    if (validStatuses.indexOf(newStatus) === -1) {
      throw apiError('VALIDATION', 'Status absensi tidak valid. Pilih HADIR, TERLAMBAT, IZIN, SAKIT, atau ALPHA.');
    }

    var absTable = readTable('ABSENSI');
    var idAbsensi = str(p.idAbsensi);
    var tgl = str(p.tanggal) || todayISO(nowDate());
    var record = null;

    if (idAbsensi) {
      record = absTable.rows.filter(function (r) { return r.ID_ABSENSI === idAbsensi; })[0];
    } else if (p.nis || p.idQr) {
      var rawIdentifier = str(p.nis || p.idQr);
      record = absTable.rows.filter(function (r) {
        return (r.NIS === rawIdentifier || r.ID_QR === rawIdentifier) && r.TANGGAL === tgl;
      })[0];
    }

    // 1. Catatan sudah ada: perbarui status & keterangan (koreksi terlindungi)
    if (record) {
      if (user.role !== 'ADMIN') {
        if (!user.kelas || record.KELAS !== user.kelas) {
          throw apiError('FORBIDDEN', 'Anda tidak memiliki hak untuk mengubah data absensi kelas ini.');
        }
      }
      var updated = {};
      Object.keys(record).forEach(function (k) { updated[k] = record[k]; });
      updated.STATUS = newStatus;
      if (p.keterangan !== undefined) updated.KETERANGAN = str(p.keterangan);
      writeRecord(absTable.sheet, absTable.headers, updated, record._row);
      return mapAttendance(updated);
    }

    // 2. Belum ada catatan: buat absensi harian baru
    var rawId = str(p.nis || p.idQr);
    if (!rawId) throw apiError('VALIDATION', 'NIS atau ID QR siswa wajib diisi.');

    var student = readTable('SISWA').rows.filter(function (s) {
      return s.NIS === rawId || s.ID_QR === rawId;
    })[0];
    if (!student) throw apiError('STUDENT_NOT_FOUND', 'Siswa tidak ditemukan.');
    if (student.STATUS === 'NONAKTIF') throw apiError('STUDENT_INACTIVE', 'Siswa tidak aktif.');

    if (user.role !== 'ADMIN') {
      if (!user.kelas || student.KELAS !== user.kelas) {
        throw apiError('WRONG_CLASS', 'Siswa bukan dari kelas yang Anda ampu (Kelas ' + user.kelas + ').');
      }
    }

    var now = nowDate();
    var headers = absTable.headers.length ? absTable.headers : ABSENSI_HEADERS;
    var jam = timeHM(now);
    var names = teacherNameMap();

    var created = {
      ID_ABSENSI: 'ABS' + fmt(now, 'yyyyMMddHHmmss') + String(absTable.rows.length + 1),
      ID_JADWAL: str(p.idJadwal || 'HARIAN'),
      ID_QR: student.ID_QR || '',
      NIS: student.NIS,
      NAMA: student.NAMA,
      KELAS: student.KELAS,
      TANGGAL: tgl,
      JAM: jam,
      MATA_PELAJARAN: str(p.mataPelajaran || 'Harian'),
      ID_GURU: user.idGuru,
      NAMA_GURU: names[user.idGuru] || user.namaGuru,
      STATUS: newStatus,
      KETERANGAN: str(p.keterangan || '')
    };
    writeRecord(absTable.sheet, headers, created);
    return mapAttendance(created);
  });
}

function getAttendanceRecap(p, user) {
  var rows = readTable('ABSENSI').rows;

  if (user.role !== 'ADMIN') {
    var targetClass = user.kelas || '';
    if (p.kelas && p.kelas !== targetClass) {
      throw apiError('FORBIDDEN', 'Anda tidak memiliki hak untuk mengakses kelas ini.');
    }
    rows = rows.filter(function (r) { return r.KELAS === targetClass; });
  } else {
    if (p.kelas) rows = rows.filter(function (r) { return r.KELAS === str(p.kelas); });
    if (p.idGuru) rows = rows.filter(function (r) { return r.ID_GURU === String(p.idGuru); });
  }

  var tglMulai = str(p.tanggalMulai || p.tanggal);
  var tglAkhir = str(p.tanggalAkhir || p.tanggal);

  if (tglMulai && tglAkhir) {
    rows = rows.filter(function (r) { return r.TANGGAL >= tglMulai && r.TANGGAL <= tglAkhir; });
  } else if (tglMulai) {
    rows = rows.filter(function (r) { return r.TANGGAL >= tglMulai; });
  } else if (tglAkhir) {
    rows = rows.filter(function (r) { return r.TANGGAL <= tglAkhir; });
  }

  if (p.status) rows = rows.filter(function (r) { return r.STATUS === str(p.status).toUpperCase(); });

  rows.sort(function (a, b) {
    var ka = (a.TANGGAL || '') + ' ' + (a.JAM || '');
    var kb = (b.TANGGAL || '') + ' ' + (b.JAM || '');
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });

  // Rekap dikelompokkan berdasarkan Kelas dan Periode/Tanggal
  var groups = {};
  rows.forEach(function (r) {
    var key = (r.KELAS || '-') + '|' + (r.TANGGAL || '-');
    if (!groups[key]) {
      groups[key] = {
        guru: r.NAMA_GURU || (user ? user.namaGuru : '-'),
        periode: r.TANGGAL || (tglMulai === tglAkhir || !tglAkhir ? (tglMulai || 'Semua') : (tglMulai + ' s/d ' + tglAkhir)),
        kelas: r.KELAS || '-',
        mataPelajaran: r.MATA_PELAJARAN || 'Harian',
        totalSiswa: 0,
        hadir: 0,
        terlambat: 0,
        izin: 0,
        sakit: 0,
        alpha: 0
      };
    }
    var g = groups[key];
    g.totalSiswa++;
    if (r.STATUS === 'HADIR') g.hadir++;
    else if (r.STATUS === 'TERLAMBAT') { g.hadir++; g.terlambat++; }
    else if (r.STATUS === 'IZIN') g.izin++;
    else if (r.STATUS === 'SAKIT') g.sakit++;
    else if (r.STATUS === 'ALPHA') g.alpha++;
  });

  var summaryList = Object.keys(groups).map(function (k) {
    var item = groups[k];
    var pct = item.totalSiswa > 0 ? Math.round((item.hadir / item.totalSiswa) * 100) : 0;
    return {
      guru: item.guru,
      periode: item.periode,
      kelas: item.kelas,
      mataPelajaran: item.mataPelajaran,
      totalSiswa: item.totalSiswa,
      hadir: item.hadir,
      terlambat: item.terlambat,
      izin: item.izin,
      sakit: item.sakit,
      alpha: item.alpha,
      persentaseKehadiran: pct + '%'
    };
  });

  return {
    detail: rows.map(mapAttendance),
    summary: summaryList
  };
}
