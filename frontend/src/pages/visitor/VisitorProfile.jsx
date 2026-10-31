// frontend/src/pages/visitor/VisitorProfile.jsx
import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import {
  User,
  Phone,
  Mail,
  MapPin,
  Building,
  ShieldCheck,
  CreditCard,
  Save,
  Loader2,
  CheckCircle,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

const GOVT_ID_TYPES = [
  "Aadhaar Card",
  "PAN Card",
  "Voter ID",
  "Driving License",
  "Passport",
  "Govt Employee ID",
];

export default function VisitorProfile() {
  const { setVisitor } = useOutletContext();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({
    full_name: "",
    phone: "",
    email: "",
    address: "",
    company_name: "",
    govt_id_type: "Aadhaar Card",
    govt_id_number: "",
  });

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await apiClient.get("/public-auth/me");
        const data = res.data?.data?.visitor;
        if (data) {
          setProfile({
            full_name: data.full_name || "",
            phone: data.phone || "",
            email: data.email || "",
            address: data.address || "",
            company_name: data.company_name || "",
            govt_id_type: data.govt_id_type || "Aadhaar Card",
            govt_id_number: data.govt_id_number || "",
          });
        }
      } catch (err) {
        console.error("Failed to load profile:", err);
        toast.error("Could not load profile details.");
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!profile.full_name.trim()) {
      toast.error("Full Name is required.");
      return;
    }

    setSaving(true);
    try {
      const res = await apiClient.put("/public-auth/profile", {
        full_name: profile.full_name.trim(),
        address: profile.address.trim(),
        company_name: profile.company_name.trim(),
        govt_id_type: profile.govt_id_type,
        govt_id_number: profile.govt_id_number.trim(),
      });

      const updated = res.data?.data?.visitor;
      const newToken = res.data?.data?.visitor_token;

      if (newToken) {
        localStorage.setItem("vms_visitor_token", newToken);
        sessionStorage.setItem("vms_visitor_token", newToken);
      }

      if (updated) {
        localStorage.setItem("vms_visitor_data", JSON.stringify(updated));
        if (setVisitor) setVisitor(updated);
      }

      toast.success("Profile updated successfully!");
    } catch (err) {
      console.error("Profile save error:", err);
      toast.error(err?.response?.data?.message || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="vms-card p-12 text-center text-xs text-faint border border-border">
        Loading visitor profile...
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* ── Top Header ──────────────────────────────────────────────────────── */}
      <div className="pb-4 border-b border-border">
        <h1 className="text-xl sm:text-2xl font-black text-loud tracking-tight">
          My Visitor Profile
        </h1>
      
      </div>

      {/* ── Profile Form ────────────────────────────────────────────────────── */}
      <form onSubmit={handleSave} className="vms-card p-6 sm:p-8 border border-border space-y-6">
        {/* Verification Status Pill */}
        <div className="p-4 rounded-xl bg-mixed-bg/50 border border-mixed/20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center font-bold text-sm">
              {profile.full_name ? profile.full_name.charAt(0).toUpperCase() : "V"}
            </div>
            <div>
              <p className="text-xs font-bold text-loud">{profile.full_name || "Visitor"}</p>
              <p className="text-[11px] text-faint flex items-center gap-1 mt-0.5">
                <ShieldCheck size={13} className="text-success" />
                <span>Verified Public Visitor Account</span>
              </p>
            </div>
          </div>
        </div>

        {/* Section 1: Basic Identity */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-border">
            <User size={13} className="text-accent" />
            <span>Personal Information</span>
          </h2>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-muted">
              Full Legal Name *
            </label>
            <input
              type="text"
              required
              value={profile.full_name}
              onChange={(e) =>
                setProfile((p) => ({ ...p, full_name: e.target.value }))
              }
              className="vms-input"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Phone (Verified Badge) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-muted flex items-center justify-between">
                <span>Verified Mobile</span>
                <span className="text-[10px] text-success font-semibold flex items-center gap-0.5">
                  <CheckCircle size={11} /> Verified
                </span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  disabled
                  value={profile.phone}
                  className="vms-input bg-bg-primary opacity-75 cursor-not-allowed pl-8"
                />
                <Phone
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
                />
              </div>
            </div>

            {/* Email (Verified Badge) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-muted flex items-center justify-between">
                <span>Verified Email</span>
                <span className="text-[10px] text-success font-semibold flex items-center gap-0.5">
                  <CheckCircle size={11} /> Verified
                </span>
              </label>
              <div className="relative">
                <input
                  type="email"
                  disabled
                  value={profile.email}
                  className="vms-input bg-bg-primary opacity-75 cursor-not-allowed pl-8"
                />
                <Mail
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
                />
              </div>
            </div>
          </div>

          {/* Residential Address */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-muted">
              Residential / Official Address
            </label>
            <div className="relative">
              <textarea
                rows={2}
                value={profile.address}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, address: e.target.value }))
                }
                placeholder="Street address, city, district, state"
                className="vms-input"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Organization */}
        <div className="space-y-4 pt-3 border-t border-border">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-border">
            <Building size={13} className="text-accent" />
            <span>Organization / Company</span>
          </h2>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-muted">
              Company / Employer Name (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Bharat Heavy Electricals Ltd. / Consulting Firm"
              value={profile.company_name}
              onChange={(e) =>
                setProfile((p) => ({ ...p, company_name: e.target.value }))
              }
              className="vms-input"
            />
          </div>
        </div>

        {/* Section 3: Government ID Proof */}
        <div className="space-y-4 pt-3 border-t border-border">
          <h2 className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-border">
            <CreditCard size={13} className="text-accent" />
            <span>Government ID Proof (Required for Gate Clearance)</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-muted">
                ID Type
              </label>
              <select
                value={profile.govt_id_type}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, govt_id_type: e.target.value }))
                }
                className="vms-input"
              >
                {GOVT_ID_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-muted">
                ID Number
              </label>
              <input
                type="text"
                placeholder="Enter ID number"
                value={profile.govt_id_number}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, govt_id_number: e.target.value }))
                }
                className="vms-input"
              />
            </div>
          </div>
          <p className="text-[11px] text-faint">
            Note: You will still be required to present the physical ID document to the security guard at the gate.
          </p>
        </div>

        {/* ── Save Button ───────────────────────────────────────────────────── */}
        <div className="pt-4 border-t border-border flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="btn-primary py-2.5 px-6 text-xs sm:text-sm font-bold shadow-md shadow-accent/20"
          >
            {saving ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                <span>Saving Profile...</span>
              </>
            ) : (
              <>
                <Save size={15} />
                <span>Save Profile Details</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

