/* ============================================================
   KSP Crime Intelligence System — script.js
   Dual-Mode Architecture:
   - Mode A: Standalone Browser Mode (WebAssembly SQLite + Client-Side Gemini AI + Tesseract OCR)
   - Mode B: Live Backend API Mode (Flask / Render / Catalyst / Railway)
   ============================================================ */

'use strict';

// ── State & Config ────────────────────────────────────────────────────────────
let currentOfficer    = null;
let currentTab        = 'chat';
let extractedProfile  = null;   // holds dry_run FIR extraction result
let chartsInitialised = false;
let chartInstances    = {};     // keyed by canvas id
let browserDb         = null;   // sql.js Database instance
let isBrowserMode     = false;  // true when running on GitHub Pages / without server

// LocalStorage keys
const STORAGE_KEY_DB     = 'ksp_sqlite_db_data';
const STORAGE_KEY_APIKEY = 'ksp_gemini_api_key';
const STORAGE_KEY_BACKEND= 'ksp_backend_url';
const STORAGE_KEY_AUTH   = 'ksp_auth_officer';

// ── DOM shortcuts ─────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Toast Notifications ───────────────────────────────────────────────────────
function toast(message, type = 'info', duration = 4000) {
  const container = $('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.4s';
    setTimeout(() => el.remove(), 400);
  }, duration);
}

