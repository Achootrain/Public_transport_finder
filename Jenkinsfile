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
                        sh "${scannerHome}/bin/sonar-scanner"
                    }
                }
            }
        }

        stage('3. Build & Deploy (Docker Compose)') {
            steps {
                sh 'docker compose up -d --build'
                
                sh 'docker image prune -f'
            }
        }

        stage('4. Configure Nginx') {
            steps {
                script {
                    sh 'sudo cp nginx.conf /etc/nginx/sites-available/default'
                    
                    sh 'sudo nginx -t'
                    
                    sh 'sudo systemctl reload nginx'
                    
                    echo 'Nginx configuration updated successfully!'
                }
            }
        }
    }
    
    post {
        success {
            echo 'All stages completed successfully!'
        }
        failure {
            echo 'Pipeline failed. Please check the logs in the specific stage.'
        }
    }
}