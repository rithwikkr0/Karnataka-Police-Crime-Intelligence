"""
KSP Crime Database — Intelligent Conversational AI
Datathon 2026 | Karnataka State Police
Karnataka Police Department FIR System (ER Diagram Schema Alignment)

Run locally:
    GEMINI_API_KEY=... FLASK_SECRET_KEY=... python app.py

Deploy (Zoho Catalyst AppSail):
    Set environment variables X_ZOHO_CATALYST_LISTEN_PORT, GEMINI_API_KEY, FLASK_SECRET_KEY
"""

import os, json, sqlite3, re, io, tempfile, time
from datetime import datetime
from functools import wraps

from flask import Flask, request, jsonify, session, render_template, g
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except Exception:
    genai = None
    GENAI_AVAILABLE = False

# ── Optional OCR / PDF deps (graceful degradation) ──────────────────────────
try:
    import pytesseract
    from PIL import Image
    pytesseract.get_tesseract_version()   # raises EnvironmentError if binary absent
    OCR_AVAILABLE = True
except Exception:
    OCR_AVAILABLE = False

try:
    from pdf2image import convert_from_bytes
    PDF_AVAILABLE = True
except Exception:
    PDF_AVAILABLE = False

# ── App configuration ────────────────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'ksp-datathon-2026-local-dev-only')

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
_MODEL_CANDIDATES = ['gemini-3.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest']
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

def _call_gemini(prompt, retries=3):
    api_key = os.getenv('GEMINI_API_KEY') or GEMINI_API_KEY
    if not api_key:
        raise RuntimeError("Gemini API key not configured")
    genai.configure(api_key=api_key)
    
    last_err = None
    for model_name in _MODEL_CANDIDATES:
        for i in range(retries):
            try:
                m = genai.GenerativeModel(model_name)
                return m.generate_content(prompt)
            except Exception as e:
                last_err = e
                err_str = str(e)
                if '429' in err_str or 'Quota' in err_str:
                    if i < retries - 1:
                        m_match = re.search(r'retry in (\d+)', err_str, re.IGNORECASE)
                        delay = int(m_match.group(1)) + 2 if m_match else 5
                        time.sleep(min(delay, 10))
                    else:
                        break
                else:
                    raise e
    raise last_err


def _get_db_path():
    if os.getenv('X_ZOHO_CATALYST_LISTEN_PORT') or os.getenv('LISTEN_PORT') or os.getenv('PORT'):
        return os.path.join(tempfile.gettempdir(), 'crime.db')
    default_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crime.db')
    try:
        test_file = os.path.join(os.path.dirname(default_path), '.rw_test')
        with open(test_file, 'w') as f:
            f.write('1')
        os.remove(test_file)
        return default_path
    except (OSError, IOError):
        return os.path.join(tempfile.gettempdir(), 'crime.db')


def _get_upload_folder():
    if os.getenv('X_ZOHO_CATALYST_LISTEN_PORT') or os.getenv('LISTEN_PORT') or os.getenv('PORT'):
        tmp_upload = os.path.join(tempfile.gettempdir(), 'uploads')
        os.makedirs(tmp_upload, exist_ok=True)
        return tmp_upload
    default_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
    try:
        os.makedirs(default_path, exist_ok=True)
        return default_path
    except (OSError, IOError):
        tmp_upload = os.path.join(tempfile.gettempdir(), 'uploads')
        os.makedirs(tmp_upload, exist_ok=True)
        return tmp_upload


DB_PATH = _get_db_path()
UPLOAD_FOLDER = _get_upload_folder()

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf', 'tiff', 'bmp'}
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB

# ── Database schema DDL (Official KSP FIR System Alignment) ───────────────────
DDL = """
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
    UnitID             INTEGER REFERENCES Unit(UnitID),
    RankID             INTEGER DEFAULT 1,
    DesignationID      INTEGER DEFAULT 1,
    KGID               TEXT UNIQUE NOT NULL,
    FirstName          TEXT NOT NULL,
    GenderID           INTEGER DEFAULT 1,
    cases_solved_count INTEGER DEFAULT 0,
    password_hash      TEXT NOT NULL,
    created_at         TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS CaseMaster (
    CaseMasterID       INTEGER PRIMARY KEY AUTOINCREMENT,
    CrimeNo            TEXT,
    CaseNo             TEXT UNIQUE NOT NULL,
    CrimeRegisteredDate TEXT,
    PolicePersonID     INTEGER REFERENCES Employee(EmployeeID),
    PoliceStationID    INTEGER REFERENCES Unit(UnitID),
    CaseCategoryID     INTEGER DEFAULT 1,
    GravityOffenceID   INTEGER DEFAULT 1,
    CrimeMajorHeadID   INTEGER DEFAULT 1,
    CrimeMinorHeadID   INTEGER REFERENCES CrimeSubHead(CrimeSubHeadID),
    CaseStatusID       INTEGER REFERENCES CaseStatusMaster(CaseStatusID),
    IncidentFromDate   TEXT,
    IncidentToDate     TEXT,
    latitude           REAL,
    longitude          REAL,
    BriefFacts         TEXT,
    resolution_notes   TEXT,
    confidence_flag    TEXT DEFAULT 'ai_extracted',
    created_at         TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Accused (
    AccusedMasterID     INTEGER PRIMARY KEY AUTOINCREMENT,
    CaseMasterID        INTEGER REFERENCES CaseMaster(CaseMasterID),
    AccusedName         TEXT NOT NULL,
    AgeYear             INTEGER,
    GenderID            INTEGER DEFAULT 1,
    PersonID            TEXT DEFAULT 'A1',
    aliases             TEXT,
    description         TEXT,
    last_known_location TEXT,
    status              TEXT DEFAULT 'wanted',
    confidence_flag     TEXT DEFAULT 'ai_extracted',
    created_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Victim (
    VictimMasterID INTEGER PRIMARY KEY AUTOINCREMENT,
    CaseMasterID   INTEGER REFERENCES CaseMaster(CaseMasterID),
    VictimName     TEXT NOT NULL,
    AgeYear        INTEGER,
    GenderID       INTEGER DEFAULT 1,
    VictimPolice   TEXT DEFAULT 'No'
);

CREATE TABLE IF NOT EXISTS ComplainantDetails (
    ComplainantID   INTEGER PRIMARY KEY AUTOINCREMENT,
    CaseMasterID    INTEGER REFERENCES CaseMaster(CaseMasterID),
    ComplainantName TEXT NOT NULL,
    AgeYear         INTEGER,
    GenderID        INTEGER DEFAULT 1
);
"""

# ── DB helpers ───────────────────────────────────────────────────────────────
def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(e=None):
    db = g.pop('db', None)
    if db:
        db.close()


def get_readonly_db():
    con = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    return con


def row_to_dict(row):
    return dict(row) if row else None


def rows_to_list(rows):
    return [dict(r) for r in rows]


# ── Database initialisation & seeding ────────────────────────────────────────
def init_db():
    con = sqlite3.connect(DB_PATH)
    con.executescript(DDL)
    con.commit()

    cur = con.execute("SELECT COUNT(*) FROM Employee")
    if cur.fetchone()[0] == 0:
        _seed_demo_data(con)

    con.close()


