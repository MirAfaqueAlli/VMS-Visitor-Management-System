// frontend/src/lib/recaptcha.js
// Firebase phone OTP needs an (invisible) reCAPTCHA. reCAPTCHA can be drawn into an
// element only once — even after verifier.clear() the element stays marked, and the
// next code request fails with "reCAPTCHA has already been rendered in this element".
// So every code request gets a brand-new element, removed again afterwards.
import { RecaptchaVerifier } from "firebase/auth";

/**
 * A reCAPTCHA verifier on a fresh element inside #recaptcha-container (index.html).
 * @returns {{ verifier: RecaptchaVerifier, dispose: () => void }}
 */
export function freshRecaptcha(auth) {
  const el = document.createElement("div");
  (document.getElementById("recaptcha-container") || document.body).appendChild(el);
  const verifier = new RecaptchaVerifier(auth, el, { size: "invisible" });
  const dispose = () => {
    try { verifier.clear(); } catch { /* already cleared */ }
    el.remove();
  };
  return { verifier, dispose };
}