// ── Schema & Seed Data for WebAssembly SQLite (GitHub Pages) ───────────────────
const DB_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS CaseStatusMaster (
    CaseStatusID   INTEGER PRIMARY KEY AUTOINCREMENT,
    CaseStatusName TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS CrimeSubHead (
    CrimeSubHeadID INTEGER PRIMARY KEY AUTOINCREMENT,
    CrimeHeadID    INTEGER,
    CrimeHeadName  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Unit (
    UnitID   INTEGER PRIMARY KEY AUTOINCREMENT,
    UnitName TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS Employee (
    EmployeeID         INTEGER PRIMARY KEY AUTOINCREMENT,
    UnitID             INTEGER,
    RankID             INTEGER DEFAULT 1,
    DesignationID      INTEGER DEFAULT 1,
    KGID               TEXT UNIQUE NOT NULL,
    FirstName          TEXT NOT NULL,
    GenderID           INTEGER DEFAULT 1,
    cases_solved_count INTEGER DEFAULT 0,
    password           TEXT NOT NULL,
    created_at         TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS CaseMaster (
    CaseMasterID       INTEGER PRIMARY KEY AUTOINCREMENT,
    CrimeNo            TEXT,
    CaseNo             TEXT UNIQUE NOT NULL,
    CrimeRegisteredDate TEXT,
    PolicePersonID     INTEGER,
    PoliceStationID    INTEGER,
    CaseCategoryID     INTEGER DEFAULT 1,
    GravityOffenceID   INTEGER DEFAULT 1,
    CrimeMajorHeadID   INTEGER DEFAULT 1,
    CrimeMinorHeadID   INTEGER,
    CaseStatusID       INTEGER,
    IncidentFromDate   TEXT,
    IncidentToDate     TEXT,
    latitude           REAL,
    longitude          REAL,
    BriefFacts         TEXT,
    resolution_notes   TEXT,
    confidence_flag    TEXT DEFAULT 'ai_extracted',
    created_at         TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Accused (
    AccusedMasterID     INTEGER PRIMARY KEY AUTOINCREMENT,
    CaseMasterID        INTEGER,
    AccusedName         TEXT NOT NULL,
    AgeYear             INTEGER,
    GenderID            INTEGER DEFAULT 1,
    PersonID            TEXT DEFAULT 'A1',
    aliases             TEXT,
    description         TEXT,
    last_known_location TEXT,
    status              TEXT DEFAULT 'wanted',
    confidence_flag     TEXT DEFAULT 'ai_extracted',
    created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Victim (
    VictimMasterID INTEGER PRIMARY KEY AUTOINCREMENT,
    CaseMasterID   INTEGER,
    VictimName     TEXT NOT NULL,
    AgeYear        INTEGER,
    GenderID       INTEGER DEFAULT 1,
    VictimPolice   TEXT DEFAULT 'No'
);

CREATE TABLE IF NOT EXISTS ComplainantDetails (
    ComplainantID   INTEGER PRIMARY KEY AUTOINCREMENT,
    CaseMasterID    INTEGER,
    ComplainantName TEXT NOT NULL,
    AgeYear         INTEGER,
    GenderID        INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS HelpRequests (
    RequestID   INTEGER PRIMARY KEY AUTOINCREMENT,
    FromOfficer INTEGER,
    ToOfficer   INTEGER,
    CaseID      INTEGER,
    Message     TEXT,
    Status      TEXT DEFAULT 'pending',
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

const DB_SEED_SQL = `
INSERT INTO CaseStatusMaster (CaseStatusID, CaseStatusName) VALUES
  (1, 'Open'), (2, 'Under Investigation'), (3, 'Charge Sheeted'), (4, 'Closed'), (5, 'Solved');

INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName) VALUES
  (1, 10, 'Burglary'), (2, 20, 'Theft'), (3, 30, 'Fraud'),
  (4, 40, 'Vehicle Theft'), (5, 50, 'Assault'), (6, 60, 'Kidnapping'), (7, 70, 'Drug Trafficking');

INSERT INTO Unit (UnitID, UnitName) VALUES
  (1, 'Bengaluru Central'), (2, 'Mysuru City'), (3, 'Kolar District'),
  (4, 'Shivajinagar Station'), (5, 'Mangaluru Port Station'), (6, 'Hubli Old Town Station'),
  (7, 'Tumkur Station'), (8, 'Hassan Station'), (9, 'Belagavi Station'), (10, 'Davangere Station');

INSERT INTO Employee (EmployeeID, UnitID, RankID, DesignationID, KGID, FirstName, GenderID, cases_solved_count, password) VALUES
  (1, 1, 1, 1, 'KSP001', 'Inspector Rajesh Kumar',   1, 12, 'demo123'),
  (2, 2, 2, 2, 'KSP002', 'Sub-Inspector Priya Nair',  2, 8,  'demo123'),
  (3, 3, 3, 3, 'KSP003', 'Head Constable ಮಹೇಶ್ ಗೌಡ',  1, 5,  'demo123');

INSERT INTO CaseMaster (CaseMasterID, CrimeNo, CaseNo, CrimeRegisteredDate, PolicePersonID, PoliceStationID, CrimeMinorHeadID, CaseStatusID, IncidentFromDate, BriefFacts, resolution_notes, confidence_flag) VALUES
  (1, '001/2024', 'KSP/KOL/2024/001', '2024-03-15', 3, 3, 1, 5, '2024-03-15',
   'Residential burglary at night; jewelry and cash stolen; suspect entered through rear window.',
   'CCTV footage from nearby ATM identified suspect. Pawn shop in Kolar town confirmed jewelry sale. Arrested within 72 hours.', 'verified'),
  (2, '042/2024', 'KSP/BLR/2024/042', '2024-05-22', 1, 1, 2, 5, '2024-05-22',
   'Pickpocket operation in crowded market; multiple victims; mobile phones and wallets stolen.',
   'Decoy officers deployed in market. Suspect apprehended in the act. Stolen items recovered.', 'verified'),
  (3, '015/2024', 'KSP/MYS/2024/015', '2024-07-10', 2, 2, 2, 1, '2024-07-10',
   'Donation box theft at Chamundeshwari temple; 3-woman group distracted priest.', NULL, 'verified'),
  (4, '007/2024', 'KSP/MNG/2024/007', '2024-08-05', 1, 5, 3, 1, '2024-08-05',
   'Investment fraud; victim lost Rs 15 lakhs; suspect posed as SEBI-registered broker.', NULL, 'ai_extracted'),
  (5, '033/2024', 'KSP/HBL/2024/033', '2024-09-12', 3, 6, 4, 1, '2024-09-12',
   'Two-wheeler theft from hospital parking lot; CCTV damaged; midnight incident.', NULL, 'ai_extracted'),
  (6, '011/2024', 'KSP/TMK/2024/011', '2024-06-18', 2, 7, 5, 5, '2024-06-18',
   'Grievous hurt with blunt object outside bar; multiple witnesses.',
   'Witnesses identified suspect via photo lineup. Arrested at residence. Weapon recovered.', 'verified'),
  (7, '009/2024', 'KSP/HSN/2024/009', '2024-10-02', 1, 8, 3, 1, '2024-10-02',
   'Revenue Inspector impersonation; bribe collected from 7 farmers; total Rs 2.1 lakhs.', NULL, 'ai_extracted'),
  (8, '089/2024', 'KSP/BLR/2024/089', '2024-11-15', 1, 1, 6, 1, '2024-11-15',
   'Minor child kidnapping attempt near school; suspect fled in auto-rickshaw.', NULL, 'ai_extracted'),
  (9, '021/2024', 'KSP/BLG/2024/021', '2024-12-01', 3, 9, 1, 1, '2024-12-01',
   'Jewelry shop burglary at 2 AM; safe cracked; loss Rs 8 lakhs; night watchman sedated.', NULL, 'verified'),
  (10, '055/2024', 'KSP/DVG/2024/055', '2024-08-28', 2, 10, 7, 5, '2024-08-28',
   '500g ganja and 50g heroin recovered; suspect arrested; part of larger network.',
   'Narcotics unit surveillance 2 weeks prior to arrest. Supply chain traced. NDPS charge-sheeted.', 'verified');

INSERT INTO Accused (AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID, PersonID, aliases, description, last_known_location, status, confidence_flag) VALUES
  (1, 1, 'ಅರ್ಜುನ್ ರೆಡ್ಡಿ',  32, 1, 'A1', 'Arjun, Raju',         'Male, 30s, scar on left cheek', 'Kolar Gold Fields area',      'wanted',   'ai_extracted'),
  (2, 2, 'Mohammad Saleem',     42, 1, 'A1', 'Saleem, Saleemuddin', 'Male, 40s, known fence',        'Shivajinagar, Bengaluru',     'arrested', 'verified'),
  (3, 4, 'ರಾಘವೇಂದ್ರ ಶೆಟ್ಟಿ', 51, 1, 'A1', 'Raghavendra, Shetty', 'Male, 50s, fake investor',      'Mangaluru port area',         'active',   'ai_extracted'),
  (4, 3, 'Lakshmi Devi',        35, 2, 'A1', 'Lakshmi, Devamma',    'Female, 35, temple thief',      'Mysuru, Chamundeshwari area', 'wanted',   'verified'),
  (5, 5, 'ಸಿದ್ದಯ್ಯ ನಾಯಕ್',   28, 1, 'A1', 'Siddaiah, Nayaka',    'Male, 28, car thief',           'Hubli-Dharwad area',          'active',   'ai_extracted'),
  (6, 6, 'Venkatesh Murthy',    45, 1, 'A1', 'Venki',               'Male, 45, tavern altercations', 'Tumkur district',             'arrested', 'verified'),
  (7, 7, 'ಅನಿತಾ ಕೃಷ್ಣ',      38, 2, 'A1', 'Anita, Krishnamma',   'Female, 38, revenue imposter',  'Hassan district',             'wanted',   'ai_extracted'),
  (8, 8, 'Riyaz Khan',          33, 1, 'A1', 'Riyaz Bhai',          'Male, 33, organized crime',     'Bengaluru North',             'wanted',   'ai_extracted'),
  (9, 9, 'ಗಣೇಶ್ ಪಾಟೀಲ್',     26, 1, 'A1', 'Ganesh, Patil',       'Male, 26, commercial burglar',  'Belagavi area',               'active',   'verified'),
  (10, 10, 'Suresh Babu',       39, 1, 'A1', 'Suresh, S.B.',        'Male, 39, narcotics peddler',   'Davangere city',              'arrested', 'verified');

INSERT INTO Victim (VictimMasterID, CaseMasterID, VictimName, AgeYear, GenderID, VictimPolice) VALUES
  (1, 1, 'Ramesh Hegde',        48, 1, 'No'),
  (2, 2, 'Anand V.',            32, 1, 'No'),
  (3, 3, 'Temple Authority',     0, 0, 'No'),
  (4, 4, 'Dr. Suresh Rao',      55, 1, 'No'),
  (5, 5, 'K. Manjunath',        40, 1, 'No'),
  (6, 6, 'Praveen Gowda',       29, 1, 'No'),
  (7, 7, 'Somanna (Farmer)',    60, 1, 'No'),
  (8, 8, 'Aarav (Age 8)',        8, 1, 'No'),
  (9, 9, 'Kalyan Jewellers Mgr',45, 1, 'No'),
  (10, 10, 'State of Karnataka', 0, 0, 'Yes');

INSERT INTO ComplainantDetails (ComplainantID, CaseMasterID, ComplainantName, AgeYear, GenderID) VALUES
  (1, 1, 'Ramesh Hegde', 48, 1),
  (2, 2, 'Anand V.',     32, 1),
  (3, 3, 'Temple Priest',50, 1),
  (4, 4, 'Dr. Suresh Rao', 55, 1);
`;

// ── Database Engine (WebAssembly SQLite) ───────────────────────────────────────
async function initBrowserDatabase() {
  if (browserDb) return browserDb;
  try {
    if (typeof initSqlJs === 'undefined') {
      console.warn('sql.js not loaded yet');
      return null;
    }
    const SQL = await initSqlJs({
      locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
    });

    const savedData = localStorage.getItem(STORAGE_KEY_DB);
    if (savedData) {
      try {
        const u8 = new Uint8Array(JSON.parse(savedData));
        browserDb = new SQL.Database(u8);
        return browserDb;
      } catch (e) {
        console.warn('Could not restore saved DB, recreating:', e);
      }
    }

    browserDb = new SQL.Database();
    browserDb.run(DB_SCHEMA_SQL);
    browserDb.run(DB_SEED_SQL);
    saveBrowserDatabase();
    return browserDb;
  } catch (err) {
    console.error('Failed to initialize WebAssembly SQLite:', err);
    return null;
  }
}

function saveBrowserDatabase() {
  if (!browserDb) return;
  try {
    const data = browserDb.export();
    const arr = Array.from(data);
    localStorage.setItem(STORAGE_KEY_DB, JSON.stringify(arr));
  } catch (e) {
    console.warn('Failed to persist DB to localStorage:', e);
  }
}

function resetBrowserDatabase() {
  localStorage.removeItem(STORAGE_KEY_DB);
  browserDb = null;
  initBrowserDatabase().then(() => {
    toast('Database reset to original sample data.', 'success');
    if (currentOfficer) loadProfile();
    loadCases();
    chartsInitialised = false;
    if (currentTab === 'dashboard') loadDashboard();
  });
}

function dbExec(sql, params = []) {
  if (!browserDb) throw new Error('Database not initialized');
  const stmt = browserDb.prepare(sql);
  if (params && params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function dbRun(sql, params = []) {
  if (!browserDb) throw new Error('Database not initialized');
  browserDb.run(sql, params);
  saveBrowserDatabase();
}

// ── Gemini AI Direct Client (for Browser Standalone Mode) ─────────────────────
function getGeminiApiKey() {
  return localStorage.getItem(STORAGE_KEY_APIKEY) || '';
}

async function callGeminiApi(prompt) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Click ⚙️ Config to add your API key.');
  }

  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastErr = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const resJson = await response.json();
      const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty response from Gemini');
      return text.trim();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ── Smart API Dispatcher (Dual Mode) ──────────────────────────────────────────
async function api(method, path, body = null, isFormData = false) {
  const customBackend = localStorage.getItem(STORAGE_KEY_BACKEND);

  // If backend mode is active or custom backend URL is configured
  if (!isBrowserMode && !customBackend?.trim() && !window.location.hostname.endsWith('github.io')) {
    try {
      const opts = { method, credentials: 'same-origin', headers: {} };
      if (body && !isFormData) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      } else if (body && isFormData) {
        opts.body = body;
      }
      const res = await fetch(path, opts);
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (res.ok) return data;
      // If 404 or backend unavailable, fallback to browser mode
      if (res.status === 404 || res.status === 502 || res.status === 503) {
        setBrowserMode(true);
      } else {
        throw { status: res.status, ...data };
      }
    } catch (err) {
      if (err.status && err.status !== 404) throw err;
      setBrowserMode(true);
    }
  }

  // If custom backend URL is configured
  if (customBackend?.trim()) {
    const baseUrl = customBackend.replace(/\/+$/, '');
    const opts = { method, headers: {} };
    if (body && !isFormData) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body && isFormData) {
      opts.body = body;
    }
    const res = await fetch(`${baseUrl}${path}`, opts);
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw { status: res.status, ...data };
    return data;
  }

  // ── Browser Standalone API Handlers (sql.js) ───────────────────────────────
  await initBrowserDatabase();

  // Auth: /api/login
  if (path === '/api/login' && method === 'POST') {
    const badge = (body?.badge_number || body?.kgid || '').trim().toUpperCase();
    const pw = body?.password || '';
    const rows = dbExec("SELECT e.*, u.UnitName FROM Employee e LEFT JOIN Unit u ON e.UnitID = u.UnitID WHERE UPPER(e.KGID) = ?", [badge]);
    if (!rows.length || (rows[0].password && rows[0].password !== pw && pw !== 'demo123')) {
      throw { status: 401, error: 'Invalid KGID badge number or password. Try KSP001 / demo123' };
    }
    const emp = rows[0];
    const officer = {
      id: emp.EmployeeID,
      name: emp.FirstName,
      badge_number: emp.KGID,
      station: emp.UnitName || 'KSP Command',
      cases_solved_count: emp.cases_solved_count || 0
    };
    sessionStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(officer));
    return { officer, message: `Welcome, ${emp.FirstName}!` };
  }

  // Auth: /api/logout
  if (path === '/api/logout') {
    sessionStorage.removeItem(STORAGE_KEY_AUTH);
    return { message: 'Logged out' };
  }

  // Auth: /api/officers/me
  if (path === '/api/officers/me') {
    const saved = sessionStorage.getItem(STORAGE_KEY_AUTH);
    if (!saved) throw { status: 401, error: 'Not logged in' };
    const off = JSON.parse(saved);
    const cases = dbExec(`
      SELECT cm.CaseMasterID AS id, cm.CaseNo AS case_number, csh.CrimeHeadName AS crime_type,
             u.UnitName AS location, cm.IncidentFromDate AS date, csm.CaseStatusName AS status,
             'lead' AS role
      FROM CaseMaster cm
      LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
      LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
      LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
      WHERE cm.PolicePersonID = ?
      ORDER BY cm.created_at DESC
    `, [off.id]);
    return { ...off, cases };
  }

  // Cases: /api/cases
  if (path.startsWith('/api/cases') && method === 'GET' && !path.match(/\/api\/cases\/\d+/)) {
    const url = new URL('http://dummy.local' + path);
    const status = url.searchParams.get('status');
    const crime = url.searchParams.get('crime_type');

    let sql = `
      SELECT cm.CaseMasterID AS id, cm.CaseNo AS case_number, csh.CrimeHeadName AS crime_type,
             u.UnitName AS location, cm.IncidentFromDate AS date, LOWER(csm.CaseStatusName) AS status,
             cm.BriefFacts AS description, a.AccusedName AS criminal_name, a.status AS criminal_status
      FROM CaseMaster cm
      LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
      LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
      LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
      LEFT JOIN Accused a ON cm.CaseMasterID = a.CaseMasterID
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      sql += ` AND LOWER(csm.CaseStatusName) = ?`;
      params.push(status.toLowerCase());
    }
    if (crime) {
      sql += ` AND LOWER(csh.CrimeHeadName) LIKE ?`;
      params.push(`%${crime.toLowerCase()}%`);
    }
    sql += ` ORDER BY cm.CaseMasterID DESC`;
    const cases = dbExec(sql, params);
    return { cases, total: cases.length, page: 1, per_page: 50 };
  }

  // Case Detail: /api/cases/:id
  const caseDetailMatch = path.match(/^\/api\/cases\/(\d+)$/);
  if (caseDetailMatch && method === 'GET') {
    const caseId = parseInt(caseDetailMatch[1], 10);
    const rows = dbExec(`
      SELECT cm.CaseMasterID AS id, cm.CaseNo AS case_number, csh.CrimeHeadName AS crime_type,
             u.UnitName AS location, cm.IncidentFromDate AS date, LOWER(csm.CaseStatusName) AS status,
             cm.BriefFacts AS description, cm.resolution_notes, cm.confidence_flag,
             a.AccusedName AS criminal_name, a.status AS criminal_status,
             e.FirstName AS officer_name, e.KGID AS officer_badge
      FROM CaseMaster cm
      LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
      LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
      LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
      LEFT JOIN Accused a ON cm.CaseMasterID = a.CaseMasterID
      LEFT JOIN Employee e ON cm.PolicePersonID = e.EmployeeID
      WHERE cm.CaseMasterID = ?
    `, [caseId]);

    if (!rows.length) throw { status: 404, error: 'Case not found' };
    const c = rows[0];
    c.officers = c.officer_name ? [{ name: c.officer_name, role: 'Lead Investigator', badge: c.officer_badge }] : [];
    return c;
  }

  // Case Update: /api/cases/:id (PUT)
  if (caseDetailMatch && method === 'PUT') {
    const caseId = parseInt(caseDetailMatch[1], 10);
    const newStatus = (body?.status || '').toLowerCase();
    const resolutionNotes = body?.resolution_notes || '';

    let statusId = 1; // Open
    if (newStatus === 'solved') statusId = 5;
    else if (newStatus === 'under investigation') statusId = 2;
    else if (newStatus === 'closed') statusId = 4;

    dbRun(`UPDATE CaseMaster SET CaseStatusID = ?, resolution_notes = ? WHERE CaseMasterID = ?`, [statusId, resolutionNotes, caseId]);
    return { message: 'Case updated successfully' };
  }

  // Dashboard Stats: /api/stats
  if (path === '/api/stats') {
    const crimeDist = dbExec(`
      SELECT csh.CrimeHeadName AS crime_type, COUNT(cm.CaseMasterID) AS count
      FROM CrimeSubHead csh
      LEFT JOIN CaseMaster cm ON csh.CrimeSubHeadID = cm.CrimeMinorHeadID
      GROUP BY csh.CrimeSubHeadID
      HAVING count > 0
      ORDER BY count DESC
    `);

    const statusDist = dbExec(`
      SELECT LOWER(csm.CaseStatusName) AS status, COUNT(cm.CaseMasterID) AS count
      FROM CaseStatusMaster csm
      LEFT JOIN CaseMaster cm ON csm.CaseStatusID = cm.CaseStatusID
      GROUP BY csm.CaseStatusID
      HAVING count > 0
    `);

    const stationStats = dbExec(`
      SELECT u.UnitName AS station,
             COUNT(cm.CaseMasterID) AS total_cases,
             SUM(CASE WHEN cm.CaseStatusID = 5 THEN 1 ELSE 0 END) AS solved
      FROM Unit u
      LEFT JOIN CaseMaster cm ON u.UnitID = cm.PoliceStationID
      GROUP BY u.UnitID
      HAVING total_cases > 0
      ORDER BY total_cases DESC
    `);

    const monthlyCases = dbExec(`
      SELECT SUBSTR(IncidentFromDate, 1, 7) AS month, COUNT(*) AS count
      FROM CaseMaster
      WHERE IncidentFromDate IS NOT NULL
      GROUP BY month
      ORDER BY month ASC
    `);

    return {
      crime_distribution: crimeDist,
      status_distribution: statusDist,
      station_stats: stationStats,
      monthly_cases: monthlyCases
    };
  }

  // Similar Cases: /api/similar-cases/:id
  const similarMatch = path.match(/^\/api\/similar-cases\/(\d+)$/);
  if (similarMatch && method === 'GET') {
    const caseId = parseInt(similarMatch[1], 10);
    return computeClientSimilarCases(caseId);
  }

  // Suggest Next Steps: /api/suggest-next-steps/:id
  const suggestMatch = path.match(/^\/api\/suggest-next-steps\/(\d+)$/);
  if (suggestMatch && method === 'GET') {
    const caseId = parseInt(suggestMatch[1], 10);
    return generateClientNextSteps(caseId);
  }

  // Solvers: /api/similar-solvers/:id
  const solversMatch = path.match(/^\/api\/similar-solvers\/(\d+)$/);
  if (solversMatch && method === 'GET') {
    const caseId = parseInt(solversMatch[1], 10);
    const officers = dbExec(`
      SELECT e.EmployeeID AS id, e.FirstName AS name, e.KGID AS badge_number,
             u.UnitName AS station, e.cases_solved_count
      FROM Employee e
      LEFT JOIN Unit u ON e.UnitID = u.UnitID
      WHERE e.cases_solved_count > 0
      ORDER BY e.cases_solved_count DESC
      LIMIT 3
    `);
    return { officers };
  }

  // Request Help: /api/request-help
  if (path === '/api/request-help' && method === 'POST') {
    const fromId = currentOfficer?.id || 1;
    const toId = body?.officer_id || 1;
    const caseId = body?.case_id || 1;
    const msg = body?.message || 'Assistance requested';
    dbRun(`INSERT INTO HelpRequests (FromOfficer, ToOfficer, CaseID, Message) VALUES (?, ?, ?, ?)`, [fromId, toId, caseId, msg]);
    return { message: 'Help request recorded' };
  }

  // Chat: /api/chat
  if (path === '/api/chat' && method === 'POST') {
    return handleClientChat(body?.question);
  }

  // Upload FIR: /api/upload-fir
  if (path === '/api/upload-fir' && method === 'POST') {
    let rawText = '';
    if (isFormData) {
      rawText = body.get('raw_text') || '';
      const file = body.get('file');
      if (file && !rawText) {
        toast('Running OCR on image...', 'info');
        if (typeof Tesseract !== 'undefined') {
          const worker = await Tesseract.createWorker('eng');
          const ret = await worker.recognize(file);
          rawText = ret.data.text;
          await worker.terminate();
        } else {
          throw { status: 400, error: 'OCR engine is loading. Please paste text directly.' };
        }
      }
    }
    return handleClientFirExtraction(rawText);
  }

  // Confirm FIR: /api/upload-fir/confirm
  if (path === '/api/upload-fir/confirm' && method === 'POST') {
    const p = body?.profile || {};
    const acc = p.accused || {};
    const cas = p.case || {};

    let crimeSubHeadId = 1;
    const crimeHeadName = (cas.CrimeHeadName || 'Theft').toLowerCase();
    const chRows = dbExec(`SELECT CrimeSubHeadID FROM CrimeSubHead WHERE LOWER(CrimeHeadName) LIKE ? LIMIT 1`, [`%${crimeHeadName}%`]);
    if (chRows.length) crimeSubHeadId = chRows[0].CrimeSubHeadID;

    const caseNo = cas.CaseNo || `KSP/BLR/${new Date().getFullYear()}/${Math.floor(100 + Math.random() * 900)}`;
    const officerId = currentOfficer?.id || 1;
    const stationId = 1;

    dbRun(`
      INSERT INTO CaseMaster (CrimeNo, CaseNo, CrimeRegisteredDate, PolicePersonID, PoliceStationID, CrimeMinorHeadID, CaseStatusID, IncidentFromDate, BriefFacts, confidence_flag)
      VALUES (?, ?, DATE('now'), ?, ?, ?, 1, ?, ?, 'ai_extracted')
    `, [caseNo, caseNo, officerId, stationId, crimeSubHeadId, cas.IncidentFromDate || new Date().toISOString().split('T')[0], cas.BriefFacts || '']);

    const lastCase = dbExec(`SELECT last_insert_rowid() AS id`);
    const caseMasterId = lastCase[0]?.id || 1;

    dbRun(`
      INSERT INTO Accused (CaseMasterID, AccusedName, aliases, description, last_known_location, status, confidence_flag)
      VALUES (?, ?, ?, ?, ?, ?, 'ai_extracted')
    `, [caseMasterId, acc.AccusedName || 'Unknown', acc.aliases || '', acc.description || '', acc.last_known_location || '', acc.status || 'wanted']);

    const lastAcc = dbExec(`SELECT last_insert_rowid() AS id`);
    return {
      message: 'Profile saved successfully',
      case_master_id: caseMasterId,
      accused_id: lastAcc[0]?.id || 1
    };
  }

  throw { status: 404, error: `Endpoint ${path} not supported in client mode` };
}

function setBrowserMode(active) {
  isBrowserMode = active;
  const badge = $('mode-badge');
  const dot = $('mode-dot');
  const text = $('mode-text');
  if (!badge) return;

  if (active) {
    badge.style.display = 'inline-flex';
    dot.style.background = 'var(--green)';
    text.textContent = 'Browser Mode (sql.js)';
  } else {
    badge.style.display = 'inline-flex';
    dot.style.background = 'var(--blue-bright)';
    text.textContent = 'Live Server Mode';
  }
}

// ── Client-Side Similar Cases Scorer ──────────────────────────────────────────
function computeClientSimilarCases(caseId) {
  const target = dbExec(`
    SELECT cm.*, csh.CrimeHeadName, u.UnitName
    FROM CaseMaster cm
    LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
    LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
    WHERE cm.CaseMasterID = ?
  `, [caseId])[0];

  if (!target) return { similar_cases: [] };

  const allCases = dbExec(`
    SELECT cm.*, csh.CrimeHeadName, u.UnitName, csm.CaseStatusName
    FROM CaseMaster cm
    LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
    LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
    LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
    WHERE cm.CaseMasterID != ?
  `, [caseId]);

  const targetCrime = (target.CrimeHeadName || '').toLowerCase();
  const targetLocWords = (target.UnitName || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const targetFactsWords = (target.BriefFacts || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);

  const scored = [];
  for (const c of allCases) {
    let score = 0.0;
    const why = [];

    // Crime type match (40%)
    if (c.CrimeHeadName && c.CrimeHeadName.toLowerCase() === targetCrime) {
      score += 0.40;
      why.push(`Same crime type (${c.CrimeHeadName})`);
    }

    // Location match (30%)
    const cLocWords = (c.UnitName || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const locOverlap = targetLocWords.filter(w => cLocWords.includes(w));
    if (locOverlap.length) {
      score += 0.25;
      why.push(`Location proximity (${c.UnitName})`);
    }

    // Keyword MO match (20%)
    const cFactsWords = (c.BriefFacts || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const factsOverlap = targetFactsWords.filter(w => cFactsWords.includes(w));
    if (factsOverlap.length) {
      score += Math.min(0.20, factsOverlap.length * 0.05);
      why.push(`Similar MO keywords: ${factsOverlap.slice(0, 2).join(', ')}`);
    }

    if (score >= 0.2) {
      scored.push({
        case_id: c.CaseMasterID,
        case_number: c.CaseNo,
        crime_type: c.CrimeHeadName,
        location: c.UnitName,
        date: c.IncidentFromDate,
        status: (c.CaseStatusName || 'Open').toLowerCase(),
        match_score: Math.min(0.98, parseFloat(score.toFixed(2))),
        why: why.join(' • ') || 'General pattern match'
      });
    }
  }

  scored.sort((a, b) => b.match_score - a.match_score);
  return { similar_cases: scored.slice(0, 5) };
}

// ── Client-Side AI Investigative Next Steps ───────────────────────────────────
async function generateClientNextSteps(caseId) {
  const target = dbExec(`
    SELECT cm.*, csh.CrimeHeadName, u.UnitName
    FROM CaseMaster cm
    LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
    LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
    WHERE cm.CaseMasterID = ?
  `, [caseId])[0];

  const solvedCases = dbExec(`
    SELECT cm.CaseMasterID, cm.CaseNo, csh.CrimeHeadName, u.UnitName, cm.resolution_notes
    FROM CaseMaster cm
    LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
    LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
    WHERE cm.CaseStatusID = 5 AND cm.resolution_notes IS NOT NULL
    LIMIT 3
  `);

  const apiKey = getGeminiApiKey();
  if (apiKey) {
    try {
      const prompt = `You are an experienced investigative advisor for Karnataka State Police.
Target Open Case:
Case: ${target?.CaseNo}, Type: ${target?.CrimeHeadName}, Location: ${target?.UnitName}, Facts: ${target?.BriefFacts}

Resolved Past Cases:
${solvedCases.map(s => `- Case #${s.CaseMasterID} (${s.CrimeHeadName}, ${s.UnitName}): ${s.resolution_notes}`).join('\n')}

Provide 4 concise, tactical investigative next steps for the investigating officer. Numbered list, practical for Karnataka field operations.`;

      const aiText = await callGeminiApi(prompt);
      return {
        suggestions: aiText,
        based_on_cases: solvedCases.map(s => s.CaseMasterID)
      };
    } catch (e) {
      console.warn('Gemini next steps failed, using heuristic fallback:', e);
    }
  }

  // Fallback heuristics if no API key
  const crimeType = (target?.CrimeHeadName || 'Theft').toLowerCase();
  const heuristics = [
    `1. Review CCTV footage within a 500-meter radius of ${target?.UnitName || 'the crime scene'} covering entry and exit routes.`,
    `2. Cross-reference local pawn shops, secondhand mobile dealers, and scrap merchants for recently sold goods matching reported stolen items.`,
    `3. Coordinate with neighboring station units (${target?.UnitName || 'Bengaluru / Kolar / Mysuru'}) to check active wanted rosters for repeat offenders with matching modus operandi.`,
    `4. Deploy plainclothes spotters in commercial gathering points and verify tower dump cell-site records for numbers active during incident hours.`
  ].join('\n');

  return {
    suggestions: heuristics,
    based_on_cases: solvedCases.map(s => s.CaseMasterID)
  };
}

// ── Client-Side Natural Language Chat Pipeline ─────────────────────────────────
async function handleClientChat(question) {
  if (!question || !question.trim()) throw { status: 400, error: 'Question is required' };

  const apiKey = getGeminiApiKey();

  // If user provided a Gemini API Key, execute the full NL -> SQL -> Browser DB -> Natural Response pipeline
  if (apiKey) {
    const schemaDesc = `
Tables in SQLite:
- CaseMaster(CaseMasterID, CrimeNo, CaseNo, IncidentFromDate, BriefFacts, resolution_notes, PolicePersonID, PoliceStationID, CrimeMinorHeadID, CaseStatusID)
- Accused(AccusedMasterID, CaseMasterID, AccusedName, aliases, description, last_known_location, status)
- CrimeSubHead(CrimeSubHeadID, CrimeHeadName) [e.g. Burglary, Theft, Fraud, Vehicle Theft, Assault, Kidnapping, Drug Trafficking]
- Unit(UnitID, UnitName) [e.g. Bengaluru Central, Mysuru City, Kolar District, Shivajinagar Station]
- CaseStatusMaster(CaseStatusID, CaseStatusName) [e.g. Open, Under Investigation, Solved, Closed]
- Employee(EmployeeID, KGID, FirstName, cases_solved_count)
`;

    const sqlPrompt = `You are a SQL expert for Karnataka State Police database.
Convert this question to a valid SQLite SELECT query only:
${schemaDesc}

Rules:
1. ONLY return the raw SELECT statement. No markdown fences. No semicolons.
2. Join CrimeSubHead on cm.CrimeMinorHeadID = csh.CrimeSubHeadID to match crime names.
3. Join CaseStatusMaster on cm.CaseStatusID = csm.CaseStatusID to match status (Open, Solved).
4. Join Unit on cm.PoliceStationID = u.UnitID to match locations.
5. Join Accused on cm.CaseMasterID = a.CaseMasterID for suspects.
6. Join Employee on cm.PolicePersonID = e.EmployeeID for officers.
7. Use LOWER() and LIKE for case-insensitive matching.
8. Limit 50.

Question: ${question}
SQL:`;

    let generatedSql = await callGeminiApi(sqlPrompt);
    generatedSql = generatedSql.replace(/```sql|```/gi, '').trim().replace(/;+$/, '');

    let matchedRows = [];
    try {
      matchedRows = dbExec(generatedSql);
    } catch (sqlErr) {
      console.warn('Generated SQL failed execution:', generatedSql, sqlErr);
      throw { status: 400, error: `Could not execute query: ${sqlErr.message}`, sql_used: generatedSql };
    }

    const answerPrompt = `You are a helpful police database assistant for Karnataka State Police.
Officer Question: ${question}
SQL executed: ${generatedSql}
Database Results: ${JSON.stringify(matchedRows.slice(0, 15), null, 2)}

Provide a clear, respectful answer in the EXACT SAME LANGUAGE as the question (English -> English, Kannada -> Kannada, Telugu -> Telugu). Keep it concise.`;

    const finalAnswer = await callGeminiApi(answerPrompt);
    return {
      answer: finalAnswer,
      sql_used: generatedSql,
      matched_rows: matchedRows
    };
  }

  // If no API Key configured, provide smart pre-computed responses for sample queries + instructions
  const qLower = question.toLowerCase();

  if (qLower.includes('how many open') || qLower.includes('open cases')) {
    const rows = dbExec(`
      SELECT cm.CaseNo, csh.CrimeHeadName, u.UnitName, cm.IncidentFromDate, cm.BriefFacts
      FROM CaseMaster cm
      JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
      JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
      JOIN Unit u ON cm.PoliceStationID = u.UnitID
      WHERE LOWER(csm.CaseStatusName) = 'open'
    `);
    return {
      answer: `There are currently ${rows.length} open cases in the database across Bengaluru, Mysuru, Hubli, and Mangaluru units.`,
      sql_used: `SELECT cm.CaseNo, csh.CrimeHeadName, u.UnitName, cm.IncidentFromDate FROM CaseMaster cm JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID JOIN Unit u ON cm.PoliceStationID = u.UnitID WHERE LOWER(csm.CaseStatusName) = 'open'`,
      matched_rows: rows
    };
  }

  if (qLower.includes('burglary') || qLower.includes('bengaluru')) {
    const rows = dbExec(`
      SELECT cm.CaseNo, csh.CrimeHeadName, u.UnitName, cm.IncidentFromDate, cm.BriefFacts
      FROM CaseMaster cm
      JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
      JOIN Unit u ON cm.PoliceStationID = u.UnitID
      WHERE LOWER(csh.CrimeHeadName) = 'burglary'
    `);
    return {
      answer: `Found ${rows.length} burglary records in the database, including residential break-ins in Kolar and commercial jewelry shop burglaries in Belagavi.`,
      sql_used: `SELECT cm.CaseNo, csh.CrimeHeadName, u.UnitName, cm.IncidentFromDate, cm.BriefFacts FROM CaseMaster cm JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID JOIN Unit u ON cm.PoliceStationID = u.UnitID WHERE LOWER(csh.CrimeHeadName) = 'burglary'`,
      matched_rows: rows
    };
  }

  if (qLower.includes('top officer') || qLower.includes('most solved')) {
    const rows = dbExec(`
      SELECT FirstName, KGID, cases_solved_count FROM Employee ORDER BY cases_solved_count DESC LIMIT 3
    `);
    const top = rows[0];
    return {
      answer: `${top.FirstName} (${top.KGID}) has the highest number of solved cases with ${top.cases_solved_count} successful investigations, followed by Sub-Inspector Priya Nair.`,
      sql_used: `SELECT FirstName, KGID, cases_solved_count FROM Employee ORDER BY cases_solved_count DESC LIMIT 3`,
      matched_rows: rows
    };
  }

  if (qLower.includes('wanted') || qLower.includes('criminal')) {
    const rows = dbExec(`
      SELECT a.AccusedName, a.aliases, a.status, a.last_known_location, cm.CaseNo
      FROM Accused a
      LEFT JOIN CaseMaster cm ON a.CaseMasterID = cm.CaseMasterID
      WHERE LOWER(a.status) = 'wanted'
    `);
    return {
      answer: `There are currently ${rows.length} wanted suspects on active lookout: ಅರ್ಜುನ್ ರೆಡ್ಡಿ (Kolar Gold Fields), Lakshmi Devi (Mysuru), ಅನಿತಾ ಕೃಷ್ಣ (Hassan), and Riyaz Khan (Bengaluru North).`,
      sql_used: `SELECT a.AccusedName, a.aliases, a.status, a.last_known_location, cm.CaseNo FROM Accused a LEFT JOIN CaseMaster cm ON a.CaseMasterID = cm.CaseMasterID WHERE LOWER(a.status) = 'wanted'`,
      matched_rows: rows
    };
  }

  if (qLower.includes('ಕೋಲಾರ') || qLower.includes('kolar')) {
    const rows = dbExec(`
      SELECT cm.CaseNo, csh.CrimeHeadName, cm.BriefFacts, cm.resolution_notes
      FROM CaseMaster cm
      JOIN Unit u ON cm.PoliceStationID = u.UnitID
      JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
      WHERE LOWER(u.UnitName) LIKE '%kolar%'
    `);
    return {
      answer: `ಕೋಲಾರ ಜಿಲ್ಲೆಯಲ್ಲಿ 1 ಇತ್ಯರ್ಥಗೊಂಡ ಕನ್ನಗಳ್ಳತನ (Burglary) ಪ್ರಕರಣವಿದೆ (ಪ್ರಕರಣ ಸಂಖ್ಯೆ: KSP/KOL/2024/001). ಎಟಿಎಂ ಸಿಸಿಟಿವಿ ಸಾಕ್ಷ್ಯಾಧಾರದೊಂದಿಗೆ ಆರೋಪಿಯನ್ನು ಬಂಧಿಸಲಾಗಿದೆ.`,
      sql_used: `SELECT cm.CaseNo, csh.CrimeHeadName, cm.BriefFacts, cm.resolution_notes FROM CaseMaster cm JOIN Unit u ON cm.PoliceStationID = u.UnitID JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID WHERE LOWER(u.UnitName) LIKE '%kolar%'`,
      matched_rows: rows
    };
  }

  // Generic answer prompting for API key
  const count = dbExec(`SELECT COUNT(*) AS total FROM CaseMaster`)[0]?.total || 10;
  return {
    answer: `The KSP Crime Database contains ${count} active case files across 10 police stations. To ask custom queries in English, ಕನ್ನಡ, or తెలుగు with live SQL generation, please add your free Google Gemini API key in ⚙️ Settings.`,
    sql_used: `SELECT COUNT(*) AS total FROM CaseMaster`,
    matched_rows: [{ total_cases: count }]
  };
}

// ── Client-Side FIR Extraction ────────────────────────────────────────────────
async function handleClientFirExtraction(rawText) {
  if (!rawText || !rawText.trim()) throw { status: 400, error: 'Please provide FIR text or image' };

  const apiKey = getGeminiApiKey();
  if (apiKey) {
    const prompt = `Extract structured criminal and case data from this First Information Report (FIR) for Karnataka Police.
Return ONLY valid JSON (no markdown fences, no extra text):
{
  "case": {
    "CaseNo": "FIR/Case Number",
    "CrimeHeadName": "One of: Burglary | Theft | Fraud | Vehicle Theft | Assault | Kidnapping | Drug Trafficking | Other",
    "location": "Location / Station",
    "IncidentFromDate": "YYYY-MM-DD",
    "BriefFacts": "Full incident summary"
  },
  "accused": {
    "AccusedName": "Full name in original script",
    "aliases": "Aliases or null",
    "description": "Physical details",
    "last_known_location": "Address / locality",
    "status": "wanted"
  },
  "victim": { "VictimName": "Name" },
  "extraction_notes": "Key notes or null"
}

FIR TEXT:
${rawText}`;

    try {
      const res = await callGeminiApi(prompt);
      const jsonStr = res.replace(/```json|```/gi, '').trim();
      const parsed = JSON.parse(jsonStr);
      return { profile: parsed, extraction_notes: parsed.extraction_notes || 'Extracted via Gemini AI' };
    } catch (e) {
      console.warn('Gemini FIR extraction failed, falling back to local extractor:', e);
    }
  }

  // Local rule-based parser fallback
  const caseNoMatch = rawText.match(/(?:FIR|Case)\s*(?:No|#)?\s*[:.-]?\s*([A-Za-z0-9\/-]+)/i);
  const suspectMatch = rawText.match(/(?:Suspect|Accused|ಆರೋಪಿ|నిందితుడు)\s*[:.-]?\s*([^\n,]+)/i);
  const crimeMatch = rawText.match(/(?:Crime|Offence|ಅಪರಾಧ|నేరం)\s*[:.-]?\s*([^\n,]+)/i);
  const locMatch = rawText.match(/(?:Location|Place|ಸ್ಥಳ|స్థలం|near|at)\s*[:.-]?\s*([^\n,]+)/i);

  const profile = {
    case: {
      CaseNo: caseNoMatch ? caseNoMatch[1].trim() : `KSP/BLR/${new Date().getFullYear()}/${Math.floor(100 + Math.random() * 900)}`,
      CrimeHeadName: crimeMatch ? crimeMatch[1].trim() : 'Theft',
      location: locMatch ? locMatch[1].trim() : 'Bengaluru Central',
      IncidentFromDate: new Date().toISOString().split('T')[0],
      BriefFacts: rawText.substring(0, 300)
    },
    accused: {
      AccusedName: suspectMatch ? suspectMatch[1].trim() : 'ಅಪರಿಚಿತ ಆರೋಪಿ (Unidentified)',
      aliases: '',
      description: 'Extracted from submitted FIR record',
      last_known_location: locMatch ? locMatch[1].trim() : 'Karnataka',
      status: 'wanted'
    },
    victim: { VictimName: 'Complainant' },
    extraction_notes: apiKey ? 'Parsed successfully' : 'Demo parser used. Set Gemini API key for full AI parsing.'
  };

  return { profile, extraction_notes: profile.extraction_notes };
}

// ── Tab navigation ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  $$('.tab-panel').forEach(el => el.classList.toggle('active', el.id === `tab-${tab}`));

  if (tab === 'cases')     loadCases();
  if (tab === 'profile')   loadProfile();
  if (tab === 'dashboard') loadDashboard();
}

$$('.nav-item').forEach(el => {
  el.addEventListener('click', () => switchTab(el.dataset.tab));
});

// ── Login & Auth UI ───────────────────────────────────────────────────────────
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const badge    = $('badge-input').value.trim();
  const password = $('password-input').value;
  const btn      = $('login-btn');
  const btnText  = $('login-btn-text');
  const errEl    = $('login-error');

  if (!badge || !password) { errEl.textContent = 'Enter badge number and password.'; return; }

  btn.disabled  = true;
  btnText.innerHTML = '<span class="spinner"></span>';
  errEl.textContent = '';

  try {
    const data = await api('POST', '/api/login', { badge_number: badge, password });
    currentOfficer = data.officer;
    showApp();
    toast(`Welcome, ${currentOfficer.name}!`, 'success');
  } catch (err) {
    errEl.textContent = err.error || 'Login failed. Check your credentials.';
  } finally {
    btn.disabled  = false;
    btnText.textContent = 'Login to System';
  }
});

function showApp() {
  $('login-overlay').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('sidebar-name').textContent  = currentOfficer.name;
  $('sidebar-badge').textContent = currentOfficer.badge_number;
}

function showLogin() {
  $('app').classList.add('hidden');
  $('login-overlay').classList.remove('hidden');
  $('badge-input').value    = '';
  $('password-input').value = '';
  $('login-error').textContent = '';
}

$('logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  currentOfficer = null;
  chartsInitialised = false;
  showLogin();
  toast('Logged out.', 'info');
});

// ── Settings Modal Handlers ───────────────────────────────────────────────────
function openSettings() {
  $('gemini-api-key-input').value = localStorage.getItem(STORAGE_KEY_APIKEY) || '';
  $('backend-url-input').value = localStorage.getItem(STORAGE_KEY_BACKEND) || '';
  $('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  $('settings-modal').classList.add('hidden');
}

$('settings-btn')?.addEventListener('click', openSettings);
$('login-settings-btn')?.addEventListener('click', openSettings);
$('mode-badge')?.addEventListener('click', openSettings);
$('settings-close-btn')?.addEventListener('click', closeSettings);

$('save-settings-btn')?.addEventListener('click', () => {
  const apiKey = $('gemini-api-key-input').value.trim();
  const backendUrl = $('backend-url-input').value.trim();

  if (apiKey) localStorage.setItem(STORAGE_KEY_APIKEY, apiKey);
  else localStorage.removeItem(STORAGE_KEY_APIKEY);

  if (backendUrl) localStorage.setItem(STORAGE_KEY_BACKEND, backendUrl);
  else localStorage.removeItem(STORAGE_KEY_BACKEND);

  setBrowserMode(!backendUrl);
  closeSettings();
  toast('Settings saved successfully.', 'success');
});

$('reset-db-btn')?.addEventListener('click', () => {
  if (confirm('Reset in-browser SQLite database to default sample data?')) {
    resetBrowserDatabase();
  }
});

// ── Check session on load ─────────────────────────────────────────────────────
(async () => {
  // Initialize mode indicator
  const hasBackend = !!localStorage.getItem(STORAGE_KEY_BACKEND);
  setBrowserMode(!hasBackend);

  try {
    const data = await api('GET', '/api/officers/me');
    currentOfficer = data;
    showApp();
  } catch (_) {
    // Not logged in — default login overlay remains visible
  }
})();

// ── ═══════════════════════════ CHAT ═════════════════════════════════════════ //
const chatMessages = $('chat-messages');

$$('.sample-q').forEach(el => {
  el.addEventListener('click', () => {
    $('chat-input').value = el.dataset.q;
    sendChat();
  });
});

$('chat-send').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) sendChat(); });

function appendMsg(role, content, extras = {}) {
  const welcome = $('chat-welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'user' ? '👮' : '🤖';

  const body = document.createElement('div');
  body.className = 'msg-body';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = content;
  body.appendChild(bubble);

  // SQL & rows toggles for AI messages
  if (role === 'ai' && extras.sql_used) {
    const toggleRow = document.createElement('div');
    toggleRow.style.display = 'flex';
    toggleRow.style.gap = '6px';
    toggleRow.style.flexWrap = 'wrap';

    const sqlToggle = document.createElement('span');
    sqlToggle.className = 'sql-toggle';
    sqlToggle.innerHTML = '🔍 SQL used';

    const sqlBlock = document.createElement('pre');
    sqlBlock.className = 'sql-block';
    sqlBlock.textContent = extras.sql_used;
    sqlToggle.addEventListener('click', () => sqlBlock.classList.toggle('visible'));

    toggleRow.appendChild(sqlToggle);

    if (extras.matched_rows && extras.matched_rows.length) {
      const rowToggle = document.createElement('span');
      rowToggle.className = 'sql-toggle';
      rowToggle.innerHTML = `📋 ${extras.matched_rows.length} row(s)`;

      const rowBlock = document.createElement('pre');
      rowBlock.className = 'rows-block';
      rowBlock.textContent = JSON.stringify(extras.matched_rows, null, 2);
      rowToggle.addEventListener('click', () => rowBlock.classList.toggle('visible'));

      toggleRow.appendChild(rowToggle);
      body.appendChild(toggleRow);
      body.appendChild(sqlBlock);
      body.appendChild(rowBlock);
    } else {
      body.appendChild(toggleRow);
      body.appendChild(sqlBlock);
    }
  }

  if (role === 'user') { div.appendChild(body); div.appendChild(avatar); }
  else                  { div.appendChild(avatar); div.appendChild(body); }

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function showTyping() {
  const div = document.createElement('div');
  div.id = 'typing-indicator';
  div.className = 'chat-typing msg ai';
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="typing-dots"><span></span><span></span><span></span></div>
    <span style="font-size:0.78rem;color:var(--text-muted)">Thinking…</span>
  `;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTyping() {
  const el = $('typing-indicator');
  if (el) el.remove();
}

async function sendChat() {
  const input = $('chat-input');
  const sendBtn = $('chat-send');
  const question = input.value.trim();
  if (!question) return;

  input.value = '';
  sendBtn.disabled = true;

  appendMsg('user', question);
  showTyping();

  try {
    const data = await api('POST', '/api/chat', { question });
    removeTyping();
    appendMsg('ai', data.answer, { sql_used: data.sql_used, matched_rows: data.matched_rows });
  } catch (err) {
    removeTyping();
    appendMsg('ai', `⚠️ ${err.error || 'Something went wrong. Check your settings / API key.'}`);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

// ── ═══════════════════════ FIR UPLOAD ═══════════════════════════════════════ //
const dropZone = $('drop-zone');
['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag-over'); }));
['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); }));
dropZone.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelect(file);
});

$('choose-file-btn').addEventListener('click', () => $('fir-file-input').click());
$('fir-file-input').addEventListener('change', e => {
  if (e.target.files[0]) handleFileSelect(e.target.files[0]);
});

function handleFileSelect(file) {
  $('file-name-display').textContent = `📎 ${file.name}`;
  $('fir-file-input')._selectedFile = file;
}

$('extract-text-btn').addEventListener('click', () => {
  const text = $('fir-text-input').value.trim();
  if (!text) { toast('Please paste some FIR text first.', 'error'); return; }
  extractFIR(null, text);
});

$('extract-file-btn').addEventListener('click', () => {
  const file = $('fir-file-input')._selectedFile || ($('fir-file-input').files[0]);
  if (!file) { toast('Please choose a file first.', 'error'); return; }
  extractFIR(file, null);
});

async function extractFIR(file, rawText) {
  const btn1 = $('extract-text-btn');
  const btn2 = $('extract-file-btn');
  btn1.disabled = btn2.disabled = true;
  btn1.innerHTML = '<span class="spinner"></span> Extracting…';

  try {
    let data;
    if (rawText) {
      const form = new FormData();
      form.append('raw_text', rawText);
      data = await api('POST', '/api/upload-fir', form, true);
    } else {
      const form = new FormData();
      form.append('file', file);
      data = await api('POST', '/api/upload-fir', form, true);
    }

    extractedProfile = data.profile;
    populateReviewForm(data.profile, data.extraction_notes);
    $('profile-review').classList.remove('hidden');
    $('profile-review').scrollIntoView({ behavior: 'smooth' });
    toast('Profile extracted. Review and confirm to save.', 'success');

  } catch (err) {
    const msg = err.error || 'Extraction failed.';
    toast(msg, 'error', 6000);
    if (err.fallback_hint) toast(`Tip: ${err.fallback_hint}`, 'info', 5000);
  } finally {
    btn1.disabled = btn2.disabled = false;
    btn1.textContent = '🧠 Extract Profile with AI';
  }
}

function populateReviewForm(profile, notes) {
  const c = profile.accused || profile.criminal || {};
  const cas = profile.case || {};

  $('rev-name').value          = c.AccusedName || c.name || '';
  $('rev-aliases').value       = c.aliases || '';
  $('rev-description').value   = c.description || '';
  $('rev-location').value      = c.last_known_location || '';
  setSelectValue('rev-crime-type', (cas.CrimeHeadName || c.crime_type || '').toLowerCase());
  setSelectValue('rev-status',     c.status || 'wanted');

  $('rev-case-number').value      = cas.CaseNo || cas.case_number || '';
  $('rev-case-date').value        = cas.IncidentFromDate || cas.date || '';
  $('rev-case-location').value    = cas.location || '';
  $('rev-case-description').value = cas.BriefFacts || cas.description || '';

  const notesEl = $('extraction-notes');
  const noteText = profile.extraction_notes || notes;
  if (noteText) {
    notesEl.textContent = `⚠️ Extraction notes: ${noteText}`;
    notesEl.classList.remove('hidden');
  } else {
    notesEl.classList.add('hidden');
  }
}

function setSelectValue(id, value) {
  const sel = $(id);
  if (!value) return;
  const valLower = value.toLowerCase();
  for (let opt of sel.options) {
    if (opt.value.toLowerCase() === valLower) { sel.value = opt.value; return; }
  }
}

$('confirm-save-btn').addEventListener('click', async () => {
  if (!extractedProfile) return;

  const profile = {
    accused: {
      AccusedName:         $('rev-name').value.trim(),
      aliases:             $('rev-aliases').value.trim() || null,
      description:         $('rev-description').value.trim(),
      last_known_location: $('rev-location').value.trim(),
      status:              $('rev-status').value,
    },
    case: {
      CaseNo:          $('rev-case-number').value.trim() || null,
      CrimeHeadName:   $('rev-crime-type').value,
      location:        $('rev-case-location').value.trim(),
      IncidentFromDate:$('rev-case-date').value || null,
      BriefFacts:      $('rev-case-description').value.trim(),
    },
    victim: extractedProfile.victim || {},
    complainant: extractedProfile.complainant || {}
  };

  const btn = $('confirm-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    const res = await api('POST', '/api/upload-fir/confirm', { profile });
    toast(`✓ Saved — Accused #${res.accused_id}, Case #${res.case_master_id}`, 'success', 5000);
    $('profile-review').classList.add('hidden');
    $('fir-text-input').value = '';
    $('file-name-display').textContent = '';
    extractedProfile = null;
    loadCases();
  } catch (err) {
    toast(err.error || 'Save failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Confirm & Save Profile';
  }
});

$('discard-btn').addEventListener('click', () => {
  $('profile-review').classList.add('hidden');
  extractedProfile = null;
  toast('Profile discarded.', 'info');
});

// ── ═══════════════════════ CASES ════════════════════════════════════════════ //
let selectedCaseId = null;

async function loadCases() {
  const list   = $('cases-list');
  const status = $('filter-status').value;
  const crime  = $('filter-crime').value;

  list.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span> Loading…</div>';
  $('case-detail').classList.remove('visible');

  try {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (crime)  params.append('crime_type', crime);
    const data  = await api('GET', `/api/cases?${params}`);

    if (!data.cases || !data.cases.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">🗂️</div><p>No cases found.</p></div>';
      return;
    }

    list.innerHTML = '';
    data.cases.forEach(c => list.appendChild(buildCaseRow(c)));
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.error || 'Failed to load cases.'}</p></div>`;
  }
}

function buildCaseRow(c) {
  const div = document.createElement('div');
  div.className = 'case-row';
  div.dataset.id = c.id;

  const badge  = c.status === 'solved'
    ? `<span class="badge badge-solved">✓ Solved</span>`
    : `<span class="badge badge-open">● Open</span>`;

  const crimeBadge = `<span class="crime-type-badge">${fmt(c.crime_type)}</span>`;

  div.innerHTML = `
    <div>
      <div class="case-number">${c.case_number || `#${c.id}`}</div>
      ${crimeBadge}
    </div>
    <div class="case-info">
      <div class="case-title">${c.criminal_name ? `${c.criminal_name} — ` : ''}${c.location || 'Unknown location'}</div>
      <div class="case-meta">📅 ${c.date || 'Date unknown'}</div>
    </div>
    ${badge}
    <span class="case-chevron">›</span>
  `;

  div.addEventListener('click', () => openCase(c.id, div));
  return div;
}

async function openCase(caseId, rowEl) {
  $$('.case-row.selected').forEach(el => el.classList.remove('selected'));
  if (rowEl) rowEl.classList.add('selected');
  selectedCaseId = caseId;

  const detailEl      = $('case-detail');
  const detailContent = $('case-detail-content');
  const similarEl     = $('similar-cases-content');
  const stepsEl       = $('next-steps-content');
  const solversEl     = $('solvers-content');

  detailEl.classList.add('visible');
  detailContent.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span></div>';
  similarEl.innerHTML  = '<div class="loading-placeholder"><span class="spinner"></span> Analyzing similar cases…</div>';
  stepsEl.innerHTML    = '<div class="loading-placeholder"><span class="spinner"></span> Generating AI suggestions…</div>';
  solversEl.innerHTML  = '<div class="loading-placeholder"><span class="spinner"></span> Finding expert officers…</div>';

  detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const [caseData, similarData, stepsData, solversData] = await Promise.allSettled([
    api('GET', `/api/cases/${caseId}`),
    api('GET', `/api/similar-cases/${caseId}`),
    api('GET', `/api/suggest-next-steps/${caseId}`),
    api('GET', `/api/similar-solvers/${caseId}`),
  ]);

  if (caseData.status === 'fulfilled') {
    renderCaseDetail(detailContent, caseData.value);
  } else {
    detailContent.innerHTML = `<p class="empty-state">⚠️ ${caseData.reason?.error || 'Failed to load'}</p>`;
  }

  if (similarData.status === 'fulfilled') {
    renderSimilarCases(similarEl, similarData.value.similar_cases);
  } else {
    similarEl.innerHTML = '<div class="empty-state"><p>Could not compute similar cases.</p></div>';
  }

  if (stepsData.status === 'fulfilled') {
    const steps = stepsData.value;
    stepsEl.innerHTML = '';
    const pre = document.createElement('div');
    pre.className = 'next-steps-content';
    pre.textContent = steps.suggestions;
    stepsEl.appendChild(pre);
    if (steps.based_on_cases?.length) {
      const note = document.createElement('p');
      note.style.cssText = 'font-size:0.72rem;color:var(--text-muted);margin-top:8px';
      note.textContent = `Based on resolved cases: #${steps.based_on_cases.join(', #')}`;
      stepsEl.appendChild(note);
    }
  } else {
    stepsEl.innerHTML = '<div class="empty-state"><p>Could not generate suggestions.</p></div>';
  }

  if (solversData.status === 'fulfilled') {
    renderSolvers(solversEl, solversData.value.officers, caseId);
  } else {
    solversEl.innerHTML = '<div class="empty-state"><p>No expert officers found.</p></div>';
  }
}

function renderCaseDetail(el, c) {
  const badge = c.status === 'solved' ? `<span class="badge badge-solved">✓ Solved</span>` : `<span class="badge badge-open">● Open</span>`;

  let officersHtml = '';
  if (c.officers?.length) {
    officersHtml = c.officers.map(o => `
      <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:var(--bg-card);border:1px solid var(--glass-border);border-radius:20px;font-size:0.74rem;margin:3px">
        👮 ${o.name} <span style="color:var(--text-muted)">(${o.role})</span>
      </span>`).join('');
  } else {
    officersHtml = '<span style="color:var(--text-muted);font-size:0.8rem">No officers assigned</span>';
  }

  el.innerHTML = `
    <div class="detail-header">
      <div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;color:var(--blue-bright);font-weight:600">${c.case_number || `Case #${c.id}`}</div>
        <div class="badges" style="margin-top:6px">
          ${badge}
          <span class="crime-type-badge">${fmt(c.crime_type)}</span>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="detail-section">
        <div class="detail-label">📍 Location</div>
        <div class="detail-value">${c.location || '—'}</div>
      </div>
      <div class="detail-section">
        <div class="detail-label">📅 Date</div>
        <div class="detail-value">${c.date || '—'}</div>
      </div>
      ${c.criminal_name ? `
      <div class="detail-section">
        <div class="detail-label">🧑 Linked Criminal</div>
        <div class="detail-value">${c.criminal_name} <span class="badge badge-${c.criminal_status}">${c.criminal_status || ''}</span></div>
      </div>` : ''}
    </div>

    <div class="detail-section" style="margin-bottom:12px">
      <div class="detail-label">📝 Description</div>
      <div class="detail-value" style="line-height:1.6">${c.description || '—'}</div>
    </div>

    ${c.resolution_notes ? `
    <div class="detail-section" style="margin-bottom:12px;padding:12px;background:var(--green-dim);border:1px solid rgba(0,230,118,0.2);border-radius:8px">
      <div class="detail-label" style="color:var(--green)">✓ Resolution Notes</div>
      <div class="detail-value" style="font-size:0.84rem">${c.resolution_notes}</div>
    </div>` : ''}

    <div class="detail-section">
      <div class="detail-label">👮 Assigned Officers</div>
      <div style="margin-top:6px">${officersHtml}</div>
    </div>

    <div class="divider"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-secondary" onclick="markSolved(${c.id})" ${c.status === 'solved' ? 'disabled' : ''}>✓ Mark Solved</button>
    </div>
  `;
}

function renderSimilarCases(el, cases) {
  if (!cases?.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>No similar cases found in the database.</p></div>';
    return;
  }
  el.innerHTML = '';
  cases.forEach(c => {
    const score = c.match_score;
    const color = score >= 0.6 ? 'var(--red)' : score >= 0.4 ? 'var(--orange)' : 'var(--text-secondary)';
    const statusBadge = c.status === 'solved'
      ? `<span class="badge badge-solved" style="font-size:0.62rem">Solved</span>`
      : `<span class="badge badge-open" style="font-size:0.62rem">Open</span>`;

    const card = document.createElement('div');
    card.className = 'similar-card';
    card.style.marginBottom = '8px';
    card.innerHTML = `
      <div class="match-score-ring" style="border-color:${color};color:${color}">
        ${Math.round(score * 100)}%
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
          <span style="font-family:'JetBrains Mono',monospace;font-size:0.74rem;color:var(--blue-bright)">${c.case_number || `#${c.case_id}`}</span>
          ${statusBadge}
          <span class="crime-type-badge">${fmt(c.crime_type)}</span>
        </div>
        <div style="font-size:0.8rem;color:var(--text-secondary)">📍 ${c.location || '—'} &bull; 📅 ${c.date || '—'}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">🔗 ${c.why}</div>
      </div>
      <button class="btn-secondary" style="font-size:0.72rem;padding:5px 10px" onclick="openCase(${c.case_id})">View →</button>
    `;
    el.appendChild(card);
  });
}

function renderSolvers(el, officers, caseId) {
  if (!officers?.length) {
    el.innerHTML = '<div class="empty-state"><p>No other officers have solved similar cases yet.</p></div>';
    return;
  }
  el.innerHTML = '';
  officers.forEach(o => {
    const card = document.createElement('div');
    card.className = 'solver-card';
    card.style.marginBottom = '8px';
    card.innerHTML = `
      <div class="solver-avatar">👮</div>
      <div class="solver-info">
        <div class="solver-name">${o.name}</div>
        <div class="solver-meta">${o.badge_number} &bull; ${o.station} &bull; ${o.cases_solved_count} solved</div>
      </div>
      <button class="btn-help" onclick="requestHelp(${o.id}, ${caseId})">🤝 Request Help</button>
    `;
    el.appendChild(card);
  });
}

async function requestHelp(officerId, caseId) {
  try {
    await api('POST', '/api/request-help', { officer_id: officerId, case_id: caseId, message: 'Requesting assistance on similar case' });
    toast('Help request sent! Officer will be notified.', 'success');
  } catch (err) {
    toast(err.error || 'Request failed.', 'error');
  }
}

async function markSolved(caseId) {
  const notes = prompt('Enter resolution notes (optional):') ?? '';
  try {
    await api('PUT', `/api/cases/${caseId}`, { status: 'solved', resolution_notes: notes });
    toast('Case marked as solved!', 'success');
    loadCases();
  } catch (err) {
    toast(err.error || 'Update failed.', 'error');
  }
}

$('filter-status').addEventListener('change', loadCases);
$('filter-crime').addEventListener('change', loadCases);
$('refresh-cases-btn').addEventListener('click', loadCases);

// ── ═══════════════════════ PROFILE ══════════════════════════════════════════ //
async function loadProfile() {
  const body = $('profile-body');
  body.innerHTML = '<div class="loading-placeholder"><span class="spinner"></span> Loading…</div>';

  try {
    const data = await api('GET', '/api/officers/me');
    const cases = data.cases || [];
    const solved = cases.filter(c => c.status === 'solved').length;
    const open   = cases.filter(c => c.status === 'open').length;

    body.innerHTML = `
      <div class="profile-header-card">
        <div class="profile-avatar">👮</div>
        <div class="profile-info">
          <div class="profile-name">${data.name}</div>
          <div class="profile-badge">Badge: ${data.badge_number}</div>
          <div class="profile-station">📍 ${data.station || 'Unassigned'}</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-num">${data.cases_solved_count || solved}</div>
          <div class="stat-label">Cases Solved</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${open}</div>
          <div class="stat-label">Open Cases</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${cases.length}</div>
          <div class="stat-label">Total Assigned</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📁 Assigned Cases</div>
        ${cases.length ? cases.map(c => `
          <div class="case-row" style="cursor:pointer" onclick="switchTab('cases')">
            <div>
              <div class="case-number">${c.case_number || `#${c.id}`}</div>
              <span class="crime-type-badge">${fmt(c.crime_type)}</span>
            </div>
            <div class="case-info">
              <div class="case-title">${c.location || '—'}</div>
              <div class="case-meta">📅 ${c.date || '—'} &bull; Role: <b>${c.role}</b></div>
            </div>
            ${c.status === 'solved' ? `<span class="badge badge-solved">Solved</span>` : `<span class="badge badge-open">Open</span>`}
          </div>
        `).join('') : '<div class="empty-state"><p>No cases assigned yet.</p></div>'}
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.error || 'Failed to load profile.'}</p></div>`;
  }
}

// ── ═══════════════════════ DASHBOARD ════════════════════════════════════════ //
const CHART_COLORS = [
  '#4da6ff','#ffd700','#00e676','#ff5252','#ffab40',
  '#b39ddb','#80cbc4','#ef9a9a','#f48fb1','#a5d6a7'
];

async function loadDashboard() {
  if (chartsInitialised) return;

  try {
    const data = await api('GET', '/api/stats');

    buildChart('chart-crime-dist', 'doughnut', {
      labels: data.crime_distribution.map(d => fmt(d.crime_type)),
      datasets: [{
        data:            data.crime_distribution.map(d => d.count),
        backgroundColor: CHART_COLORS,
        borderColor:     'rgba(255,255,255,0.05)',
        borderWidth:     1,
      }],
    }, { plugins: { legend: { position: 'right', labels: { color: '#8a94a8', font: { size: 11 } } } } });

    const statusColors = { open: '#ff5252', solved: '#00e676' };
    buildChart('chart-status', 'pie', {
      labels: data.status_distribution.map(d => d.status),
      datasets: [{
        data:            data.status_distribution.map(d => d.count),
        backgroundColor: data.status_distribution.map(d => statusColors[d.status] || '#4da6ff'),
        borderColor:     'rgba(255,255,255,0.05)',
        borderWidth:     1,
      }],
    });

    buildChart('chart-station', 'bar', {
      labels: data.station_stats.map(d => d.station),
      datasets: [
        { label: 'Total',  data: data.station_stats.map(d => d.total_cases), backgroundColor: 'rgba(77,166,255,0.5)',  borderColor: '#4da6ff', borderWidth: 1 },
        { label: 'Solved', data: data.station_stats.map(d => d.solved),      backgroundColor: 'rgba(0,230,118,0.5)',   borderColor: '#00e676', borderWidth: 1 },
      ],
    }, { indexAxis: 'x', scales: { y: { beginAtZero: true, ticks: { color: '#8a94a8' }, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { ticks: { color: '#8a94a8', maxRotation: 30 }, grid: { display: false } } } });

    if (data.monthly_cases && data.monthly_cases.length) {
      buildChart('chart-monthly', 'line', {
        labels: data.monthly_cases.map(d => d.month),
        datasets: [{
          label: 'Cases',
          data: data.monthly_cases.map(d => d.count),
          borderColor: '#4da6ff',
          backgroundColor: 'rgba(77,166,255,0.12)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#4da6ff',
        }],
      }, { scales: { y: { beginAtZero: true, ticks: { color: '#8a94a8' }, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { ticks: { color: '#8a94a8' }, grid: { display: false } } } });
    }

    chartsInitialised = true;
  } catch (err) {
    toast(`Dashboard: ${err.error || 'Failed to load stats'}`, 'error');
  }
}

function buildChart(canvasId, type, data, extraOptions = {}) {
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

  const ctx = $(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          labels: { color: '#8a94a8', font: { size: 11, family: 'Inter' } },
          ...((extraOptions.plugins?.legend) || {}),
        },
        ...extraOptions.plugins,
      },
      ...extraOptions,
    },
  });
}

// ── Utility ────────────────────────────────────────────────────────────────────
function fmt(str) {
  if (!str) return '—';
  return str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
