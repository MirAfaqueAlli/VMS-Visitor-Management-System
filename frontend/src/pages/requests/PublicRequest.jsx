import { useState, useEffect } from "react";
import { Shield, Building2, User, FileText, CheckCircle2 } from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

export default function PublicRequest() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Form selections
  const [organizations, setOrganizations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [hosts, setHosts] = useState([]);

  // Form state
  const [formData, setFormData] = useState({
    organization_id: "",
    department_id: "",
    host_user_id: "",
    purpose: "",
    visit_date: "",
    visit_start_time: "",
    visit_end_time: "",
    visitor_full_name: "",
    visitor_email: "",
    visitor_phone: "",
    id_type: "AADHAAR",
    id_number: "",
    company_name: "",
  });

  // Fetch Orgs on mount and auto-select the first one
  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        const res = await apiClient.get("/organizations");
        const orgs = res.data.data || [];
        if (orgs.length > 0) {
          const firstOrg = orgs[0];
          setOrganizations(orgs);
          setFormData(prev => ({ ...prev, organization_id: firstOrg.id }));
        }
      } catch (err) {
        console.error("Failed to fetch organizations", err);
      }
    };
    fetchOrgs();
  }, []);

  // Fetch Depts when Org changes
  useEffect(() => {
    if (!formData.organization_id) {
      setDepartments([]);
      setHosts([]);
      setFormData(prev => ({ ...prev, department_id: "", host_user_id: "" }));
      return;
    }
    const fetchDepts = async () => {
      try {
        const res = await apiClient.get(`/departments?organization_id=${formData.organization_id}`);
        setDepartments(res.data.data || []);
      } catch (err) {
        console.error("Failed to fetch departments", err);
      }
    };
    fetchDepts();
  }, [formData.organization_id]);

  // Fetch Hosts when Dept changes
  useEffect(() => {
    if (!formData.department_id) {
      setHosts([]);
      setFormData(prev => ({ ...prev, host_user_id: "" }));
      return;
    }
    const fetchHosts = async () => {
      try {
        const res = await apiClient.get(`/users/hosts?department_id=${formData.department_id}`);
        setHosts(res.data.data || []);
      } catch (err) {
        console.error("Failed to fetch hosts", err);
      }
    };
    fetchHosts();
  }, [formData.department_id]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        visit_category: "PRIOR",
        ...formData,
        organization_id: parseInt(formData.organization_id),
        department_id: parseInt(formData.department_id),
        host_user_id: parseInt(formData.host_user_id),
      };
      await apiClient.post("/visit-requests/public", payload);
      setSuccess(true);
      toast.success("Visit request submitted successfully!");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to submit request.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center p-4">
        <div className="vms-card max-w-md w-full p-8 text-center rounded-2xl shadow-card">
          <div className="w-16 h-16 rounded-full bg-mixed-bg flex items-center justify-center mx-auto mb-6 text-accent">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-2xl font-bold text-loud mb-2">Request Submitted</h2>
          <p className="text-muted text-sm mb-6">
            Your visit request has been sent to the host for approval. You will receive an SMS/Email notification once it is approved.
          </p>
          <button
            onClick={() => { setSuccess(false); setFormData({ ...formData, purpose: "", visit_date: "" }); }}
            className="btn-secondary w-full"
          >
            Submit Another Request
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary py-12 px-4 sm:px-6">
      {/* Background decoration */}
      <div className="fixed inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(245,158,11,0.05) 0%, transparent 70%)" }} />

      <div className="max-w-2xl mx-auto relative z-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: "var(--sidebar-bg)" }}>
            <Shield size={28} style={{ color: "var(--color-accent)" }} />
          </div>
          <h1 className="text-3xl font-bold text-loud">
            Visitor <em className="italic text-accent">Pre-Registration</em>
          </h1>
          <p className="text-muted mt-2 text-sm">
            Submit a prior approval request to visit an organization.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="vms-card rounded-2xl p-8 shadow-card space-y-8">
          
          {/* Section: Visit Details */}
          <div>
            <h3 className="text-lg font-semibold text-loud flex items-center gap-2 mb-4">
              <Building2 size={18} className="text-accent" /> Where are you visiting?
            </h3>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2 hidden">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Organization *</label>
                <select name="organization_id" required value={formData.organization_id} onChange={handleInputChange} className="vms-input w-full">
                  <option value="">Select Organization</option>
                  {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Department *</label>
                <select name="department_id" required value={formData.department_id} onChange={handleInputChange} disabled={!formData.organization_id} className="vms-input w-full">
                  <option value="">Select Department</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Host *</label>
                <select name="host_user_id" required value={formData.host_user_id} onChange={handleInputChange} disabled={!formData.department_id} className="vms-input w-full">
                  <option value="">Select Host / Employee</option>
                  {hosts.map(h => <option key={h.id} value={h.id}>{h.full_name} ({h.designation || 'Employee'})</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Date of Visit *</label>
                <input type="date" name="visit_date" required value={formData.visit_date} onChange={handleInputChange} className="vms-input w-full" min={new Date().toISOString().split('T')[0]} />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Time (Optional)</label>
                <div className="flex items-center gap-2">
                  <input type="time" name="visit_start_time" value={formData.visit_start_time} onChange={handleInputChange} className="vms-input w-full" />
                  <span className="text-muted">to</span>
                  <input type="time" name="visit_end_time" value={formData.visit_end_time} onChange={handleInputChange} className="vms-input w-full" />
                </div>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Purpose of Visit *</label>
                <input type="text" name="purpose" required minLength={10} value={formData.purpose} onChange={handleInputChange} placeholder="e.g. Project discussion meeting" className="vms-input w-full" />
              </div>
            </div>
          </div>

          <div className="h-px bg-border w-full" />

          {/* Section: Visitor Details */}
          <div>
            <h3 className="text-lg font-semibold text-loud flex items-center gap-2 mb-4">
              <User size={18} className="text-accent" /> Your Details
            </h3>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Full Name *</label>
                <input type="text" name="visitor_full_name" required value={formData.visitor_full_name} onChange={handleInputChange} placeholder="Your name" className="vms-input w-full" />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Phone Number *</label>
                <input type="tel" name="visitor_phone" required value={formData.visitor_phone} onChange={handleInputChange} placeholder="Mobile number" className="vms-input w-full" />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Email (Optional)</label>
                <input type="email" name="visitor_email" value={formData.visitor_email} onChange={handleInputChange} placeholder="Email address" className="vms-input w-full" />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">ID Type *</label>
                <select name="id_type" required value={formData.id_type} onChange={handleInputChange} className="vms-input w-full">
                  <option value="AADHAAR">Aadhaar</option>
                  <option value="PAN">PAN</option>
                  <option value="DRIVING_LICENSE">Driving License</option>
                  <option value="PASSPORT">Passport</option>
                  <option value="VOTER_ID">Voter ID</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">ID Number *</label>
                <input type="text" name="id_number" required value={formData.id_number} onChange={handleInputChange} placeholder="XXXX-XXXX-XXXX" className="vms-input w-full" />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Company Name (Optional)</label>
                <input type="text" name="company_name" value={formData.company_name} onChange={handleInputChange} placeholder="Your company name" className="vms-input w-full" />
              </div>
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 text-sm font-semibold flex items-center justify-center gap-2">
            {loading ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <FileText size={18} />}
            {loading ? "Submitting..." : "Submit Request"}
          </button>

        </form>
      </div>
    </div>
  );
}
