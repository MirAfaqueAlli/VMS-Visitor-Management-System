import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
 Search,
 Plus,
 Eye,
 User,
 Briefcase,
 Calendar,
 ChevronLeft,
 ChevronRight,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

export default function VisitorList() {
 const [visitors, setVisitors] = useState([]);
 const [loading, setLoading] = useState(true);
 const [search, setSearch] = useState("");
 const [debouncedSearch, setDebouncedSearch] = useState("");
 const [page, setPage] = useState(1);
 const [totalPages, setTotalPages] = useState(1);
 const limit = 10;
 const navigate = useNavigate();

 // Debounce search
 useEffect(() => {
 const handler = setTimeout(() => setDebouncedSearch(search), 300);
 return () => clearTimeout(handler);
 }, [search]);

 const fetchVisitors = useCallback(async () => {
 try {
 setLoading(true);
 const response = await apiClient.get("/visitors", {
 params: { search: debouncedSearch, page, limit },
 });
 setVisitors(response.data.data?.visitors || []);
 setTotalPages(response.data.data?.pagination?.pages || 1);
 } catch (error) {
 toast.error(error.response?.data?.message || "Failed to fetch visitors");
 } finally {
 setLoading(false);
 }
 }, [debouncedSearch, page]);

 useEffect(() => {
 fetchVisitors();
 }, [fetchVisitors]);

 return (
 <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
 <div>
 <h1 className="text-2xl font-bold text-loud">
 Visitor <em className="italic">Directory</em>
 </h1>
 <p className="text-muted mt-2">
 Manage all registered visitors.
 </p>
 </div>
 <Link
 to="/visitors/new"
 className="btn-primary px-4 py-2 text-xs"
 >
 <Plus className="w-4 h-4" />
 New Visitor
 </Link>
 </div>

 <div className="vms-card rounded-md p-6 mb-8 shadow-card">
 <div className="relative max-w-md mb-6">
 <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
 <Search
 className="h-5 w-5 text-accent"
 strokeWidth={1.5}
 />
 </div>
 <input
 type="text"
 className="block w-full pl-11 pr-4 py-3 bg-bg-primary border border-subtle rounded-full text-loud placeholder-faint focus:outline-none focus:ring-2 focus:ring-accent transition-all duration-300"
 placeholder="Search by name, phone, or email..."
 value={search}
 onChange={(e) => {
 setSearch(e.target.value);
 setPage(1);
 }}
 />
 </div>

 <div className="overflow-x-auto">
 <table className="w-full text-left border-collapse">
 <thead>
 <tr className="border-b border-subtle text-muted text-sm uppercase tracking-wider">
 <th className="py-4 px-4 font-medium">Name</th>
 <th className="py-4 px-4 font-medium">Contact</th>
 <th className="py-4 px-4 font-medium">Type</th>
 <th className="py-4 px-4 font-medium">Registered</th>
 <th className="py-4 px-4 font-medium text-right">Actions</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td
 colSpan="5"
 className="text-center py-12 text-faint italic"
 >
 Loading...
 </td>
 </tr>
 ) : visitors.length === 0 ? (
 <tr>
 <td
 colSpan="5"
 className="text-center py-12 text-faint italic"
 >
 No visitors found.
 </td>
 </tr>
 ) : (
 visitors.map((visitor) => (
 <tr
 key={visitor.id || visitor.visitor_id}
 className="border-b border-subtle hover:bg-bg-primary/50 transition-colors duration-300"
 >
 <td className="py-4 px-4">
 <div className="font-medium text-loud">
 {visitor.full_name}
 </div>
 {visitor.company_name && (
 <div className="text-sm text-muted">
 {visitor.company_name}
 </div>
 )}
 </td>
 <td className="py-4 px-4">
 <div className="text-loud">{visitor.phone}</div>
 <div className="text-sm text-muted">
 {visitor.email}
 </div>
 </td>
 <td className="py-4 px-4">
 <span
 className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wider ${
 visitor.visitor_type === "business"
 ? "bg-accent/10 text-warning"
 : "bg-mixed-bg text-accent"
 }`}
 >
 {visitor.visitor_type === "business" ? (
 <Briefcase className="w-3 h-3" />
 ) : (
 <User className="w-3 h-3" />
 )}
 {visitor.visitor_type}
 </span>
 </td>
 <td className="py-4 px-4 text-loud/80">
 <div className="flex items-center gap-1.5">
 <Calendar
 className="w-4 h-4 text-accent"
 strokeWidth={1.5}
 />
 {new Date(visitor.created_at).toLocaleDateString()}
 </div>
 </td>
 <td className="py-4 px-4 text-right">
 <button
 onClick={() =>
 navigate(`/visitors/${visitor.id || visitor.visitor_id}`)
 }
 className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-bg-primary text-accent hover:bg-accent hover:text-white transition-colors duration-300"
 title="View Details"
 >
 <Eye className="w-4 h-4" strokeWidth={1.5} />
 </button>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>

 {/* Pagination */}
 {!loading && totalPages > 1 && (
 <div className="flex items-center justify-between mt-8 pt-6 border-t border-subtle">
 <span className="text-sm text-muted">
 Page {page} of {totalPages}
 </span>
 <div className="flex items-center gap-2">
 <button
 onClick={() => setPage((p) => Math.max(1, p - 1))}
 disabled={page === 1}
 className="p-2 rounded-full border border-subtle text-loud disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-primary transition-colors duration-300"
 >
 <ChevronLeft className="w-5 h-5" strokeWidth={1.5} />
 </button>
 <button
 onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
 disabled={page === totalPages}
 className="p-2 rounded-full border border-subtle text-loud disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-primary transition-colors duration-300"
 >
 <ChevronRight className="w-5 h-5" strokeWidth={1.5} />
 </button>
 </div>
 </div>
 )}
 </div>
 </div>
 );
}