def _seed_demo_data(con):
    pw = generate_password_hash('demo123')

    # 1. CaseStatusMaster
    statuses = [
        (1, 'Open'),
        (2, 'Under Investigation'),
        (3, 'Charge Sheeted'),
        (4, 'Closed'),
        (5, 'Solved')
    ]
    con.executemany("INSERT OR IGNORE INTO CaseStatusMaster (CaseStatusID, CaseStatusName) VALUES (?,?)", statuses)

    # 2. CrimeSubHead
    crime_heads = [
        (1, 10, 'Burglary'),
        (2, 20, 'Theft'),
        (3, 30, 'Fraud'),
        (4, 40, 'Vehicle Theft'),
        (5, 50, 'Assault'),
        (6, 60, 'Kidnapping'),
        (7, 70, 'Drug Trafficking')
    ]
    con.executemany("INSERT OR IGNORE INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName) VALUES (?,?,?)", crime_heads)

    # 3. Unit (Police Stations)
    units = [
        (1, 'Bengaluru Central'),
        (2, 'Mysuru City'),
        (3, 'Kolar District'),
        (4, 'Shivajinagar Station'),
        (5, 'Mangaluru Port Station'),
        (6, 'Hubli Old Town Station'),
        (7, 'Tumkur Station'),
        (8, 'Hassan Station'),
        (9, 'Belagavi Station'),
        (10, 'Davangere Station')
    ]
    con.executemany("INSERT OR IGNORE INTO Unit (UnitID, UnitName) VALUES (?,?)", units)

    # 4. Employee (Officers)
    employees = [
        (1, 1, 1, 1, 'KSP001', 'Inspector Rajesh Kumar',  1, 12, pw),
        (2, 2, 2, 2, 'KSP002', 'Sub-Inspector Priya Nair', 2, 8,  pw),
        (3, 3, 3, 3, 'KSP003', 'Head Constable ಮಹೇಶ್ ಗೌಡ', 1, 5,  pw)
    ]
    con.executemany(
        "INSERT OR IGNORE INTO Employee (EmployeeID, UnitID, RankID, DesignationID, KGID, FirstName, GenderID, cases_solved_count, password_hash) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        employees
    )

    # 5. CaseMaster (10 Cases)
    cases = [
        (1, '001/2024', 'KSP/KOL/2024/001', '2024-03-15', 3, 3, 1, 5, '2024-03-15',
         'Residential burglary at night; jewelry and cash stolen; suspect entered through rear window; neighbor reported seeing a man with scar on left cheek near property the previous evening.',
         'CCTV footage from nearby ATM identified suspect. Pawn shop in Kolar town confirmed jewelry sale. Arrested within 72 hours of FIR filing.', 'verified'),

        (2, '042/2024', 'KSP/BLR/2024/042', '2024-05-22', 1, 1, 2, 5, '2024-05-22',
         'Theft of mobile phones and wallets in crowded market; multiple victims on same day; pickpocket operation suspected.',
         'Decoy officers deployed in market area. Suspect apprehended in the act. Stolen items recovered from hideout in Shivajinagar slum.', 'verified'),

        (3, '015/2024', 'KSP/MYS/2024/015', '2024-07-10', 2, 2, 2, 1, '2024-07-10',
         'Temple donation box theft at Chamundeshwari temple vicinity; suspect group of 3 women distracted priest and broke open collection box.',
         None, 'verified'),

        (4, '007/2024', 'KSP/MNG/2024/007', '2024-08-05', 1, 5, 3, 1, '2024-08-05',
         'Investment fraud; victim lost Rs 15 lakhs in fake trading scheme; suspect posed as SEBI-registered broker with forged company letterhead.',
         None, 'ai_extracted'),

        (5, '033/2024', 'KSP/HBL/2024/033', '2024-09-12', 3, 6, 4, 1, '2024-09-12',
         'Two-wheeler theft from hospital parking lot; CCTV partially damaged; witness reports young man tampering with lock around midnight.',
         None, 'ai_extracted'),

        (6, '011/2024', 'KSP/TMK/2024/011', '2024-06-18', 2, 7, 5, 5, '2024-06-18',
         'Assault resulting in grievous hurt; victim attacked with blunt object outside bar; multiple witnesses present; attacker fled on motorcycle.',
         'Witnesses identified suspect from photo lineup. Arrested at residence 3 days later. Weapon recovered from suspect home. Medical evidence corroborated witness statements.', 'verified'),

        (7, '009/2024', 'KSP/HSN/2024/009', '2024-10-02', 1, 8, 3, 1, '2024-10-02',
         'Government impersonation fraud; suspect posed as Revenue Inspector and collected bribe money from 7 farmers for land mutation; total Rs 2.1 lakhs.',
         None, 'ai_extracted'),

        (8, '089/2024', 'KSP/BLR/2024/089', '2024-11-15', 1, 1, 6, 1, '2024-11-15',
         'Minor child kidnapping attempt near school; suspect approached child claiming to be relative; child raised alarm; suspect fled in auto-rickshaw.',
         None, 'ai_extracted'),

        (9, '021/2024', 'KSP/BLG/2024/021', '2024-12-01', 3, 9, 1, 1, '2024-12-01',
         'Commercial burglary; jewelry shop broken into at 2 AM; safe cracked; loss estimated Rs 8 lakhs; no CCTV; night watchman sedated.',
         None, 'verified'),

        (10, '055/2024', 'KSP/DVG/2024/055', '2024-08-28', 2, 10, 7, 5, '2024-08-28',
         'Drug peddling operation busted; 500g of ganja and 50g of heroin recovered; suspect arrested at scene; believed to be part of larger network.',
         'Narcotics unit surveillance for 2 weeks prior to arrest. Supply chain traced to Bengaluru distributor. Mobile call records used as evidence. Charge-sheeted under NDPS Act.', 'verified')
    ]
    con.executemany("""
        INSERT OR IGNORE INTO CaseMaster (CaseMasterID, CrimeNo, CaseNo, CrimeRegisteredDate, PolicePersonID, PoliceStationID,
                                CrimeMinorHeadID, CaseStatusID, IncidentFromDate, BriefFacts, resolution_notes, confidence_flag)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    """, cases)

    # 6. Accused (10 Accused)
    accused = [
        (1, 1, 'ಅರ್ಜುನ್ ರೆಡ್ಡಿ', 32, 1, 'A1', 'Arjun, Raju',         'Male, 30s, scar on left cheek, speaks Telugu and Kannada',                                'Kolar Gold Fields area',       'wanted',   'ai_extracted'),
        (2, 2, 'Mohammad Saleem',  42, 1, 'A1', 'Saleem, Saleemuddin', 'Male, 40s, known fence for stolen jewelry, frequents Shivajinagar market',               'Shivajinagar, Bengaluru',      'arrested', 'verified'),
        (3, 4, 'ರಾಘವೇಂದ್ರ ಶೆಟ್ಟಿ', 51, 1, 'A1', 'Raghavendra, Shetty', 'Male, 50s, operates fake investment schemes, well-dressed, carries fake SEBI cards',     'Mangaluru port area',          'active',   'ai_extracted'),
        (4, 3, 'Lakshmi Devi',     35, 2, 'A1', 'Lakshmi, Devamma',    'Female, 35, works in groups targeting temple visitors, wears sari',                      'Mysuru, Chamundeshwari area',  'wanted',   'verified'),
        (5, 5, 'ಸಿದ್ದಯ್ಯ ನಾಯಕ್', 28, 1, 'A1', 'Siddaiah, Nayaka',    'Male, 28, expert car thief, works alone, known to use duplicate keys',                   'Hubli-Dharwad area',           'active',   'ai_extracted'),
        (6, 6, 'Venkatesh Murthy', 45, 1, 'A1', 'Venki',               'Male, 45, history of violent altercations in taverns, stocky build',                    'Tumkur district',              'arrested', 'verified'),
        (7, 7, 'ಅನಿತಾ ಕೃಷ್ಣ',    38, 2, 'A1', 'Anita, Krishnamma',   'Female, 38, impersonates Revenue Department officials, carries fake ID',                 'Hassan district',              'wanted',   'ai_extracted'),
        (8, 8, 'Riyaz Khan',       33, 1, 'A1', 'Riyaz Bhai',          'Male, 33, known associate of organized crime, multiple prior detentions',               'Bengaluru North',              'wanted',   'ai_extracted'),
        (9, 9, 'ಗಣೇಶ್ ಪಾಟೀಲ್',   26, 1, 'A1', 'Ganesh, Patil',       'Male, 26, targets commercial establishments at night, suspected to be part of a gang', 'Belagavi area',                'active',   'verified'),
        (10, 10, 'Suresh Babu',    39, 1, 'A1', 'Suresh, S.B.',        'Male, 39, mid-level narcotics distributor, uses auto-rickshaws as cover',              'Davangere city',               'arrested', 'verified')
    ]
    con.executemany("""
        INSERT OR IGNORE INTO Accused (AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID, PersonID, aliases, description,
                             last_known_location, status, confidence_flag)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
    """, accused)

    # 7. Victim
    victims = [
        (1, 1, 'Ramesh Hegde',       48, 1, 'No'),
        (2, 2, 'Anand V.',           32, 1, 'No'),
        (3, 3, 'Temple Authority',    0, 0, 'No'),
        (4, 4, 'Kiran Kumar',        41, 1, 'No'),
        (5, 5, 'Prakash Rao',        29, 1, 'No'),
        (6, 6, 'Manjunath B.',       36, 1, 'No'),
        (7, 7, 'Farmer Group',       50, 1, 'No'),
        (8, 8, 'Master Rahul',        9, 1, 'No'),
        (9, 9, 'Swathi Jewellers',    0, 0, 'No'),
        (10, 10, 'State of Karnataka',0, 0, 'Yes')
    ]
    con.executemany("INSERT OR IGNORE INTO Victim (VictimMasterID, CaseMasterID, VictimName, AgeYear, GenderID, VictimPolice) VALUES (?,?,?,?,?,?)", victims)

    # 8. ComplainantDetails
    complainants = [
        (1, 1, 'Ramesh Hegde',               48, 1),
        (2, 2, 'Anand V.',                   32, 1),
        (3, 3, 'Priest Sundaram',            55, 1),
        (4, 4, 'Kiran Kumar',                41, 1),
        (5, 5, 'Prakash Rao',                29, 1),
        (6, 6, 'Bar Manager Shrinivas',      44, 1),
        (7, 7, 'Ningappa (Farmer)',          52, 1),
        (8, 8, 'School Principal Sunitha',   46, 2),
        (9, 9, 'Shop Owner Suresh',          50, 1),
        (10, 10, 'Sub-Inspector Priya Nair', 34, 2)
    ]
    con.executemany("INSERT OR IGNORE INTO ComplainantDetails (ComplainantID, CaseMasterID, ComplainantName, AgeYear, GenderID) VALUES (?,?,?,?,?)", complainants)

    con.commit()


