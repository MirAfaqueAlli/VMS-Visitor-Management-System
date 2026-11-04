// frontend/src/lib/idProof.js
// Visitor ID proof — the same types and formats the server checks (backend/utils/idProof.util.js).

export const ID_PROOFS = [
  { value: "AADHAAR",         label: "Aadhaar",         placeholder: "12-digit Aadhaar number",   re: /^\d{12}$/,             error: "Aadhaar number must be exactly 12 digits." },
  { value: "PAN",             label: "PAN",             placeholder: "ABCDE1234F",                re: /^[A-Z]{5}\d{4}[A-Z]$/, error: "PAN must look like ABCDE1234F." },
  { value: "DRIVING_LICENSE", label: "Driving licence", placeholder: "As printed on the licence", re: /^[A-Z0-9-]{8,20}$/,    error: "Enter the driving licence number as printed." },
  { value: "PASSPORT",        label: "Passport",        placeholder: "A1234567",                  re: /^[A-Z][0-9]{7}$/,      error: "Passport number must look like A1234567." },
  { value: "VOTER_ID",        label: "Voter ID",        placeholder: "ABC1234567",                re: /^[A-Z]{3}\d{7}$/,      error: "Voter ID must look like ABC1234567." },
  { value: "OTHER",           label: "Other",           placeholder: "ID number",                 re: /^[A-Z0-9/-]{4,30}$/,   error: "Enter the ID number (4–30 letters or digits)." },
];

export const idProofLabel = (type) => ID_PROOFS.find((t) => t.value === type)?.label || type || "";

/** The number as stored: no spaces, upper case; Aadhaar also without dashes. */
export const cleanIdNumber = (type, v) => {
  const n = String(v || "").replace(/\s/g, "").toUpperCase();
  return type === "AADHAAR" ? n.replace(/-/g, "") : n;
};

/** Error text for an ID proof, or "" when it's fine (or, unless `strict`, not entered yet). */
export const idProofError = (type, number, strict = false) => {
  const rule = ID_PROOFS.find((t) => t.value === type);
  const n = cleanIdNumber(type, number);
  if (!rule) return strict ? "Choose the ID type." : "";
  if (!n) return strict ? "Enter the ID number." : "";
  return rule.re.test(n) ? "" : rule.error;
};
