// frontend/src/components/PasswordStrength.jsx
import { validatePassword, getPasswordStrength } from '../utils/passwordValidator';
import { Check, Circle } from './icons';

const STRENGTH = [
  { label: 'Very weak', color: 'var(--danger)' },
  { label: 'Weak', color: 'var(--danger)' },
  { label: 'Fair', color: 'var(--warning-text)' },
  { label: 'Strong', color: 'var(--success)' },
  { label: 'Very strong', color: 'var(--success)' },
];

/**
 * Password strength indicator with live rule checklist.
 *
 * Props:
 *   - password: string
 *   - show: boolean (optional, default true) — whether to show the checklist
 *   - hideWhenValid: boolean (optional) — once every rule passes, replace the
 *     bar + checklist with a single "all requirements met" line
 *   - hideChecklistWhenValid: boolean (optional) — once every rule passes, keep the
 *     strength bar but drop the checklist to save space
 */
export default function PasswordStrength({ password, show = true, hideWhenValid = false, hideChecklistWhenValid = false }) {
  if (!password || !show) return null;

  const { valid, results } = validatePassword(password);
  if (hideWhenValid && valid) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-success animate-fade-in">
        <Check size={12} weight="bold" /> Strong password. All requirements met.
      </p>
    );
  }
  const strength = getPasswordStrength(password);
  const { label, color } = STRENGTH[Math.max(strength - 1, 0)];

  return (
    <div className="mt-2 space-y-2 animate-fade-in">
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full overflow-hidden bg-surface-alt">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${(strength / 5) * 100}%`, background: color }}
          />
        </div>
        <span className="text-[11px] font-medium shrink-0" style={{ color }}>{label}</span>
      </div>

      {/* Rule checklist */}
      {!(hideChecklistWhenValid && valid) && (
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
        {results.map((r) => (
          <li key={r.key} className={`flex items-center gap-1.5 text-[11px] ${r.passed ? 'text-success' : 'text-muted'}`}>
            {r.passed ? <Check size={11} weight="bold" /> : <Circle size={11} />}
            {r.label}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
