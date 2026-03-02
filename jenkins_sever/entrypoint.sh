#!/usr/bin/env bash
set -euo pipefail

JENKINS_HOME_DIR="${JENKINS_HOME:-/var/jenkins_home}"
PLUGINS_TXT="/usr/share/jenkins/ref/plugins.txt"
PLUGINS_DIR="${JENKINS_HOME_DIR}/plugins"
SHA_MARKER="${JENKINS_HOME_DIR}/.plugins-sha"

if [[ -f "${PLUGINS_TXT}" ]]; then
  desired_sha="$(sha256sum "${PLUGINS_TXT}" | awk '{print $1}')"
  current_sha="$(cat "${SHA_MARKER}" 2>/dev/null || true)"

  if [[ "${desired_sha}" != "${current_sha}" ]]; then
    echo "[entrypoint] Installing/updating Jenkins plugins..."
    jenkins-plugin-cli --plugin-file "${PLUGINS_TXT}" --plugin-download-directory "${PLUGINS_DIR}" --verbose
    echo "${desired_sha}" > "${SHA_MARKER}"
    echo "[entrypoint] Plugins installed."
  else
    echo "[entrypoint] Plugins already installed (sha match)."
  fi
else
  echo "[entrypoint] No plugins.txt found at ${PLUGINS_TXT}; skipping plugin installation."
fi

exec /usr/bin/tini -- /usr/local/bin/jenkins.sh "$@"