# ── Gemini prompts ───────────────────────────────────────────────────────────
_SCHEMA = """
Tables in the Karnataka Police Department FIR System (SQLite):

CaseMaster(
    CaseMasterID INTEGER PRIMARY KEY,
    CrimeNo TEXT,
    CaseNo TEXT UNIQUE,
    CrimeRegisteredDate TEXT,
    PolicePersonID INTEGER REFERENCES Employee(EmployeeID),
    PoliceStationID INTEGER REFERENCES Unit(UnitID),
    CrimeMinorHeadID INTEGER REFERENCES CrimeSubHead(CrimeSubHeadID),
    CaseStatusID INTEGER REFERENCES CaseStatusMaster(CaseStatusID),
    IncidentFromDate TEXT,
    IncidentToDate TEXT,
    latitude REAL,
    longitude REAL,
    BriefFacts TEXT,
    resolution_notes TEXT,
    confidence_flag TEXT ['ai_extracted'|'verified']
)

Accused(
    AccusedMasterID INTEGER PRIMARY KEY,
    CaseMasterID INTEGER REFERENCES CaseMaster(CaseMasterID),
    AccusedName TEXT,
    AgeYear INTEGER,
    GenderID INTEGER,
    PersonID TEXT ['A1'|'A2'|...],
    aliases TEXT,
    description TEXT,
    last_known_location TEXT,
    status TEXT ['wanted'|'arrested'|'active'],
    confidence_flag TEXT ['ai_extracted'|'verified']
)

Victim(
    VictimMasterID INTEGER PRIMARY KEY,
    CaseMasterID INTEGER REFERENCES CaseMaster(CaseMasterID),
    VictimName TEXT,
    AgeYear INTEGER,
    GenderID INTEGER,
    VictimPolice TEXT
)

ComplainantDetails(
    ComplainantID INTEGER PRIMARY KEY,
    CaseMasterID INTEGER REFERENCES CaseMaster(CaseMasterID),
    ComplainantName TEXT,
    AgeYear INTEGER,
    GenderID INTEGER
)

Employee(
    EmployeeID INTEGER PRIMARY KEY,
    UnitID INTEGER REFERENCES Unit(UnitID),
    RankID INTEGER,
    DesignationID INTEGER,
    KGID TEXT UNIQUE,
    FirstName TEXT,
    GenderID INTEGER,
    cases_solved_count INTEGER
)

CaseStatusMaster(
    CaseStatusID INTEGER PRIMARY KEY,
    CaseStatusName TEXT ['Open'|'Under Investigation'|'Charge Sheeted'|'Closed'|'Solved']
)

CrimeSubHead(
    CrimeSubHeadID INTEGER PRIMARY KEY,
    CrimeHeadID INTEGER,
    CrimeHeadName TEXT ['Burglary'|'Theft'|'Fraud'|'Vehicle Theft'|'Assault'|'Kidnapping'|'Drug Trafficking']
)

Unit(
    UnitID INTEGER PRIMARY KEY,
    UnitName TEXT  -- Police Station / Unit Name e.g. 'Bengaluru Central', 'Mysuru City', 'Kolar District'
)
"""

