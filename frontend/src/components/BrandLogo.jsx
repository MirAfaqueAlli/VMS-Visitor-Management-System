// frontend/src/components/BrandLogo.jsx
// Official OHPC logo (from ohpc.co.in) that follows the app theme: full colour on
// the light theme, the yellow-on-dark version on the dark theme, full colour when
// printed (the .brand-* rules in index.css).
export default function BrandLogo({ height = 36, className = '' }) {
  const logo = (src, variant) => (
    <img src={src} alt="Odisha Hydro Power Corporation Ltd." className={`${variant} ${className}`} style={{ height, width: 'auto' }} />
  );
  return (
    <>
      {logo('/brand/ohpc-logo.svg',       'brand-on-light')}
      {logo('/brand/ohpc-logo-white.svg', 'brand-on-dark')}
      {logo('/brand/ohpc-logo.svg',       'brand-print')}
    </>
  );
}
