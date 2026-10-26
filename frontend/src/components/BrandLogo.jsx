// frontend/src/components/BrandLogo.jsx
// OHPC VMS wordmark that follows the app theme: blue on the light theme, white
// on the dark theme, black when printed (the .brand-* rules in index.css).
export default function BrandLogo({ height = 36, className = '' }) {
  const logo = (src, variant) => (
    <img src={src} alt="OHPC VMS" className={`${variant} ${className}`} style={{ height, width: 'auto' }} />
  );
  return (
    <>
      {logo('/brand/vms-logo-blue.png',  'brand-on-light')}
      {logo('/brand/vms-logo-white.png', 'brand-on-dark')}
      {logo('/brand/vms-logo-black.png', 'brand-print')}
    </>
  );
}