_NL_SQL_PROMPT = """You are a SQL expert for the Karnataka State Police crime database (FIR System).
Convert the question below into a single valid SQLite SELECT query.

{schema}

STRICT RULES — violating any rule makes your response invalid:
1. Output ONLY the raw SQL — no markdown, no code fences, no explanation
2. Only SELECT — never INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE, or REPLACE
3. No semicolons anywhere in your output
4. Use LOWER() and LIKE for case-insensitive text searches
5. When filtering by crime type (e.g., burglary, theft), JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID and search LOWER(csh.CrimeHeadName)
6. When filtering by status (e.g., open, solved), JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID and search LOWER(csm.CaseStatusName)
7. When filtering by location or city (e.g., Bengaluru, Mysuru, Kolar), JOIN Unit u ON cm.PoliceStationID = u.UnitID and search LOWER(u.UnitName) or LOWER(cm.BriefFacts)
8. When filtering or querying criminals/accused, JOIN Accused a ON cm.CaseMasterID = a.CaseMasterID
9. Limit to 50 rows with LIMIT 50
10. If the question cannot be answered from the schema, output exactly:
    SELECT 'No relevant data found for this query' AS message

Question: {question}

SQL:"""

_ANSWER_PROMPT = """You are a professional police database assistant for Karnataka State Police (KSP).

A police officer asked a question; the database returned results below.
Write a clear, concise, professional answer in the EXACT SAME LANGUAGE the officer used
(English → English, Kannada → Kannada, Telugu → Telugu).
State clearly if no results were found.

Officer question: {question}
SQL used: {sql}
Database results (JSON): {results}

Answer:"""

_FIR_EXTRACTION_PROMPT = """You are an expert at extracting structured data from First Information Reports (FIRs) for Karnataka State Police.

Analyse the FIR text and return ONLY a valid JSON object — no markdown, no code fences, no commentary:

{{
  "case": {{
    "CaseNo": "FIR case number if present, else null",
    "CrimeNo": "Crime registration number if present, else null",
    "CrimeHeadName": "One of: Burglary | Theft | Fraud | Vehicle Theft | Assault | Kidnapping | Drug Trafficking | Other",
    "location": "Where the crime occurred",
    "IncidentFromDate": "Incident date in YYYY-MM-DD format",
    "BriefFacts": "Comprehensive description of the crime as reported"
  }},
  "accused": {{
    "AccusedName": "Full name of accused (preserve Kannada/Telugu/English script)",
    "AgeYear": 30,
    "GenderID": 1,
    "aliases": "Comma-separated aliases or null",
    "description": "Physical description, background, identifying features",
    "last_known_location": "Last known address or locality mentioned",
    "status": "wanted"
  }},
  "victim": {{
    "VictimName": "Full name of victim if present",
    "AgeYear": 35,
    "GenderID": 1
  }},
  "complainant": {{
    "ComplainantName": "Full name of complainant if present",
    "AgeYear": 40,
    "GenderID": 1
  }},
  "extraction_notes": "Any caveats, unclear fields, or ambiguous information"
}}

FIR Text:
{text}"""

_NEXT_STEPS_PROMPT = """You are an experienced criminal investigation advisor for Karnataka State Police.

An officer needs actionable guidance for the OPEN case below, based on how SIMILAR solved cases were resolved.

Current open case:
{current_case}

Similar solved cases with resolution notes:
{resolved_cases}

Provide 5–6 specific, practical, immediately actionable investigation steps.
Draw directly from tactics that worked in the similar cases.
Keep advice realistic for Karnataka Police field operations.
Format: numbered list, each item ≤ 2 sentences."""


# ── Auth decorator ───────────────────────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'officer_id' not in session:
            return jsonify({'error': 'Authentication required', 'code': 'UNAUTHENTICATED'}), 401
        return f(*args, **kwargs)
    return decorated


# ── Auth endpoints ────────────────────────────────────────────────────────────
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(force=True) or {}
    badge = (data.get('badge_number') or data.get('kgid') or '').strip()
    password = data.get('password', '')

    if not badge or not password:
        return jsonify({'error': 'badge_number (KGID) and password are required'}), 400

    db = get_db()
    emp = row_to_dict(
        db.execute("""
            SELECT e.*, u.UnitName
            FROM Employee e
            LEFT JOIN Unit u ON e.UnitID = u.UnitID
            WHERE e.KGID = ?
        """, (badge,)).fetchone()
    )

    if not emp or not check_password_hash(emp['password_hash'], password):
        return jsonify({'error': 'Invalid KGID badge number or password'}), 401

    session.clear()
    session['officer_id'] = emp['EmployeeID']
    session['officer_name'] = emp['FirstName']
    session['badge_number'] = emp['KGID']

    emp.pop('password_hash', None)
    officer_profile = {
        'id': emp['EmployeeID'],
        'name': emp['FirstName'],
        'badge_number': emp['KGID'],
        'station': emp.get('UnitName') or 'KSP Command',
        'cases_solved_count': emp.get('cases_solved_count', 0)
    }
    return jsonify({'officer': officer_profile, 'message': f"Welcome, {emp['FirstName']}!"})


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'Logged out successfully'})


@app.route('/api/officers/me', methods=['GET'])
@login_required
def get_current_officer():
    db = get_db()
    emp = row_to_dict(db.execute("""
        SELECT e.EmployeeID AS id, e.FirstName AS name, e.KGID AS badge_number,
               u.UnitName AS station, e.cases_solved_count
        FROM Employee e
        LEFT JOIN Unit u ON e.UnitID = u.UnitID
        WHERE e.EmployeeID = ?
    """, (session['officer_id'],)).fetchone())

    cases = rows_to_list(db.execute("""
        SELECT cm.CaseMasterID AS id, cm.CaseNo AS case_number, csh.CrimeHeadName AS crime_type,
               u.UnitName AS location, cm.IncidentFromDate AS date, csm.CaseStatusName AS status,
               'lead' AS role
        FROM CaseMaster cm
        LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
        LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
        LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
        WHERE cm.PolicePersonID = ?
        ORDER BY cm.created_at DESC
    """, (session['officer_id'],)).fetchall())

    emp['cases'] = cases
    return jsonify(emp)


