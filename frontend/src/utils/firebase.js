// frontend/src/utils/firebase.js
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

/**
 * Firebase app singleton.
 * Only initialised once even if this module is hot-reloaded during development.
 */
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

/**
 * In development (localhost), Chrome blocks reCAPTCHA iframe storage access,
 * which causes auth/invalid-app-credential even with valid credentials.
 *
 * Setting appVerificationDisabledForTesting = true tells Firebase to skip
 * reCAPTCHA entirely. This ONLY works for test phone numbers added in the
 * Firebase Console (Authentication → Sign-in method → Phone → Test numbers).
 *
 * This flag has NO effect in production (VITE_FIREBASE_TEST_MODE must be 'true').
 */
if (import.meta.env.VITE_FIREBASE_TEST_MODE === 'true') {
  auth.settings.appVerificationDisabledForTesting = true;
  console.info('[Firebase] appVerificationDisabledForTesting = true (dev/test mode)');
}

export { auth };
