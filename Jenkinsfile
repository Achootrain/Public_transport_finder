pipeline {
    agent any

    stages {
        stage('1. Pulling code from GitHub') {
            steps {
                checkout scm
            }
        }

        stage('2. Scanning (SonarQube)') {
            steps {
                script {
                    def scannerHome = tool 'SonarScanner'
                    withSonarQubeEnv('MySonarServer') { 
                        sh "${scannerHome}/bin/sonar-scanner \
                        -Dsonar.projectKey=transit-bus-js \
                        -Dsonar.sources=src \
                        -Dsonar.host.url=http://localhost:9000"
                    }
                }
            }
        }

        stage('3. Build & Deploy (Docker Compose)') {
            steps {
                sh 'docker-compose up -d --build'
                
                sh 'docker image prune -f'
            }
        }
    }
    
    post {
        success {
            echo 'Deploy successful!'
        }
        failure {
            echo '  Deploy failed. Please check the logs.'
        }
    }
}