# ── Chat endpoint ─────────────────────────────────────────────────────────────
@app.route('/api/chat', methods=['POST'])
@login_required
def chat():
    data = request.get_json(force=True) or {}
    question = (data.get('question') or '').strip()

    if not question:
        return jsonify({'error': 'question is required'}), 400
    if not GEMINI_API_KEY:
        return jsonify({'error': 'Gemini API key not configured — set GEMINI_API_KEY environment variable'}), 503

    try:
        sql_prompt = _NL_SQL_PROMPT.format(schema=_SCHEMA, question=question)
        sql_response = _call_gemini(sql_prompt)
        sql_query = sql_response.text.strip()

        sql_query = re.sub(r'^```(?:sql)?\s*', '', sql_query, flags=re.IGNORECASE)
        sql_query = re.sub(r'\s*```$', '', sql_query)
        sql_query = sql_query.strip()

        if not re.match(r'^\s*SELECT\b', sql_query, re.IGNORECASE):
            return jsonify({'error': 'Could not generate a valid SELECT query', 'sql_used': sql_query}), 400

        if ';' in sql_query:
            sql_query = sql_query.split(';')[0].strip()

        _FORBIDDEN = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'REPLACE', 'ATTACH']
        for kw in _FORBIDDEN:
            if re.search(r'\b' + kw + r'\b', sql_query, re.IGNORECASE):
                return jsonify({'error': f'Query contains forbidden keyword: {kw}'}), 400

        try:
            ro_db = get_readonly_db()
            cursor = ro_db.execute(sql_query)
            rows = rows_to_list(cursor.fetchmany(50))
            ro_db.close()
        except Exception as sql_err:
            return jsonify({'error': f'Query execution error: {str(sql_err)}', 'sql_used': sql_query}), 400

        results_str = json.dumps(rows, ensure_ascii=False, indent=2) if rows else '[]'
        answer_prompt = _ANSWER_PROMPT.format(question=question, sql=sql_query, results=results_str)
        answer_response = _call_gemini(answer_prompt)

        return jsonify({
            'answer':       answer_response.text.strip(),
            'sql_used':     sql_query,
            'matched_rows': rows,
        })

    except Exception as e:
        return jsonify({'error': f'AI processing failed: {str(e)}'}), 500


# ── FIR upload & Profile Save ────────────────────────────────────────────────
def _allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/api/upload-fir', methods=['POST'])
@login_required
def upload_fir():
    raw_text = (request.form.get('raw_text') or '').strip()
    extracted_text = ''
    ocr_used = False

    if raw_text:
        extracted_text = raw_text

    elif 'file' in request.files:
        file = request.files['file']
        if not file or file.filename == '' or not _allowed_file(file.filename):
            return jsonify({'error': 'Invalid or missing file. Supported formats: PNG, JPG, PDF, TIFF, BMP'}), 400

        file_bytes = file.read()
        filename_lower = (file.filename or '').lower()

        if filename_lower.endswith('.pdf'):
            if not PDF_AVAILABLE:
                return jsonify({
                    'error': 'PDF support unavailable (Poppler not installed). '
                             'Please paste the FIR text in the text area instead.',
                    'fallback_hint': 'Use the text paste field',
                }), 400
            try:
                images = convert_from_bytes(file_bytes, first_page=1, last_page=1)
                img = images[0]
            except Exception as e:
                return jsonify({'error': f'PDF conversion failed: {e}'}), 500
        else:
            if not OCR_AVAILABLE:
                return jsonify({
                    'error': 'OCR unavailable (pytesseract / Pillow not installed). '
                             'Please paste the FIR text in the text area instead.',
                    'fallback_hint': 'Use the text paste field',
                }), 400
            try:
                img = Image.open(io.BytesIO(file_bytes))
            except Exception as e:
                return jsonify({'error': f'Image loading failed: {e}'}), 400

        try:
            try:
                extracted_text = pytesseract.image_to_string(img, lang='eng+kan+tel')
            except pytesseract.TesseractError:
                extracted_text = pytesseract.image_to_string(img, lang='eng')
            ocr_used = True
        except Exception as e:
            return jsonify({'error': f'OCR extraction failed: {e}'}), 500

    else:
        return jsonify({'error': 'Provide either a "file" upload or a "raw_text" field'}), 400

    if not extracted_text.strip():
        return jsonify({'error': 'No text could be extracted. Check image quality or paste the text directly.'}), 400

    if not GEMINI_API_KEY:
        return jsonify({'error': 'Gemini API key not configured — set GEMINI_API_KEY'}), 503

    try:
        prompt = _FIR_EXTRACTION_PROMPT.format(text=extracted_text)
        response = _call_gemini(prompt)
        response_text = response.text.strip()

        response_text = re.sub(r'^```(?:json)?\s*', '', response_text, flags=re.IGNORECASE)
        response_text = re.sub(r'\s*```$', '', response_text)

        profile = json.loads(response_text)
    except json.JSONDecodeError as e:
        return jsonify({
            'error': f'AI response could not be parsed as JSON: {e}',
            'raw_response': response.text if 'response' in dir() else 'N/A',
        }), 500
    except Exception as e:
        return jsonify({'error': f'AI extraction failed: {e}'}), 500

    return jsonify({
        'extracted_text': extracted_text,
        'profile':        profile,
        'ocr_used':       ocr_used,
        'dry_run':        True,
        'message':        'Review the extracted profile below and confirm to save.',
    })


@app.route('/api/upload-fir/confirm', methods=['POST'])
@login_required
def confirm_fir():
    data = request.get_json(force=True) or {}
    profile = data.get('profile')
    if not profile:
        return jsonify({'error': 'profile data is required'}), 400

    db = get_db()
    case_data = profile.get('case', {})
    accused_data = profile.get('accused', {})
    victim_data = profile.get('victim', {})
    complainant_data = profile.get('complainant', {})

    try:
        # Match CrimeHeadName to CrimeSubHeadID
        crime_head_name = case_data.get('CrimeHeadName') or 'Theft'
        csh_row = db.execute("SELECT CrimeSubHeadID FROM CrimeSubHead WHERE LOWER(CrimeHeadName) = LOWER(?)", (crime_head_name,)).fetchone()
        crime_sub_head_id = csh_row[0] if csh_row else 2  # Default to Theft

        case_no = case_data.get('CaseNo') or f"KSP/FIR/{datetime.now().strftime('%Y%m%d%H%M%S')}"

        cur_case = db.execute("""
            INSERT INTO CaseMaster (CrimeNo, CaseNo, CrimeRegisteredDate, PolicePersonID, PoliceStationID,
                                    CrimeMinorHeadID, CaseStatusID, IncidentFromDate, BriefFacts, confidence_flag)
            VALUES (?, ?, date('now'), ?, 1, ?, 1, ?, ?, 'ai_extracted')
        """, (
            case_data.get('CrimeNo'),
            case_no,
            session['officer_id'],
            crime_sub_head_id,
            case_data.get('IncidentFromDate'),
            case_data.get('BriefFacts') or case_data.get('description'),
        ))
        case_master_id = cur_case.lastrowid

        # Insert Accused
        cur_acc = db.execute("""
            INSERT INTO Accused (CaseMasterID, AccusedName, AgeYear, GenderID, PersonID, aliases, description,
                                 last_known_location, status, confidence_flag)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_extracted')
        """, (
            case_master_id,
            accused_data.get('AccusedName') or 'Unknown',
            accused_data.get('AgeYear') or 30,
            accused_data.get('GenderID', 1),
            accused_data.get('PersonID', 'A1'),
            accused_data.get('aliases'),
            accused_data.get('description'),
            accused_data.get('last_known_location'),
            accused_data.get('status', 'wanted'),
        ))
        accused_id = cur_acc.lastrowid

        # Insert Victim
        if victim_data and victim_data.get('VictimName'):
            db.execute("""
                INSERT INTO Victim (CaseMasterID, VictimName, AgeYear, GenderID)
                VALUES (?, ?, ?, ?)
            """, (
                case_master_id,
                victim_data.get('VictimName'),
                victim_data.get('AgeYear', 35),
                victim_data.get('GenderID', 1),
            ))

        # Insert ComplainantDetails
        if complainant_data and complainant_data.get('ComplainantName'):
            db.execute("""
                INSERT INTO ComplainantDetails (CaseMasterID, ComplainantName, AgeYear, GenderID)
                VALUES (?, ?, ?, ?)
            """, (
                case_master_id,
                complainant_data.get('ComplainantName'),
                complainant_data.get('AgeYear', 40),
                complainant_data.get('GenderID', 1),
            ))

        db.commit()
    except Exception as e:
        db.rollback()
        return jsonify({'error': f'Database insert failed: {e}'}), 500

    return jsonify({
        'message':         'Profile saved successfully with confidence_flag = ai_extracted',
        'accused_id':      accused_id,
        'case_master_id':  case_master_id,
    }), 201


