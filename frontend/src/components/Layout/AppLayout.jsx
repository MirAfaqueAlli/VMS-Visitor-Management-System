// frontend/src/components/Layout/AppLayout.jsx
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Navbar from './Navbar';

export default function AppLayout() {
 return (
 <div className="min-h-screen" style={{ background: 'var(--color-bg-primary)' }}>
 <Sidebar />
 <div style={{ marginLeft: 'var(--sidebar-width, 220px)' }}>
 <Navbar />
 {/* pt-10 = navbar height, p-5 = content padding like restaurant's p-6 */}
 <main className="pt-16 p-5 min-h-screen">
 <Outlet />
 </main>
 </div>
 </div>
 );
}
