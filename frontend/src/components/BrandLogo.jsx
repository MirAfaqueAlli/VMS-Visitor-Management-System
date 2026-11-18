// frontend/src/components/BrandLogo.jsx
// Official OHPC logo (from ohpc.co.in) — always the original, never recoloured, in
// every theme and in print. On the dark theme it sits on a white tile (.brand-tile in
// index.css) so its navy lettering stays readable.
export default function BrandLogo({ height = 36, className = '' }) {
  return (
    <span className={`brand-tile ${className}`}>
      <img src="/brand/ohpc-logo.svg" alt="Odisha Hydro Power Corporation Ltd." style={{ height, width: 'auto', display: 'block' }} />
    </span>
  );
}