# ── Similar-case scoring ──────────────────────────────────────────────────────
_CRIME_KEYWORDS = {
    'burglary':        {'break', 'enter', 'window', 'door', 'safe', 'jewelry', 'night', 'rear', 'cash', 'watchman'},
    'theft':           {'steal', 'pickpocket', 'purse', 'wallet', 'mobile', 'chain', 'market', 'crowd', 'snatch'},
    'vehicle theft':   {'car', 'bike', 'motorcycle', 'vehicle', 'parking', 'lock', 'tamper', 'duplicate', 'key'},
    'fraud':           {'fake', 'impersonate', 'scheme', 'investment', 'cheat', 'bribe', 'forged', 'document', 'sebi'},
    'assault':         {'attack', 'beat', 'weapon', 'fight', 'bar', 'brawl', 'grievous', 'hurt', 'blunt'},
    'kidnapping':      {'abduct', 'kidnap', 'child', 'minor', 'ransom', 'missing', 'school', 'relative'},
    'drug trafficking':{'ganja', 'heroin', 'narcotics', 'drug', 'peddling', 'substance', 'ndps'},
}


def _tokenize(text: str) -> set:
    if not text:
        return set()
    return set(re.findall(r'\b[a-zA-Z\u0C00-\u0C7F\u0C80-\u0CFF]{3,}\b', text.lower()))


def _compute_similar_cases(case_id: int, db) -> list:
    target = row_to_dict(db.execute("""
        SELECT cm.*, csh.CrimeHeadName, u.UnitName
        FROM CaseMaster cm
        LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
        LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
        WHERE cm.CaseMasterID = ?
    """, (case_id,)).fetchone())

    if not target:
        return []

    all_cases = rows_to_list(db.execute("""
        SELECT cm.*, csh.CrimeHeadName, u.UnitName, csm.CaseStatusName
        FROM CaseMaster cm
        LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
        LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
        LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
        WHERE cm.CaseMasterID != ?
    """, (case_id,)).fetchall())

    target_crime = (target.get('CrimeHeadName') or '').lower()
    target_loc   = _tokenize(target.get('UnitName', ''))
    target_desc  = _tokenize(target.get('BriefFacts', ''))
    crime_kws    = _CRIME_KEYWORDS.get(target_crime, set())

    target_date = None
    try:
        target_date = datetime.strptime(target['IncidentFromDate'], '%Y-%m-%d') if target.get('IncidentFromDate') else None
    except ValueError:
        pass

    scored = []
    for case in all_cases:
        score = 0.0
        why   = []

        if (case.get('CrimeHeadName') or '').lower() == target_crime and target_crime:
            score += 0.4
            why.append(f"Same crime type ({target_crime.title()})")

        case_loc = _tokenize(case.get('UnitName', ''))
        overlap  = target_loc & case_loc
        if overlap:
            ratio   = len(overlap) / max(len(target_loc | case_loc), 1)
            loc_pts = round(min(ratio * 3, 1.0) * 0.3, 3)
            if loc_pts >= 0.05:
                score += loc_pts
                why.append(f"Location overlap: {', '.join(sorted(overlap)[:3])}")

        if target_date and case.get('IncidentFromDate'):
            try:
                delta = abs((target_date - datetime.strptime(case['IncidentFromDate'], '%Y-%m-%d')).days)
                if delta <= 30:
                    score += 0.2
                    why.append(f"Within 30 days ({delta}d apart)")
                elif delta <= 90:
                    score += 0.1
                    why.append(f"Within 90 days ({delta}d apart)")
            except ValueError:
                pass

        case_desc  = _tokenize(case.get('BriefFacts', ''))
        desc_match = target_desc & case_desc
        kw_match   = desc_match & crime_kws if crime_kws else set()
        if len(kw_match) >= 2:
            score += 0.1
            why.append(f"Similar MO keywords: {', '.join(sorted(kw_match)[:4])}")
        elif len(desc_match) >= 5:
            score += 0.05
            why.append(f"Overlapping description terms ({len(desc_match)} common)")

        if score > 0:
            scored.append({
                **case,
                'id':              case['CaseMasterID'],
                'case_number':     case['CaseNo'],
                'crime_type':      case.get('CrimeHeadName'),
                'location':        case.get('UnitName'),
                'date':            case.get('IncidentFromDate'),
                'status':          case.get('CaseStatusName'),
                'match_score':     round(score, 3),
                'why':             '; '.join(why) if why else 'Weak similarity signal',
            })

    scored.sort(key=lambda x: x['match_score'], reverse=True)
    return scored[:5]


@app.route('/api/similar-cases/<int:case_id>', methods=['GET'])
@login_required
def similar_cases(case_id):
    db = get_db()
    if not row_to_dict(db.execute("SELECT CaseMasterID FROM CaseMaster WHERE CaseMasterID = ?", (case_id,)).fetchone()):
        return jsonify({'error': 'Case not found'}), 404

    results = _compute_similar_cases(case_id, db)
    return jsonify({'similar_cases': results, 'target_case_id': case_id})


