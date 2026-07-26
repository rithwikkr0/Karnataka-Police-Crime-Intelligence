# KSP Crime Intelligence System
### Intelligent Conversational AI for Karnataka State Police Crime Database
#### Datathon 2026

---

## Problem Statement

Karnataka State Police manages thousands of FIRs, criminal profiles, and case records spread across stations and districts. Officers lack a fast, intuitive way to:
1. Query this data in their own language (Kannada, Telugu, English)
2. Automatically ingest FIR documents into structured profiles
3. Connect new crimes with similar historical patterns
4. Get evidence-based investigative suggestions instantly

This system solves all four using a Gemini-powered AI backend with a single-page web interface.

---

## Key Features

| Feature | Details |
|---------|---------|
| **Multilingual Chat Query** | Natural language → SQL → answer in the same language (English / Kannada / Telugu) |
| **FIR Auto-Ingestion** | Paste FIR text or upload an image; Gemini extracts structured criminal + case profile |
| **OCR Support** | Tesseract OCR with `eng+kan+tel` language packs (graceful fallback if not installed) |
| **Similar Case Linking** | Transparent weighted scoring: crime type, location, date, MO keywords |
| **AI Investigative Suggestions** | Gemini synthesises patterns from solved similar cases |
| **Officer Collaboration** | View officers who solved similar crimes; send help requests |
| **Analytics Dashboard** | Crime distribution, open/solved ratio, station-wise, monthly volume (Chart.js) |

---

## Project Structure

```
/app.py             — Flask backend (all routes, DB, AI logic)
/templates/
  index.html        — Single-page frontend
/static/
  style.css         — Dark glassmorphism UI (KSP blue + gold)
  script.js         — Frontend JS (no build step)
/requirements.txt   — Pinned Python dependencies
/sample_data.sql    — Reference SQL for seed data
/README.md          — This file
/crime.db           — Auto-created SQLite database on first run
```

---

## Local Setup

### Prerequisites

- Python 3.10+
- pip
- (Optional) Tesseract OCR for image FIR upload:
  ```
  # Ubuntu / Debian
  sudo apt install tesseract-ocr tesseract-ocr-kan tesseract-ocr-tel

  # macOS
  brew install tesseract tesseract-lang

  # Windows — download installer from:
  # https://github.com/UB-Mannheim/tesseract/wiki
  ```
- (Optional) Poppler for PDF support:
  ```
  # Ubuntu
  sudo apt install poppler-utils
  # macOS
  brew install poppler
  # Windows — add Poppler bin/ to PATH
  ```
  > **Note**: Both are optional. The FIR text-paste path works without them.

### Installation

```bash
# 1. Clone / navigate to project folder
git clone https://github.com/rithwikkr0/Karnataka-Police-Crime-Intelligence.git
cd Karnataka-Police-Crime-Intelligence

# 2. Create virtual environment
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Set environment variables
# Windows PowerShell:
$env:GEMINI_API_KEY = "your-gemini-api-key-here"
$env:FLASK_SECRET_KEY = "choose-a-random-secret-key"

# macOS/Linux:
export GEMINI_API_KEY="your-gemini-api-key-here"
export FLASK_SECRET_KEY="choose-a-random-secret-key"

# 5. Run
python app.py
```

Open **http://localhost:9000** in your browser.

### Demo Credentials

| Badge Number | Password | Station |
|---|---|---|
| KSP001 | demo123 | Bengaluru Central |
| KSP002 | demo123 | Mysuru City |
| KSP003 | demo123 | Kolar District |

---

## Gemini API Key

Get a free API key from **https://aistudio.google.com/apikey**

The app will start without the key but AI features (chat, FIR extraction, suggestions) will return a `503` error. All CRUD and case-browsing features work without it.

---

## Deploying to Zoho Catalyst AppSail

1. **Create a new AppSail service** in the Zoho Catalyst console (Python runtime).

2. **Upload the project** files (or connect your Git repo).

3. **Set environment variables** in the AppSail configuration:
   - `GEMINI_API_KEY` — your Gemini API key
   - `FLASK_SECRET_KEY` — a long random string (e.g. `python -c "import secrets; print(secrets.token_hex(32))"`)

4. **Start command**: `python app.py`

5. AppSail injects `X_ZOHO_CATALYST_LISTEN_PORT`; `app.py` reads this automatically:
   ```python
   listen_port = int(os.getenv('X_ZOHO_CATALYST_LISTEN_PORT', 9000))
   app.run(host='0.0.0.0', port=listen_port)
   ```

6. The SQLite database (`crime.db`) is created and seeded on first startup in the app directory. For persistent storage across deployments, ensure the AppSail service has a persistent disk mounted at the project root.

> **Note**: Tesseract and Poppler system packages are not available on the managed Python runtime. The text-paste FIR path works without them.

---

## API Endpoint Reference

### Authentication

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/login` | `{badge_number, password}` | Login; sets session cookie |
| POST | `/api/logout` | — | Clear session |
| GET | `/api/officers/me` | — | Current officer + assigned cases |

### Chat Query

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/chat` | `{question: string}` | `{answer, sql_used, matched_rows}` |

### FIR Ingestion

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/upload-fir` | `FormData: file OR raw_text` | Dry-run extraction; returns profile for review |
| POST | `/api/upload-fir/confirm` | `{profile: {...}}` | Save reviewed profile to DB |

### Cases

| Method | Endpoint | Query Params | Description |
|--------|----------|------|-------------|
| GET | `/api/cases` | `status, crime_type, page, per_page` | List cases (paginated) |
| GET | `/api/cases/<id>` | — | Case detail + officers |
| PUT | `/api/cases/<id>` | — | Update case fields (status, resolution_notes, etc.) |

### Criminals

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/criminals` | List criminals (filter by status, crime_type) |
| GET | `/api/criminals/<id>` | Criminal detail + linked cases |
| POST | `/api/criminals` | Manually add criminal profile |

### AI Features

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/similar-cases/<id>` | Top-5 similar cases with match score + why |
| GET | `/api/suggest-next-steps/<id>` | Gemini-generated investigative steps |

### Phase 2

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Aggregated crime stats for dashboard |
| GET | `/api/similar-solvers/<case_id>` | Officers who solved similar cases |
| POST | `/api/request-help` | Log a help request `{officer_id, case_id, message}` |

---

## Security Notes

- Passwords stored as `werkzeug` PBKDF2-SHA256 hashes — never plaintext
- `FLASK_SECRET_KEY` controls session signing — always set from env var in production
- Chat SQL queries run on a **read-only** SQLite URI (`mode=ro`) — DDL/DML is impossible
- Multi-statement injection blocked by semicolon stripping + forbidden keyword regex
- `GEMINI_API_KEY` never hardcoded — always from environment variable

---

## Tech Stack

- **Backend**: Python 3.10+, Flask 3.0, SQLite
- **AI**: Google Gemini 1.5 Flash (`google-generativeai`)
- **OCR**: Tesseract + pytesseract + Pillow (optional)
- **Frontend**: Vanilla HTML/CSS/JS, Chart.js 4.4 (CDN)
- **Fonts**: Inter + JetBrains Mono (Google Fonts)
