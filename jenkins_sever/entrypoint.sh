#!/usr/bin/env bash
set -euo pipefail

JENKINS_HOME_DIR="${JENKINS_HOME:-/var/jenkins_home}"
PLUGINS_TXT="/usr/share/jenkins/ref/plugins.txt"
PLUGINS_DIR="${JENKINS_HOME_DIR}/plugins"
SHA_MARKER="${JENKINS_HOME_DIR}/.plugins-sha"

CASC_REF="/usr/share/jenkins/ref/casc_configs/jenkins.yaml"
CASC_DEST_DEFAULT="${JENKINS_HOME_DIR}/casc_configs/jenkins.yaml"
CASC_DEST="${CASC_JENKINS_CONFIG:-${CASC_DEST_DEFAULT}}"
CASC_SHA_MARKER="${JENKINS_HOME_DIR}/.casc-yaml-sha"

if [[ -f "${CASC_REF}" ]]; then
  mkdir -p "$(dirname "${CASC_DEST}")"
  desired_casc_sha="$(sha256sum "${CASC_REF}" | awk '{print $1}')"
  current_casc_sha="$(cat "${CASC_SHA_MARKER}" 2>/dev/null || true)"

  if [[ "${desired_casc_sha}" != "${current_casc_sha}" ]]; then
    echo "[entrypoint] Updating JCasC YAML at ${CASC_DEST}..."
    cp -f "${CASC_REF}" "${CASC_DEST}"
    echo "${desired_casc_sha}" > "${CASC_SHA_MARKER}"
    echo "[entrypoint] JCasC YAML updated."
  else
    echo "[entrypoint] JCasC YAML already up-to-date (sha match)."
  fi
else
  echo "[entrypoint] No JCasC YAML found at ${CASC_REF}; skipping JCasC sync."
fi

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
