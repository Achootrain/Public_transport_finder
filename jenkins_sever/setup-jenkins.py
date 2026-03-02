#!/usr/bin/env python3
"""
setup-jenkins.py - Generate a SonarQube token and inject it into Jenkins

This script is executed from inside the Jenkins container.
It does exactly two things:
  1. Waits for SonarQube to be healthy
  2. Generates a SonarQube API token and writes it to an env file
     so JCasC (jenkins.yaml) can pick it up via ${SONAR_TOKEN}

Requires:
    pip install python-sonarqube-api

Environment variables (optional):
    SONAR_URL          - SonarQube URL  (default: http://sonarqube-server:9000)
"""

import os
import sys
import time

from sonarqube import SonarQubeClient

# ── Configuration ─────────────────────────────────────────────
SONAR_URL      = os.environ.get("SONAR_URL", "http://sonarqube-server:9000")

SONAR_ADMIN_USER = "admin"
SONAR_ADMIN_PASS = "admin"
SONAR_TOKEN_NAME = "jenkins-auto"

MAX_RETRIES = 40
RETRY_DELAY = 10  # seconds

# ── Colors ────────────────────────────────────────────────────
RED    = "\033[0;31m"
GREEN  = "\033[0;32m"
YELLOW = "\033[1;33m"
CYAN   = "\033[0;36m"
NC     = "\033[0m"

def log(msg):  print(f"{CYAN}[INFO]{NC}  {msg}")
def warn(msg): print(f"{YELLOW}[WARN]{NC}  {msg}")
def ok(msg):   print(f"{GREEN}[OK]{NC}    {msg}")
def fail(msg):
    print(f"{RED}[FAIL]{NC}  {msg}")
    sys.exit(1)


# ── Step 1: Wait for SonarQube ────────────────────────────────
log("Waiting for SonarQube to become available...")
sonar_ready = False
sonar = None

for attempt in range(1, MAX_RETRIES + 1):
    try:
        sonar = SonarQubeClient(
            sonarqube_url=SONAR_URL,
            username=SONAR_ADMIN_USER,
            password=SONAR_ADMIN_PASS,
        )
        status = sonar.system.get_system_status().get("status", "")
        if status == "UP":
            ok(f"SonarQube is UP (attempt {attempt}/{MAX_RETRIES})")
            sonar_ready = True
            break
        print(f"  Attempt {attempt}/{MAX_RETRIES} (status: {status}), retrying in {RETRY_DELAY}s...", end="\r")
    except Exception:
        print(f"  Attempt {attempt}/{MAX_RETRIES} (unreachable), retrying in {RETRY_DELAY}s...", end="\r")
    time.sleep(RETRY_DELAY)

if not sonar_ready:
    fail(f"SonarQube did not start after {MAX_RETRIES * RETRY_DELAY}s")
print()

# ── Step 2: Generate SonarQube token ──────────────────────────
log("Generating SonarQube API token...")

# Revoke previous token (idempotent)
try:
    sonar.user_tokens.revoke_user_token(name=SONAR_TOKEN_NAME)
except Exception:
    pass  # token may not exist yet

try:
    result = sonar.user_tokens.generate_user_token(name=SONAR_TOKEN_NAME)
    sonar_token = result["token"]
    ok(f"SonarQube token generated: {sonar_token[:8]}...")
except Exception as e:
    fail(f"Failed to generate SonarQube token: {e}")
print()

# ── Step 3: Write token as JCasC secret file ─────────────────
SECRETS_DIR = "/var/jenkins_home/secrets"
TOKEN_FILE  = os.path.join(SECRETS_DIR, "SONAR_TOKEN")

log(f"Writing token to {TOKEN_FILE} (JCasC secrets dir)...")
try:
    os.makedirs(SECRETS_DIR, exist_ok=True)
    with open(TOKEN_FILE, "w") as f:
        f.write(sonar_token)
    ok(f"Token written to {TOKEN_FILE}")
except IOError as e:
    fail(f"Cannot write secret file: {e}")
print()

# ── Done ──────────────────────────────────────────────────────
print(f"{GREEN}{'═' * 60}{NC}")
print(f"{GREEN}  SonarQube Token Generated!{NC}")
print(f"{GREEN}{'═' * 60}{NC}")
print()
print(f"  SonarQube: {CYAN}{SONAR_URL}{NC}")
print(f"  Token:     {CYAN}{sonar_token[:8]}...{NC}")
print(f"  Secret:    {CYAN}{TOKEN_FILE}{NC}")
print(f"  {YELLOW}JCasC will resolve ${{SONAR_TOKEN}} from the secrets dir.{NC}")
print()
