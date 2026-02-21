/**
 * @module services/auth
 * @description Firebase Admin SDK singleton for server-side JWT
 * verification.
 *
 * ## Credential Resolution Order
 * 1. Explicit environment variables: `FIREBASE_PROJECT_ID`,
 *    `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
 * 2. Default Application Credentials
 *    (e.g. `GOOGLE_APPLICATION_CREDENTIALS` file path)
 *
 * @see module:middlewares/auth — Express middleware consumers
 */
const admin = require('firebase-admin');
const config = require('../config');

/**
 * Manages a single Firebase Admin App instance and provides
 * token verification.
 *
 * @class AuthService
 * @example
 * const authService = require('./services/auth.service');
 * authService.initialize();
 * const claims = await authService.verifyIdToken(idToken);
 * console.log(claims.uid);
 */
class AuthService {
    constructor() {
        /** @type {import('firebase-admin').app.App|null} Singleton Firebase app */
        this.app = null;
    }

    /**
     * Initialises the Firebase Admin SDK.
     *
     * Safe to call multiple times — subsequent calls are no-ops.
     * Logs the credential source used and any initialisation errors.
     *
     * @returns {void}
     */
    initialize() {
        if (this.app) return;

        try {
            // Attempt to initialize using explicit environment variables if provided
            if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
                console.log('[Auth] Initializing Firebase Admin with explicit credentials...');
                this.app = admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: process.env.FIREBASE_PROJECT_ID,
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                        // Fix multi-line private key formatting from env
                        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
                    })
                });
            } else {
                // Fallback to default credentials (e.g. GOOGLE_APPLICATION_CREDENTIALS)
                console.log('[Auth] Initializing Firebase Admin with default application credentials...');
                this.app = admin.initializeApp();
            }
            console.log('[Auth] Firebase Admin initialized successfully.');
        } catch (error) {
            console.error('[Auth] Failed to initialize Firebase Admin:', error.message);
        }
    }

    /**
     * Verifies a Firebase client-side ID token and returns the
     * decoded payload.
     *
     * @param {string} idToken - The raw JWT string from the client
     * @returns {Promise<import('firebase-admin').auth.DecodedIdToken>}
     *   Decoded token containing `uid`, `email`, `email_verified`,
     *   `iat`, `exp`, and any custom claims.
     * @throws {Error} If the Admin SDK has not been initialised
     * @throws {import('firebase-admin').FirebaseError}
     *   Codes: `auth/id-token-expired`, `auth/id-token-revoked`,
     *   `auth/argument-error`
     */
    async verifyIdToken(idToken) {
        if (!this.app) {
            throw new Error('Firebase Admin not initialized');
        }
        return await admin.auth().verifyIdToken(idToken);
    }
}

// Export as singleton
const authService = new AuthService();
module.exports = authService;
