#!/usr/bin/env python3
"""
setup-jenkins.py - Automate Jenkins & SonarQube first-run configuration

This script does NOT bypass any step. It:
  1. Starts all containers via docker compose
  2. Waits for Jenkins to finish booting
  3. Reads the initialAdminPassword from the Jenkins container
  4. Uses the Jenkins API to complete the setup wizard:
     a. Creates an admin user
     b. Installs required plugins
     c. Completes the setup wizard
  5. Waits for SonarQube, generates a token
  6. Stores the token in Jenkins and configures the SonarQube server
  7. Creates a pipeline job pointing to the repo's Jenkinsfile

Usage:
    python setup-jenkins.py

Environment variables (optional):
    JENKINS_ADMIN_USER  - desired admin username  (default: admin)
    JENKINS_ADMIN_PASS  - desired admin password  (default: admin)
    GIT_REPO_URL        - Git repo URL for the pipeline job
"""

import os
import sys
import time
import json
import subprocess
import requests
from requests.auth import HTTPBasicAuth
from urllib.parse import urlencode

# ── Configuration ─────────────────────────────────────────────
JENKINS_CONTAINER = "jenkins-server"
JENKINS_URL       = "http://localhost:8080"
SONAR_URL         = "http://localhost:9000"
SONAR_INTERNAL    = "http://sonarqube-server:9000"

