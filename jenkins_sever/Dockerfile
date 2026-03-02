FROM jenkins/jenkins:lts

# Skip the setup wizard – configuration is provided via JCasC.
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false"

USER root

# Minimal tooling needed by the pipeline and setup script.
# - docker CLI + compose plugin (talks to mounted /var/run/docker.sock)
# - python3 + pip for setup-jenkins.py
RUN apt-get update && \
        apt-get install -y --no-install-recommends \
            docker.io \
            docker-compose \
            python3 \
            python3-pip \
            ca-certificates \
            curl \
        && rm -rf /var/lib/apt/lists/*

# Install Python deps used by setup-jenkins.py
RUN pip3 install --break-system-packages python-sonarqube-api

# Runtime plugin installation entrypoint
COPY --chmod=0755 entrypoint.sh /usr/local/bin/entrypoint.sh

# Plugins are installed at container start (faster image build).
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt

# Setup script for SonarQube token generation
COPY setup-jenkins.py /opt/setup-jenkins/setup-jenkins.py

# JCasC configuration (tool installers, etc.)
# Put config under /usr/share/jenkins/ref so it gets copied into the
# persisted JENKINS_HOME volume on first boot.
COPY jenkins.yaml /usr/share/jenkins/ref/casc_configs/jenkins.yaml
ENV CASC_JENKINS_CONFIG=/var/jenkins_home/casc_configs/jenkins.yaml

USER jenkins

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