# ── Investigative suggestions ─────────────────────────────────────────────────
@app.route('/api/suggest-next-steps/<int:case_id>', methods=['GET'])
@login_required
def suggest_next_steps(case_id):
    db = get_db()
    current = row_to_dict(db.execute("""
        SELECT cm.*, csh.CrimeHeadName, u.UnitName, csm.CaseStatusName
        FROM CaseMaster cm
        LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
        LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
        LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
        WHERE cm.CaseMasterID = ?
    """, (case_id,)).fetchone())
    if not current:
        return jsonify({'error': 'Case not found'}), 404

    if not GEMINI_API_KEY:
        return jsonify({'error': 'Gemini API key not configured — set GEMINI_API_KEY'}), 503

    similar = _compute_similar_cases(case_id, db)
    solved  = [s for s in similar if s.get('status') == 'Solved' and s.get('resolution_notes')]

    if not solved:
        return jsonify({
            'suggestions': (
                'No similar solved cases found in the database yet.\n\n'
                'Standard procedure:\n'
                '1. Record witness statements within 24 hours.\n'
                '2. Secure all available CCTV footage from the area.\n'
                '3. File a detailed First Information Report.\n'
                '4. Identify and canvas the immediate neighbourhood.\n'
                '5. Coordinate with local informants for any leads.'
            ),
            'based_on_cases': [],
        })

    case_ids = [s['id'] for s in solved[:3]]
    ph       = ','.join('?' * len(case_ids))
    resolved = rows_to_list(db.execute(
        f"SELECT cm.CaseNo, csh.CrimeHeadName, u.UnitName, cm.BriefFacts, cm.resolution_notes "
        f"FROM CaseMaster cm "
        f"LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID "
        f"LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID "
        f"WHERE cm.CaseMasterID IN ({ph})",
        case_ids,
    ).fetchall())

    current_str  = json.dumps({k: v for k, v in current.items() if k not in ('CaseMasterID', 'created_at')}, ensure_ascii=False)
    resolved_str = json.dumps(resolved, ensure_ascii=False, indent=2)

    try:
        prompt   = _NEXT_STEPS_PROMPT.format(current_case=current_str, resolved_cases=resolved_str)
        response = _call_gemini(prompt)
        suggestions = response.text.strip()
    except Exception as e:
        return jsonify({'error': f'AI suggestion failed: {e}'}), 500

    return jsonify({'suggestions': suggestions, 'based_on_cases': case_ids})


# ── Cases CRUD ────────────────────────────────────────────────────────────────
@app.route('/api/cases', methods=['GET'])
@login_required
def list_cases():
    db    = get_db()
    page  = max(int(request.args.get('page', 1)), 1)
    limit = min(int(request.args.get('per_page', 20)), 100)

    filters, params = [], []
    if request.args.get('status'):
        filters.append("LOWER(csm.CaseStatusName) = LOWER(?)")
        params.append(request.args['status'])
    if request.args.get('crime_type'):
        filters.append("LOWER(csh.CrimeHeadName) = LOWER(?)")
        params.append(request.args['crime_type'])

    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    query = f"""
        SELECT cm.CaseMasterID AS id, cm.CaseNo AS case_number, cm.CrimeNo,
               csh.CrimeHeadName AS crime_type, u.UnitName AS location,
               cm.IncidentFromDate AS date, cm.BriefFacts AS description,
               csm.CaseStatusName AS status, cm.resolution_notes, cm.confidence_flag,
               a.AccusedName AS criminal_name, a.status AS criminal_status,
               v.VictimName, cd.ComplainantName
        FROM CaseMaster cm
        LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
        LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
        LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
        LEFT JOIN Accused a ON cm.CaseMasterID = a.CaseMasterID
        LEFT JOIN Victim v ON cm.CaseMasterID = v.CaseMasterID
        LEFT JOIN ComplainantDetails cd ON cm.CaseMasterID = cd.CaseMasterID
        {where}
        ORDER BY cm.created_at DESC
        LIMIT ? OFFSET ?
    """
    params += [limit, (page - 1) * limit]

    cases = rows_to_list(db.execute(query, params).fetchall())
    total = db.execute(f"SELECT COUNT(*) FROM CaseMaster cm LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID {where}", params[:-2]).fetchone()[0]

    return jsonify({'cases': cases, 'total': total, 'page': page, 'per_page': limit})


@app.route('/api/cases/<int:case_id>', methods=['GET'])
@login_required
def get_case(case_id):
    db = get_db()
    case = row_to_dict(db.execute("""
        SELECT cm.CaseMasterID AS id, cm.CaseNo AS case_number, cm.CrimeNo,
               csh.CrimeHeadName AS crime_type, u.UnitName AS location,
               cm.IncidentFromDate AS date, cm.BriefFacts AS description,
               csm.CaseStatusName AS status, cm.resolution_notes, cm.confidence_flag,
               e.FirstName AS lead_officer_name, e.KGID AS lead_officer_badge
        FROM CaseMaster cm
        LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
        LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
        LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
        LEFT JOIN Employee e ON cm.PolicePersonID = e.EmployeeID
        WHERE cm.CaseMasterID = ?
    """, (case_id,)).fetchone())

    if not case:
        return jsonify({'error': 'Case not found'}), 404

    case['accused'] = rows_to_list(db.execute("""
        SELECT AccusedMasterID AS id, AccusedName AS name, aliases, description,
               last_known_location, status, confidence_flag
        FROM Accused WHERE CaseMasterID = ?
    """, (case_id,)).fetchall())

    case['victims'] = rows_to_list(db.execute("""
        SELECT VictimMasterID AS id, VictimName AS name, AgeYear, GenderID, VictimPolice
        FROM Victim WHERE CaseMasterID = ?
    """, (case_id,)).fetchall())

    case['complainants'] = rows_to_list(db.execute("""
        SELECT ComplainantID AS id, ComplainantName AS name, AgeYear, GenderID
        FROM ComplainantDetails WHERE CaseMasterID = ?
    """, (case_id,)).fetchall())

    return jsonify(case)


@app.route('/api/cases/<int:case_id>', methods=['PUT'])
@login_required
def update_case(case_id):
    data = request.get_json(force=True) or {}
    db   = get_db()

    new_status = data.get('status')
    resolution_notes = data.get('resolution_notes')
    description = data.get('description')

    if new_status:
        st_row = db.execute("SELECT CaseStatusID FROM CaseStatusMaster WHERE LOWER(CaseStatusName) = LOWER(?)", (new_status,)).fetchone()
        if st_row:
            db.execute("UPDATE CaseMaster SET CaseStatusID = ? WHERE CaseMasterID = ?", (st_row[0], case_id))

    if resolution_notes:
        db.execute("UPDATE CaseMaster SET resolution_notes = ? WHERE CaseMasterID = ?", (resolution_notes, case_id))

    if description:
        db.execute("UPDATE CaseMaster SET BriefFacts = ? WHERE CaseMasterID = ?", (description, case_id))

    if new_status and new_status.lower() in ('solved', 'closed'):
        db.execute("""
            UPDATE Employee SET cases_solved_count = cases_solved_count + 1
            WHERE EmployeeID IN (SELECT PolicePersonID FROM CaseMaster WHERE CaseMasterID = ?)
        """, (case_id,))

    db.commit()
    return jsonify({'message': 'Case updated successfully'})


# ── Criminals CRUD (Accused) ─────────────────────────────────────────────────
@app.route('/api/criminals', methods=['GET'])
@login_required
def list_criminals():
    db = get_db()
    filters, params = [], []
    if request.args.get('status'):
        filters.append("a.status = ?"); params.append(request.args['status'])
    if request.args.get('crime_type'):
        filters.append("LOWER(csh.CrimeHeadName) = LOWER(?)"); params.append(request.args['crime_type'])

    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    query = f"""
        SELECT a.AccusedMasterID AS id, a.AccusedName AS name, a.aliases,
               csh.CrimeHeadName AS crime_type, a.description, a.last_known_location,
               a.status, a.confidence_flag, a.created_at, cm.CaseNo AS case_number
        FROM Accused a
        LEFT JOIN CaseMaster cm ON a.CaseMasterID = cm.CaseMasterID
        LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
        {where}
        ORDER BY a.created_at DESC
        LIMIT 100
    """
    criminals = rows_to_list(db.execute(query, params).fetchall())
    return jsonify({'criminals': criminals})


