import com.cloudbees.plugins.credentials.CredentialsScope
import com.cloudbees.plugins.credentials.SystemCredentialsProvider
import com.cloudbees.plugins.credentials.common.IdCredentials
import com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl

String credentialId = 'sonarqube-admin'
String adminUser = System.getenv('SONARQUBE_ADMIN_USER') ?: 'admin'
String adminPassword = System.getenv('SONARQUBE_DESIRED_ADMIN_PASSWORD') ?: System.getenv('SONARQUBE_ADMIN_PASSWORD')
String description = 'Auto-managed SonarQube admin credentials for token automation'

if (adminPassword == null || adminPassword.trim().isEmpty()) {
    println("[init.groovy.d] SONARQUBE_DESIRED_ADMIN_PASSWORD/SONARQUBE_ADMIN_PASSWORD is empty; skipping credential '${credentialId}' creation")
    return
}

def store = SystemCredentialsProvider.getInstance().getCredentials()
def existing = store.find { it instanceof IdCredentials && it.id == credentialId }

def newCredential = new UsernamePasswordCredentialsImpl(
    CredentialsScope.GLOBAL,
    credentialId,
    description,
    adminUser.trim(),
    adminPassword.trim()
)

def provider = SystemCredentialsProvider.getInstance()

if (existing != null) {
    provider.getCredentials().remove(existing)
    println("[init.groovy.d] Updated existing credential '${credentialId}'")
} else {
    println("[init.groovy.d] Creating credential '${credentialId}'")
}

provider.getCredentials().add(newCredential)
provider.save()
