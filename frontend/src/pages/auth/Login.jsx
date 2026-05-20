// frontend/src/pages/auth/Login.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import useAuth from '../../hooks/useAuth';
import apiClient from '../../api/axios';

export default function Login() {
 const { login } = useAuth();
 const navigate = useNavigate();

 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [isLoading, setIsLoading] = useState(true); // default true for setup check
 const [error, setError] = useState('');

 // Check setup status on mount
 useEffect(() => {
   const checkSetup = async () => {
     try {
       const res = await apiClient.get('/organizations/setup-status');
       if (!res.data.data.isSetup) {
         navigate('/register', { replace: true });
       } else {
         setIsLoading(false);
       }
     } catch (err) {
       console.error("Setup check failed:", err);
       setIsLoading(false);
     }
   };
   checkSetup();
 }, [navigate]);

 const handleSubmit = async (e) => {
 e.preventDefault();
 setError('');
 setIsLoading(true);
 try {
 await login(email, password);
 navigate('/dashboard', { replace: true });
 } catch (err) {
 setError(err?.response?.data?.message || 'Invalid credentials. Please try again.');
 } finally {
 setIsLoading(false);
 }
 };

 return (
 <div
 className="min-h-screen flex items-center justify-center p-4"
 style={{ background: 'var(--color-bg-primary)' }}
 >
 <div
 className="w-full max-w-sm"
 style={{
 background: 'var(--color-bg-secondary)',
 border: '1px solid var(--color-border)',
 borderRadius: 'var(--radius-md)',
 boxShadow: 'var(--shadow-card)',
 padding: '1.75rem',
 }}
 >
 {/* Logo */}
 <div className="flex items-center gap-2 mb-6">
 <div
 className="w-8 h-8 flex items-center justify-center"
 style={{
 background: 'var(--color-accent)',
 borderRadius: 'var(--radius-sm)',
 }}
 >
 <Shield size={16} style={{ color: '#0f172a' }} strokeWidth={2.2} />
 </div>
 <div>
 <p className="font-bold text-[14px] leading-none" style={{ color: 'var(--color-text)' }}>
 VMS
 </p>
 <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-faint)' }}>
 Visitor Management System
 </p>
 </div>
 </div>

 {/* Header */}
 <div className="mb-5">
 <h2 className="text-[15px] font-semibold" style={{ color: 'var(--color-text)' }}>
 Sign in
 </h2>
 <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-faint)' }}>
 Enter your credentials to continue
 </p>
 </div>

 {/* Form */}
 <form className="space-y-3.5" onSubmit={handleSubmit}>
 {/* Email */}
 <div>
 <label
 className="block text-[11px] font-medium mb-1.5"
 style={{ color: 'var(--color-text-muted)' }}
 >
 Email address
 </label>
 <div className="relative">
 <Mail
 size={13}
 strokeWidth={1.8}
 className="absolute left-2.5 top-1/2 -translate-y-1/2"
 style={{ color: 'var(--color-text-faint)' }}
 />
 <input
 id="login-email"
 type="email"
 required
 autoComplete="email"
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 placeholder="you@company.com"
 className="vms-input pl-8"
 />
 </div>
 </div>

 {/* Password */}
 <div>
 <label
 className="block text-[11px] font-medium mb-1.5"
 style={{ color: 'var(--color-text-muted)' }}
 >
 Password
 </label>
 <div className="relative">
 <Lock
 size={13}
 strokeWidth={1.8}
 className="absolute left-2.5 top-1/2 -translate-y-1/2"
 style={{ color: 'var(--color-text-faint)' }}
 />
 <input
 id="login-password"
 type={showPassword ? 'text' : 'password'}
 required
 autoComplete="current-password"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 placeholder="••••••••"
 className="vms-input pl-8 pr-8"
 />
 <button
 type="button"
 tabIndex={-1}
 onClick={() => setShowPassword((p) => !p)}
 className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
 style={{ color: 'var(--color-text-faint)' }}
 onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text)'}
 onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-faint)'}
 >
 {showPassword
 ? <EyeOff size={13} strokeWidth={1.8} />
 : <Eye size={13} strokeWidth={1.8} />
 }
 </button>
 </div>
 </div>

 {/* Error */}
 {error && (
 <div
 className="px-3 py-2 text-[12px]"
 style={{
 background: 'var(--color-danger-bg)',
 border: '1px solid #fecaca',
 borderRadius: 'var(--radius-sm)',
 color: 'var(--color-error)',
 }}
 >
 {error}
 </div>
 )}

 {/* Submit */}
 <button
 id="login-submit-btn"
 type="submit"
 disabled={isLoading}
 className="btn-primary w-full justify-center"
 style={{ marginTop: '0.25rem' }}
 >
 {isLoading ? (
 <span className="flex items-center gap-1.5">
 <span
 className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin"
 style={{ borderColor: 'rgba(15,23,42,0.2)', borderTopColor: '#0f172a' }}
 />
 Signing in...
 </span>
 ) : 'Sign In'}
 </button>
 </form>

 <p
 className="text-center text-[10px] uppercase tracking-widest mt-5"
 style={{ color: 'var(--color-text-faint)' }}
 >
 © {new Date().getFullYear()} SOBEIT Technology
 </p>
 </div>
 </div>
 );
}
