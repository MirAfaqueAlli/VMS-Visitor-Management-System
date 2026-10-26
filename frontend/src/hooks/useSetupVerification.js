// frontend/src/hooks/useSetupVerification.js
// OTP checks of the super administrator's email and mobile during first-time setup.
//  - Email:  the API emails a 6-digit code; checking it returns a proof token.
//  - Mobile: Firebase sends and checks the SMS code; the API verifies Firebase's
//            idToken and returns a proof token.
// POST /setup needs both proof tokens.
import { useCallback, useEffect, useRef, useState } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber, signOut } from 'firebase/auth';
import apiClient from '../api/axios';
import { auth, DEV_PHONE_OTP } from '../utils/firebase';
import { getApiErrorMessage } from '../utils/apiError';
import useCountdown from './useCountdown';

// status: idle → sending → sent → verifying → verified ("idle" + error = sending failed)
// devNote: development only — the SMS code was printed in the backend log
const EMPTY = { target: '', status: 'idle', token: null, error: '', devCode: '', devNote: false };

const FIREBASE_ERRORS = {
  'auth/invalid-verification-code': 'Incorrect code. Please check the SMS and try again.',
  'auth/code-expired':              'This code has expired. Tap Resend for a new one.',
  'auth/too-many-requests':         'Too many attempts. Please wait a while and try again.',
  'auth/invalid-phone-number':      'This mobile number is not valid.',
  'auth/quota-exceeded':            'The SMS limit has been reached. Please try again later.',
  'auth/invalid-app-credential':    'The security check failed. Refresh the page and try again.',
};
const firebaseMessage = (err, fallback) => FIREBASE_ERRORS[err?.code] || getApiErrorMessage(err, fallback);

/** Removes the invisible reCAPTCHA widget (a fresh one is needed for every SMS). */
const clearVerifier = (ref) => {
  try { ref.current?.clear(); } catch { /* already cleared */ }
  ref.current = null;
};

export default function useSetupVerification() {
  const [email, setEmail] = useState(EMPTY);
  const [phone, setPhone] = useState(EMPTY);
  const { count: emailWait, start: startEmailWait } = useCountdown();
  const { count: phoneWait, start: startPhoneWait } = useCountdown();
  const verifierRef     = useRef(null);
  const confirmationRef = useRef(null);   // Firebase ConfirmationResult for the last SMS

  useEffect(() => () => clearVerifier(verifierRef), []);

  const sendEmail = useCallback(async (address) => {
    setEmail({ ...EMPTY, target: address, status: 'sending' });
    try {
      const res = await apiClient.post('/setup/send-email-otp', { email: address });
      setEmail({ ...EMPTY, target: address, status: 'sent', devCode: res.data?.data?.dev_otp || '' });
      startEmailWait();
    } catch (err) {
      // 429 = a code went out under a minute ago, and that code still works
      const recent = err?.response?.status === 429;
      setEmail({ ...EMPTY, target: address, status: recent ? 'sent' : 'idle', error: getApiErrorMessage(err, 'Could not send the email code.') });
      if (recent) startEmailWait();
    }
  }, [startEmailWait]);

  const sendPhone = useCallback(async (number) => {
    setPhone({ ...EMPTY, target: number, status: 'sending' });
    confirmationRef.current = null;
    clearVerifier(verifierRef);

    if (DEV_PHONE_OTP) {
      // Development: no Firebase / reCAPTCHA — the code is in the backend log
      try {
        await apiClient.post('/setup/send-phone-otp', { phone: number });
        setPhone({ ...EMPTY, target: number, status: 'sent', devNote: true });
        startPhoneWait();
      } catch (err) {
        const recent = err?.response?.status === 429;   // the earlier code still works
        setPhone({ ...EMPTY, target: number, status: recent ? 'sent' : 'idle', devNote: recent, error: getApiErrorMessage(err, 'Could not send the SMS code.') });
        if (recent) startPhoneWait();
      }
      return;
    }

    try {
      // #recaptcha-container lives in index.html, outside React
      verifierRef.current     = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      confirmationRef.current = await signInWithPhoneNumber(auth, `+91${number}`, verifierRef.current);
      setPhone({ ...EMPTY, target: number, status: 'sent' });
      startPhoneWait();
    } catch (err) {
      clearVerifier(verifierRef);
      setPhone({ ...EMPTY, target: number, error: firebaseMessage(err, 'Could not send the SMS code.') });
    }
  }, [startPhoneWait]);

  /**
   * Sends codes for the details that still need one. Details already verified,
   * or with a code on its way or waiting to be entered, are left alone, so
   * reopening the pop-up doesn't resend.
   */
  const start = (address, number) => {
    if (email.target !== address || email.status === 'idle') sendEmail(address);
    if (phone.target !== number  || phone.status === 'idle') sendPhone(number);
  };

  /** Sends a fresh code (also used when the API says a proof has expired). */
  const resend = (channel) => (channel === 'email' ? sendEmail(email.target) : sendPhone(phone.target));

  /** Checks the email code; returns the proof token, or null. */
  const verifyEmail = async (code) => {
    if (email.status !== 'sent') return null;
    setEmail((s) => ({ ...s, status: 'verifying', error: '' }));
    try {
      const res   = await apiClient.post('/setup/verify-email-otp', { email: email.target, otp: code });
      const token = res.data?.data?.email_token;
      setEmail((s) => ({ ...s, status: 'verified', token, devCode: '' }));
      return token;
    } catch (err) {
      setEmail((s) => ({ ...s, status: 'sent', error: getApiErrorMessage(err, 'Incorrect code. Please try again.') }));
      return null;
    }
  };

  /** Checks the SMS code with Firebase, then the API; returns the proof token, or null. */
  const verifyPhone = async (code) => {
    if (DEV_PHONE_OTP) {
      if (phone.status !== 'sent') return null;
      setPhone((s) => ({ ...s, status: 'verifying', error: '' }));
      try {
        const res   = await apiClient.post('/setup/verify-phone', { phone: phone.target, otp: code });
        const token = res.data?.data?.phone_token;
        setPhone((s) => ({ ...s, status: 'verified', token, devNote: false }));
        return token;
      } catch (err) {
        setPhone((s) => ({ ...s, status: 'sent', error: getApiErrorMessage(err, 'Incorrect code. Please try again.') }));
        return null;
      }
    }

    if (phone.status !== 'sent' || !confirmationRef.current) return null;
    setPhone((s) => ({ ...s, status: 'verifying', error: '' }));
    try {
      const credential = await confirmationRef.current.confirm(code);
      const idToken    = await credential.user.getIdToken();
      signOut(auth).catch(() => {});   // only the proof is needed, not a Firebase session
      const res   = await apiClient.post('/setup/verify-phone', { phone: phone.target, idToken });
      const token = res.data?.data?.phone_token;
      confirmationRef.current = null;
      setPhone((s) => ({ ...s, status: 'verified', token }));
      return token;
    } catch (err) {
      // A wrong code can be retried; once Firebase accepted the code it is used up,
      // so an API failure needs a new code
      setPhone((s) => ({
        ...s,
        status: err?.response ? 'idle' : 'sent',
        error:  firebaseMessage(err, 'Could not verify the mobile number.'),
      }));
      return null;
    }
  };

  return {
    email: { ...email, wait: emailWait },
    phone: { ...phone, wait: phoneWait },
    start, resend, verifyEmail, verifyPhone,
  };
}