@app.route('/api/criminals/<int:criminal_id>', methods=['GET'])
@login_required
def get_criminal(criminal_id):
    db = get_db()
    criminal = row_to_dict(db.execute("""
        SELECT a.AccusedMasterID AS id, a.AccusedName AS name, a.aliases,
               a.description, a.last_known_location, a.status, a.confidence_flag,
               a.AgeYear, a.GenderID, a.PersonID
        FROM Accused a WHERE a.AccusedMasterID = ?
    """, (criminal_id,)).fetchone())

    if not criminal:
        return jsonify({'error': 'Accused criminal not found'}), 404

    criminal['cases'] = rows_to_list(db.execute("""
        SELECT cm.CaseMasterID AS id, cm.CaseNo AS case_number, csh.CrimeHeadName AS crime_type,
               u.UnitName AS location, cm.IncidentFromDate AS date, csm.CaseStatusName AS status
        FROM Accused a
        JOIN CaseMaster cm ON a.CaseMasterID = cm.CaseMasterID
        LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
        LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
        LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
        WHERE a.AccusedMasterID = ?
    """, (criminal_id,)).fetchall())

    return jsonify(criminal)


@app.route('/api/criminals', methods=['POST'])
@login_required
def add_criminal():
    data = request.get_json(force=True) or {}
    db   = get_db()

    case_id = data.get('case_id') or 1
    cur  = db.execute("""
        INSERT INTO Accused (CaseMasterID, AccusedName, AgeYear, GenderID, PersonID, aliases, description,
                             last_known_location, status, confidence_flag)
        VALUES (?, ?, ?, ?, 'A1', ?, ?, ?, ?, 'verified')
    """, (
        case_id,
        data.get('name') or 'Unknown',
        data.get('age', 30),
        data.get('gender_id', 1),
        data.get('aliases'),
        data.get('description'),
        data.get('last_known_location'),
        data.get('status', 'wanted'),
    ))
    db.commit()
    return jsonify({'id': cur.lastrowid, 'message': 'Accused criminal profile created'}), 201


# ── Stats & Collaboration ───────────────────────────────────────────────────
@app.route('/api/stats', methods=['GET'])
@login_required
def get_stats():
    db = get_db()

    crime_dist = rows_to_list(db.execute("""
        SELECT csh.CrimeHeadName AS crime_type, COUNT(*) AS count
        FROM CaseMaster cm
        JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
        GROUP BY csh.CrimeHeadName ORDER BY count DESC
    """).fetchall())

    status_dist = rows_to_list(db.execute("""
        SELECT csm.CaseStatusName AS status, COUNT(*) AS count
        FROM CaseMaster cm
        JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
        GROUP BY csm.CaseStatusName
    """).fetchall())

    station_stats = rows_to_list(db.execute("""
        SELECT u.UnitName AS station,
               COUNT(cm.CaseMasterID) AS total_cases,
               SUM(CASE WHEN csm.CaseStatusName = 'Solved' THEN 1 ELSE 0 END) AS solved
        FROM Unit u
        LEFT JOIN CaseMaster cm ON u.UnitID = cm.PoliceStationID
        LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
        GROUP BY u.UnitName
    """).fetchall())

    monthly = rows_to_list(db.execute("""
        SELECT substr(IncidentFromDate,1,7) AS month, COUNT(*) AS count
        FROM CaseMaster WHERE IncidentFromDate IS NOT NULL
        GROUP BY month ORDER BY month
    """).fetchall())

    return jsonify({
        'crime_distribution': crime_dist,
        'status_distribution': status_dist,
        'station_stats':       station_stats,
        'monthly_cases':       monthly,
    })


@app.route('/api/similar-solvers/<int:case_id>', methods=['GET'])
@login_required
def similar_solvers(case_id):
    db   = get_db()
    case = row_to_dict(db.execute("""
        SELECT cm.CrimeMinorHeadID, csh.CrimeHeadName
        FROM CaseMaster cm
        LEFT JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
        WHERE cm.CaseMasterID = ?
    """, (case_id,)).fetchone())

    if not case:
        return jsonify({'error': 'Case not found'}), 404

    officers = rows_to_list(db.execute("""
        SELECT DISTINCT e.EmployeeID AS id, e.FirstName AS name, e.KGID AS badge_number,
               u.UnitName AS station, e.cases_solved_count, 'lead' AS role,
               cm.CaseNo AS case_number, csh.CrimeHeadName AS crime_type, u.UnitName AS location
        FROM Employee e
        JOIN Unit u ON e.UnitID = u.UnitID
        JOIN CaseMaster cm ON e.EmployeeID = cm.PolicePersonID
        JOIN CrimeSubHead csh ON cm.CrimeMinorHeadID = csh.CrimeSubHeadID
        JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
        WHERE cm.CrimeMinorHeadID = ? AND csm.CaseStatusName = 'Solved' AND e.EmployeeID != ?
        ORDER BY e.cases_solved_count DESC
        LIMIT 5
    """, (case['CrimeMinorHeadID'], session['officer_id'])).fetchall())

    return jsonify({'officers': officers})


@app.route('/api/request-help', methods=['POST'])
@login_required
def request_help():
    data = request.get_json(force=True) or {}
    print(
        f"[HELP REQUEST] Officer {session['officer_id']} ({session['officer_name']}) "
        f"→ Officer {data.get('officer_id')} on Case {data.get('case_id')}: "
        f"{data.get('message', 'Requesting assistance')}"
    )
    return jsonify({'message': 'Help request logged. The officer will be notified at the next shift briefing.'})


# ── Serve frontend & health ───────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/health')
@app.route('/api/health')
def health():
    return jsonify({'status': 'healthy', 'service': 'ksp-crime-api'}), 200


# ── Startup ───────────────────────────────────────────────────────────────────
with app.app_context():
    try:
        init_db()
    except Exception as _e:
        print(f"DB initialization warning: {_e}")


# ── Entry point (Zoho Catalyst AppSail compatible) ────────────────────────────
if __name__ == '__main__':
    port_str = os.getenv('X_ZOHO_CATALYST_LISTEN_PORT') or os.getenv('LISTEN_PORT') or os.getenv('PORT') or '9000'
    listen_port = int(port_str)
    try:
        from waitress import serve
        print(f"[APPSAIL STARTUP] Serving Waitress WSGI on 0.0.0.0:{listen_port}...")
        serve(app, host='0.0.0.0', port=listen_port)
    except Exception as _err:
        print(f"[APPSAIL WARN] Waitress fallback to Flask dev server: {_err}")
        app.run(host='0.0.0.0', port=listen_port)
