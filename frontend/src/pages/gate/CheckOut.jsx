import { useState, useEffect, useCallback } from "react";
import { LogOut, Clock, User, Hash } from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

export default function CheckOut() {
 const [activeVisitors, setActiveVisitors] = useState([]);
 const [loading, setLoading] = useState(true);
 const [checkoutData, setCheckoutData] = useState({
 visit_log_id: null,
 remarks: "",
 });
 const [showModal, setShowModal] = useState(false);
 const [submitting, setSubmitting] = useState(false);

 const fetchActiveVisitors = useCallback(async () => {
 try {
 setLoading(true);
 const response = await apiClient.get("/gate/dashboard");
 setActiveVisitors(response.data.data?.active || []);
 } catch (error) {
 toast.error("Failed to fetch active visitors");
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchActiveVisitors();
 }, [fetchActiveVisitors]);

 const initiateCheckout = (logId) => {
 setCheckoutData({ visit_log_id: logId, remarks: "" });
 setShowModal(true);
 };

 const handleCheckout = async () => {
 setSubmitting(true);
 try {
 await apiClient.post("/gate/checkout", checkoutData);
 toast.success("Visitor checked out successfully");
 setShowModal(false);
 fetchActiveVisitors(); // Refresh list
 } catch (error) {
 toast.error(error.response?.data?.message || "Checkout failed");
 } finally {
 setSubmitting(false);
 }
 };

 return (
 <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in relative">
 <div className="mb-8">
 <h1 className="text-2xl font-bold text-loud">
 Gate <em className="italic">Check-Out</em>
 </h1>
 <p className="text-muted mt-2">
 Manage currently active visitors on premises.
 </p>
 </div>

 <div className="vms-card rounded-md p-6 shadow-card">
 <div className="overflow-x-auto">
 <table className="w-full text-left border-collapse">
 <thead>
 <tr className="border-b border-subtle text-muted text-sm uppercase tracking-wider">
 <th className="py-4 px-4 font-medium">Visitor</th>
 <th className="py-4 px-4 font-medium">Pass Number</th>
 <th className="py-4 px-4 font-medium">Host</th>
 <th className="py-4 px-4 font-medium">Check-In Time</th>
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
 Loading active visitors...
 </td>
 </tr>
 ) : activeVisitors.length === 0 ? (
 <tr>
 <td
 colSpan="5"
 className="text-center py-12 text-faint italic"
 >
 No active visitors on premises.
 </td>
 </tr>
 ) : (
 activeVisitors.map((visitor) => (
 <tr
 key={visitor.visit_log_id}
 className="border-b border-subtle hover:bg-bg-primary/50 transition-colors duration-300"
 >
 <td className="py-4 px-4">
 <div className="font-medium text-loud flex items-center gap-2">
 <User className="w-4 h-4 text-accent" />
 {visitor.visitor_name}
 </div>
 <div className="text-sm text-muted pl-6 mt-1 line-clamp-1">
 {visitor.purpose}
 </div>
 </td>
 <td className="py-4 px-4">
 <div className="text-loud font-mono text-sm flex items-center gap-1.5 bg-bg-primary px-2 py-1 rounded inline-flex">
 <Hash className="w-3 h-3 text-accent" />
 {visitor.pass_number}
 </div>
 </td>
 <td className="py-4 px-4">
 <div className="text-loud">
 {visitor.host_name}
 </div>
 <div className="text-sm text-muted">
 {visitor.department_name}
 </div>
 </td>
 <td className="py-4 px-4">
 <div className="text-loud flex items-center gap-1.5">
 <Clock
 className="w-4 h-4 text-accent"
 strokeWidth={1.5}
 />
 {new Date(visitor.check_in_at).toLocaleTimeString([], {
 hour: "2-digit",
 minute: "2-digit",
 })}
 </div>
 </td>
 <td className="py-4 px-4 text-right">
 <button
 onClick={() => initiateCheckout(visitor.visit_log_id)}
 className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-accent/10 text-warning hover:bg-accent hover:text-white transition-colors duration-300 text-xs font-medium uppercase tracking-wider gap-1.5"
 >
 <LogOut className="w-3.5 h-3.5" />
 Check Out
 </button>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </div>

 {/* Checkout Modal */}
 {showModal && (
 <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
 <div
 className="absolute inset-0 bg-accent/40 backdrop-blur-sm"
 onClick={() => !submitting && setShowModal(false)}
 ></div>
 <div className="bg-vms-card rounded-md p-8 max-w-md w-full relative z-10 shadow-card animate-fade-in">
 <h3 className="text-2xl text-loud mb-2">
 Confirm Check-Out
 </h3>
 <p className="text-muted text-sm mb-6">
 Are you sure you want to check out this visitor?
 </p>

 <div className="space-y-2 mb-8">
 <label className="block text-sm font-medium text-loud">
 Remarks (Optional)
 </label>
 <textarea
 value={checkoutData.remarks}
 onChange={(e) =>
 setCheckoutData({ ...checkoutData, remarks: e.target.value })
 }
 className="w-full bg-bg-primary border border-subtle rounded-xl p-3 text-loud focus:outline-none focus:border-border transition-colors duration-300 resize-none"
 rows="3"
 placeholder="Any issues or notes during departure..."
 ></textarea>
 </div>

 <div className="flex justify-end gap-3">
 <button
 onClick={() => setShowModal(false)}
 disabled={submitting}
 className="btn-secondary text-loud hover:bg-bg-primary transition-colors duration-300 text-sm font-medium"
 >
 Cancel
 </button>
 <button
 onClick={handleCheckout}
 disabled={submitting}
 className="px-6 py-2.5 rounded-full bg-accent text-white hover:bg-accent/90 transition-colors duration-300 text-sm font-medium flex items-center gap-2 disabled:opacity-70"
 >
 {submitting ? (
 "Processing..."
 ) : (
 <>
 <LogOut className="w-4 h-4" />
 Confirm Check-Out
 </>
 )}
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
}
