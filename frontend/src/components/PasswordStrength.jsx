// frontend/src/components/PasswordStrength.jsx
import { validatePassword, getPasswordStrength } from '../utils/passwordValidator';

const STRENGTH_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'];
const STRENGTH_LABELS = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];

/**
 * Password strength indicator with live rule checklist.
 *
 * Props:
 *   - password: string
 *   - show: boolean (optional, default true) — whether to show the checklist
 */
export default function PasswordStrength({ password, show = true }) {
  if (!password || !show) return null;

  const { results } = validatePassword(password);
  const strength    = getPasswordStrength(password);
  const barColor    = STRENGTH_COLORS[Math.max(strength - 1, 0)];
  const label       = STRENGTH_LABELS[Math.max(strength - 1, 0)];

  return (
    <div className="mt-2 space-y-2 animate-fade-in">
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border, #e2e8f0)' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${(strength / 5) * 100}%`, background: barColor }}
          />
        </div>
        <span className="text-[10px] font-semibold shrink-0" style={{ color: barColor }}>
          {label}
        </span>
      </div>

      {/* Rule checklist */}
      <ul className="space-y-1">
        {results.map((r) => (
          <li
            key={r.key}
            className="flex items-center gap-1.5 text-[11px] transition-colors duration-200"
            style={{ color: r.passed ? '#16a34a' : 'var(--color-text-faint, #94a3b8)' }}
          >
            <span style={{ fontSize: '10px' }}>{r.passed ? '✓' : '○'}</span>
            <span style={{ textDecoration: r.passed ? 'line-through' : 'none', opacity: r.passed ? 0.7 : 1 }}>
              {r.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
