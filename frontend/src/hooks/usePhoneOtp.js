// frontend/src/hooks/usePhoneOtp.js
// Sends and checks a mobile OTP the way the backend expects it:
//  - development (DEV_PHONE_OTP): the backend logs a code → proof { otp }
//  - production: Firebase sends the SMS (invisible reCAPTCHA) → proof { idToken }
// The page must render <div id="recaptcha-container" /> (PublicShell does).
import { useCallback, useEffect, useRef, useState } from "react";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { auth, DEV_PHONE_OTP } from "../utils/firebase";
import apiClient from "../api/axios";
import useCountdown from "./useCountdown";

export default function usePhoneOtp() {
  const verifierRef = useRef(null);
  const [confirmation, setConfirmation] = useState(null);
  const [sentTo, setSentTo] = useState(null);
  const { count: wait, start: startTimer } = useCountdown();

  const clear = useCallback(() => {
    if (verifierRef.current) {
      try { verifierRef.current.clear(); } catch { /* already gone */ }
      verifierRef.current = null;
    }
  }, []);
  useEffect(() => clear, [clear]);

  /** Sends a code to a 10-digit mobile number. Throws on failure. */
  const send = useCallback(async (phone) => {
    if (DEV_PHONE_OTP) {
      await apiClient.post("/public-auth/send-phone-otp", { phone });
    } else {
      clear();
      verifierRef.current = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
      try {
        setConfirmation(await signInWithPhoneNumber(auth, `+91${phone}`, verifierRef.current));
      } catch (err) {
        clear();
        throw err;
      }
    }
    setSentTo(phone);
    startTimer();
  }, [clear, startTimer]);

  /** Turns the typed code into what the API checks: { otp } or { idToken }. Throws if wrong. */
  const proof = useCallback(async (code) => {
    if (DEV_PHONE_OTP) return { otp: code };
    if (!confirmation) throw new Error("Request a new code first.");
    const result = await confirmation.confirm(code);
    return { idToken: await result.user.getIdToken() };
  }, [confirmation]);

  return { send, proof, sentTo, wait, devMode: DEV_PHONE_OTP };
}
