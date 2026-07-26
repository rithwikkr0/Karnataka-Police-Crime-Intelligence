import sys
print("SERVER.PY STARTING", flush=True)

import os
from waitress import serve
from app import app

port = int(os.getenv('X_ZOHO_CATALYST_LISTEN_PORT', '9000'))
print(f"[APPSAIL STARTUP] Starting Waitress WSGI server on 0.0.0.0:{port}...", flush=True)
serve(app, host='0.0.0.0', port=port)