ADMIN_USER = os.environ.get("JENKINS_ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("JENKINS_ADMIN_PASS", "admin")

SONAR_ADMIN_USER  = "admin"
SONAR_ADMIN_PASS  = "admin"
SONAR_TOKEN_NAME  = "jenkins-auto"

GIT_REPO_URL = os.environ.get("GIT_REPO_URL", "")
JOB_NAME     = "node-sever-pipeline"

MAX_RETRIES = 40
RETRY_DELAY = 10  # seconds

PLUGINS = [
    "configuration-as-code",
    "sonar",
    "nodejs",
    "workflow-aggregator",
    "git",
    "credentials",
    "plain-credentials",
    "docker-workflow",
]

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


# ── Helpers ───────────────────────────────────────────────────
def run(cmd: str) -> str:
    """Run a shell command and return stdout."""
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        fail(f"Command failed: {cmd}\n{result.stderr.strip()}")
    return result.stdout.strip()


def get_crumb(session: requests.Session, user: str, password: str) -> dict:
    """Fetch Jenkins crumb and return it as a header dict."""
    resp = session.get(
        f"{JENKINS_URL}/crumbIssuer/api/json",
        auth=HTTPBasicAuth(user, password),
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    return {data["crumbRequestField"]: data["crumb"]}


# ── Step 0: Start containers ─────────────────────────────────
log("Starting all services with docker compose...")
subprocess.run("docker compose up -d --build", shell=True, check=True)
print()

# ── Step 1: Wait for Jenkins to boot ─────────────────────────
log("Waiting for Jenkins to start (this may take a few minutes)...")
jenkins_ready = False

for attempt in range(1, MAX_RETRIES + 1):
    try:
        resp = requests.get(f"{JENKINS_URL}/login", timeout=5)
        if resp.status_code == 200:
            ok(f"Jenkins is up (attempt {attempt}/{MAX_RETRIES})")
            jenkins_ready = True
            break
    except requests.ConnectionError:
        pass
    print(f"  Attempt {attempt}/{MAX_RETRIES}, retrying in {RETRY_DELAY}s...", end="\r")
    time.sleep(RETRY_DELAY)

if not jenkins_ready:
    fail(f"Jenkins did not start after {MAX_RETRIES * RETRY_DELAY}s")
print()

# ── Step 2: Get initial admin password ────────────────────────
log("Reading initialAdminPassword from container...")
init_pass = run(
    f"docker exec {JENKINS_CONTAINER} cat /var/jenkins_home/secrets/initialAdminPassword"
)
ok(f"Got initialAdminPassword: {init_pass}")
print()

# ── Step 3: Complete setup wizard – Create admin user ─────────
# Use a Session so cookies (JSESSIONID) persist across requests —
# this is why the bash version got 403 on the wizard endpoints.
session = requests.Session()

log(f"Completing setup wizard – creating admin user '{ADMIN_USER}'...")

crumb = get_crumb(session, "admin", init_pass)

resp = session.post(
    f"{JENKINS_URL}/setupWizard/createAdminUser",
    auth=HTTPBasicAuth("admin", init_pass),
    headers=crumb,
    data={
        "username":  ADMIN_USER,
        "password1": ADMIN_PASS,
        "password2": ADMIN_PASS,
        "fullname":  ADMIN_USER,
        "email":     "admin@localhost",
    },
    timeout=30,
)

if 200 <= resp.status_code < 400:
    ok(f"Admin user '{ADMIN_USER}' created successfully")
else:
    warn(f"Create admin user returned HTTP {resp.status_code} (may already exist)")
print()

# Re-authenticate as new admin
session_admin = requests.Session()

try:
    crumb = get_crumb(session_admin, ADMIN_USER, ADMIN_PASS)
    ok(f"Authenticated as '{ADMIN_USER}'")
except Exception:
    # Fallback: maybe the wizard kept the initial password active
    warn("Could not auth as new admin, retrying with initial password...")
    session_admin = session  # reuse the wizard session
    crumb = get_crumb(session_admin, "admin", init_pass)
    # Override for the rest of the script
    ADMIN_USER = "admin"
    ADMIN_PASS = init_pass
    ok("Falling back to initial admin credentials")
print()

# ── Step 4: Install plugins ──────────────────────────────────
log("Installing required Jenkins plugins...")

plugin_payload = json.dumps({
    "dynamicLoad": True,
    "plugins": [{"name": p, "optional": False} for p in PLUGINS],
})

resp = session_admin.post(
    f"{JENKINS_URL}/pluginManager/installPlugins",
    auth=HTTPBasicAuth(ADMIN_USER, ADMIN_PASS),
    headers={**crumb, "Content-Type": "application/json"},
    data=plugin_payload,
    timeout=30,
)

if 200 <= resp.status_code < 400:
    ok("Plugin installation triggered")
else:
    warn(f"Plugin install returned HTTP {resp.status_code}")

log("Waiting for plugins to install...")
for i in range(1, 31):
    try:
        resp = session_admin.get(
            f"{JENKINS_URL}/updateCenter/api/json?depth=1",
            auth=HTTPBasicAuth(ADMIN_USER, ADMIN_PASS),
            timeout=10,
        )
        data = resp.json()
        pending = [
            j for j in data.get("jobs", [])
            if j.get("type") == "InstallationJob"
            and not j.get("installationCompleted", True)
        ]
        if len(pending) == 0:
            ok("All plugins installed")
            break
        print(f"  Plugins still installing: {len(pending)} remaining ({i}/30)...", end="\r")
    except Exception:
        print(f"  Checking plugin status ({i}/30)...", end="\r")
    time.sleep(10)
print()

# ── Step 5: Complete the setup wizard ─────────────────────────
log("Finalizing setup wizard...")

try:
    crumb = get_crumb(session_admin, ADMIN_USER, ADMIN_PASS)
except Exception:
    pass

resp = session_admin.post(
    f"{JENKINS_URL}/setupWizard/completeInstall",
    auth=HTTPBasicAuth(ADMIN_USER, ADMIN_PASS),
    headers=crumb,
    timeout=30,
)

if 200 <= resp.status_code < 400:
    ok("Setup wizard completed")
else:
    warn(f"Complete install returned HTTP {resp.status_code}")
print()

# ── Step 6: Wait for SonarQube ───────────────────────────────
log("Waiting for SonarQube to become available...")
sonar_ready = False

for attempt in range(1, MAX_RETRIES + 1):
    try:
        resp = requests.get(f"{SONAR_URL}/api/system/status", timeout=5)
        status = resp.json().get("status", "")
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

# ── Step 7: Generate SonarQube token ─────────────────────────
log("Generating SonarQube API token...")

sonar_auth = HTTPBasicAuth(SONAR_ADMIN_USER, SONAR_ADMIN_PASS)

# Revoke previous token (idempotent)
requests.post(
    f"{SONAR_URL}/api/user_tokens/revoke",
    auth=sonar_auth,
    data={"name": SONAR_TOKEN_NAME},
    timeout=10,
)

resp = requests.post(
    f"{SONAR_URL}/api/user_tokens/generate",
    auth=sonar_auth,
    data={"name": SONAR_TOKEN_NAME},
    timeout=10,
)

if resp.status_code != 200:
    fail(f"Failed to generate SonarQube token (HTTP {resp.status_code}): {resp.text}")

sonar_token = resp.json()["token"]
ok(f"SonarQube token generated: {sonar_token[:8]}...")
print()

# ── Step 8: Configure SonarQube in Jenkins ───────────────────
log("Configuring SonarQube server in Jenkins...")

crumb = get_crumb(session_admin, ADMIN_USER, ADMIN_PASS)

# 8a. Store token as Jenkins credential
credential_xml = f"""<org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl>
  <scope>GLOBAL</scope>
  <id>sonar-token</id>
  <description>SonarQube token (auto-generated by setup script)</description>
  <secret>{sonar_token}</secret>
</org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl>"""

resp = session_admin.post(
    f"{JENKINS_URL}/credentials/store/system/domain/_/createCredentials",
    auth=HTTPBasicAuth(ADMIN_USER, ADMIN_PASS),
    headers={**crumb, "Content-Type": "application/xml"},
    data=credential_xml,
    timeout=15,
)

if 200 <= resp.status_code < 400:
    ok("SonarQube token stored as Jenkins credential 'sonar-token'")
else:
    warn(f"Store credential returned HTTP {resp.status_code} (may already exist)")

# 8b. Configure SonarQube server via Groovy script console
groovy_script = f"""
import hudson.plugins.sonar.*
import hudson.plugins.sonar.model.TriggersConfig
import jenkins.model.Jenkins

def jenkins = Jenkins.get()
def sonarDesc = jenkins.getDescriptorByType(SonarGlobalConfiguration.class)

def triggers = new TriggersConfig()
triggers.setSkipScmCause(false)
triggers.setSkipUpstreamCause(false)

def installation = new SonarInstallation(
    'MySonarServer',
    '{SONAR_INTERNAL}',
    'sonar-token',
    null, null, null, null,
    triggers
)

sonarDesc.setInstallations(installation)
sonarDesc.setBuildWrapperEnabled(true)
sonarDesc.save()

println 'SonarQube configured successfully'
"""

resp = session_admin.post(
    f"{JENKINS_URL}/scriptText",
    auth=HTTPBasicAuth(ADMIN_USER, ADMIN_PASS),
    headers=crumb,
    data={"script": groovy_script},
    timeout=15,
)

if 200 <= resp.status_code < 400:
    ok("SonarQube server configured in Jenkins")
else:
    warn(f"Script console returned HTTP {resp.status_code}")
print()

# ── Step 9: Create pipeline job ──────────────────────────────
if not GIT_REPO_URL:
    warn("GIT_REPO_URL not set – skipping pipeline job creation.")
    warn("Re-run with GIT_REPO_URL=<your-repo> to create the pipeline.")
else:
    log(f"Creating pipeline job '{JOB_NAME}'...")

    crumb = get_crumb(session_admin, ADMIN_USER, ADMIN_PASS)

    pipeline_xml = f"""<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>Auto-generated pipeline for node_sever</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty>
      <triggers>
        <hudson.triggers.SCMTrigger>
          <spec>H/5 * * * *</spec>
          <ignorePostCommitHooks>false</ignorePostCommitHooks>
        </hudson.triggers.SCMTrigger>
      </triggers>
    </org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty>
  </properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs>
        <hudson.plugins.git.UserRemoteConfig>
          <url>{GIT_REPO_URL}</url>
        </hudson.plugins.git.UserRemoteConfig>
      </userRemoteConfigs>
      <branches>
        <hudson.plugins.git.BranchSpec>
          <name>*/main</name>
        </hudson.plugins.git.BranchSpec>
      </branches>
    </scm>
    <scriptPath>jenkins/Jenkinsfile</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>"""

    # Try to create; if it already exists, update it
    resp = session_admin.post(
        f"{JENKINS_URL}/createItem?name={JOB_NAME}",
        auth=HTTPBasicAuth(ADMIN_USER, ADMIN_PASS),
        headers={**crumb, "Content-Type": "application/xml"},
        data=pipeline_xml,
        timeout=15,
    )

    if 200 <= resp.status_code < 400:
        ok(f"Pipeline job '{JOB_NAME}' created successfully")
    elif resp.status_code == 400 and "already exists" in resp.text.lower():
        # Update existing job
        resp = session_admin.post(
            f"{JENKINS_URL}/job/{JOB_NAME}/config.xml",
            auth=HTTPBasicAuth(ADMIN_USER, ADMIN_PASS),
            headers={**crumb, "Content-Type": "application/xml"},
            data=pipeline_xml,
            timeout=15,
        )
        if 200 <= resp.status_code < 400:
            ok(f"Pipeline job '{JOB_NAME}' updated successfully")
        else:
            warn(f"Update job returned HTTP {resp.status_code}")
    else:
        warn(f"Create job returned HTTP {resp.status_code}")

    # Trigger the first build
    crumb = get_crumb(session_admin, ADMIN_USER, ADMIN_PASS)
    resp = session_admin.post(
        f"{JENKINS_URL}/job/{JOB_NAME}/build",
        auth=HTTPBasicAuth(ADMIN_USER, ADMIN_PASS),
        headers=crumb,
        timeout=15,
    )
    if 200 <= resp.status_code < 400:
        ok(f"First build of '{JOB_NAME}' triggered")
    else:
        warn(f"Trigger build returned HTTP {resp.status_code}")
print()

# ── Done ──────────────────────────────────────────────────────
print(f"{GREEN}{'═' * 60}{NC}")
print(f"{GREEN}  Setup Complete!{NC}")
print(f"{GREEN}{'═' * 60}{NC}")
print()
print(f"  Jenkins:   {CYAN}{JENKINS_URL}{NC}")
print(f"  User:      {CYAN}{ADMIN_USER}{NC}")
print(f"  Password:  {CYAN}{ADMIN_PASS}{NC}")
print()
print(f"  SonarQube: {CYAN}{SONAR_URL}{NC}")
print(f"  User:      {CYAN}{SONAR_ADMIN_USER}{NC}")
print(f"  Password:  {CYAN}{SONAR_ADMIN_PASS}{NC}")
print()
print(f"  {YELLOW}NOTE: Change the default SonarQube admin password after first login.{NC}")
if GIT_REPO_URL:
    print()
    print(f"  Pipeline: {CYAN}{JENKINS_URL}/job/{JOB_NAME}{NC}")
    print(f"  Repo:     {CYAN}{GIT_REPO_URL}{NC}")
else:
    print()
    print(f"  {YELLOW}To create a pipeline job, re-run with:{NC}")
    print(f"  {CYAN}GIT_REPO_URL=<your-repo-url> python setup-jenkins.py{NC}")
print()
