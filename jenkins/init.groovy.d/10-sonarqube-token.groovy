import com.cloudbees.plugins.credentials.CredentialsScope
import com.cloudbees.plugins.credentials.SystemCredentialsProvider
import com.cloudbees.plugins.credentials.common.IdCredentials
import com.cloudbees.plugins.credentials.domains.Domain
import org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl
import hudson.util.Secret

String credentialId = 'sonarqube-token'
String tokenValue = System.getenv('SONARQUBE_TOKEN')
String description = 'Auto-managed SonarQube token for pipeline scanning'

if (tokenValue == null || tokenValue.trim().isEmpty()) {
    println("[init.groovy.d] SONARQUBE_TOKEN is empty; skipping credential '${credentialId}' creation")
    return
}

def store = SystemCredentialsProvider.getInstance().getCredentials()
def existing = store.find { it instanceof IdCredentials && it.id == credentialId }

def newCredential = new StringCredentialsImpl(
    CredentialsScope.GLOBAL,
    credentialId,
    description,
    Secret.fromString(tokenValue.trim())
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
