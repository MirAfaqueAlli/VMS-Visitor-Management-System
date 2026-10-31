import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Check,
  Plus,
  Trash2,
  Calendar,
  Clock,
  Building,
  User,
  Users,
  Phone,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  AlertTriangle,
  X,
  Briefcase,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import { getApiErrorMessage } from "../../utils/apiError";

// ── Category definitions ─────────────────────────────────────────────────────────────
const ALL_CATEGORIES = [
  { id: "EMPLOYEE_VISIT", label: "Employee Visit", desc: "Visit or invite a fellow employee" },
  { id: "PERSONAL_VISIT", label: "Personal Visit", desc: "Family / friend visiting you" },
  { id: "VENDOR", label: "Vendor / Contractor", desc: "Service and maintenance vendor" },
  { id: "SPOT_INDIVIDUAL", label: "Individual Walk-in"},
  { id: "SPOT_BUSINESS", label: "Vendor / Business Walk-in"},
];

const ROLE_CATEGORIES = {
  security: ["SPOT_INDIVIDUAL", "SPOT_BUSINESS"],
  employee: ["EMPLOYEE_VISIT", "PERSONAL_VISIT", "VENDOR"],
  unit_admin: ["EMPLOYEE_VISIT", "VENDOR", "SPOT_INDIVIDUAL", "SPOT_BUSINESS"],
  super_admin: ["EMPLOYEE_VISIT", "VENDOR", "SPOT_INDIVIDUAL", "SPOT_BUSINESS"],
  receptionist: ["EMPLOYEE_VISIT", "VENDOR", "SPOT_INDIVIDUAL", "SPOT_BUSINESS"],
  org_admin: ["EMPLOYEE_VISIT", "PERSONAL_VISIT", "VENDOR", "SPOT_INDIVIDUAL", "SPOT_BUSINESS"],
};

// ── Time & Date Helpers ────────────────────────────────────────────────────────
const getTodayDateYMD = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getCurrentTimeHHMM = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

const addMinutesToTime = (timeStr, minutes = 30) => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
};

export default function NewRequest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, activeUnit } = useAuth();
  const [loading, setLoading] = useState(false);
  const [hosts, setHosts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [spotVisitorType, setSpotVisitorType] = useState(() => {
    const t = searchParams.get("type")?.toLowerCase();
    return t === "business" ? "business" : "individual";
  });

  useEffect(() => {
    const t = searchParams.get("type")?.toLowerCase();
    if (t === "business" || t === "individual") {
      setSpotVisitorType(t);
    }
  }, [searchParams]);

  // â”€â”€ Conflict confirmation modal state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [conflictModal, setConflictModal] = useState(null); // null | { types, host_conflict, visitor_conflict, pendingPayload }

  // â”€â”€ Visitor phone lookup state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [visitorLookupState, setVisitorLookupState] = useState("idle"); // idle | loading | found | not_found
  const [foundVisitorData, setFoundVisitorData] = useState(null);

  const resetVisitorLookup = useCallback(() => {
    setVisitorLookupState("idle");
    setFoundVisitorData(null);
  }, []);

  // â”€â”€ Vendor phone lookup state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [vendorLookupState, setVendorLookupState] = useState("idle"); // idle | loading | found | not_found

  const resetVendorLookup = useCallback(() => {
    setVendorLookupState("idle");
  }, []);

  // â”€â”€ EMPLOYEE_VISIT state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [visitMode, setVisitMode] = useState("visiting"); // 'visiting' | 'hosting'
  const [units, setUnits] = useState([]);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [empDepartments, setEmpDepartments] = useState([]);
  const [empDeptId, setEmpDeptId] = useState("");
  const [employees, setEmployees] = useState([]);
  const [selectedEmpId, setSelectedEmpId] = useState("");

  // Current user's own unit ID (or active unit if super admin)
  const currentUnitId = activeUnit?.id ?? user?.unit_id ?? null;

  // Filter out the logged-in user's own unit so only other units are selectable for cross-unit visits
  const otherUnits = useMemo(() => {
    return units.filter((u) => {
      if (currentUnitId != null && String(u.id) === String(currentUnitId)) return false;
      if (user?.unit_id != null && String(u.id) === String(user.unit_id)) return false;
      if (activeUnit?.id != null && String(u.id) === String(activeUnit.id)) return false;
      if (user?.unit_code && u.code && u.code.toLowerCase() === user.unit_code.toLowerCase()) return false;
      if (activeUnit?.code && u.code && u.code.toLowerCase() === activeUnit.code.toLowerCase()) return false;
      return true;
    });
  }, [units, currentUnitId, user?.unit_id, user?.unit_code, activeUnit?.id, activeUnit?.code]);

  // â”€â”€ Unit Admin EMPLOYEE_VISIT state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [adminVisitorDeptId, setAdminVisitorDeptId] = useState("");
  const [adminVisitorEmpId, setAdminVisitorEmpId] = useState("");
  const [adminVisitorAllEmployees, setAdminVisitorAllEmployees] = useState([]);
  const [adminVisitorEmployees, setAdminVisitorEmployees] = useState([]);

  const [adminHostUnitId, setAdminHostUnitId] = useState("");
  const [adminHostDeptId, setAdminHostDeptId] = useState("");
  const [adminHostEmpId, setAdminHostEmpId] = useState("");
  const [adminHostDepts, setAdminHostDepts] = useState([]);
  const [allAdminHostEmployees, setAllAdminHostEmployees] = useState([]);
  const [adminHostEmployees, setAdminHostEmployees] = useState([]);

  const role = user?.role_type || user?.role || "employee";
  const allowedIds = ROLE_CATEGORIES[role] ?? ["EMPLOYEE_VISIT", "VENDOR"];
  const availableCategories = ALL_CATEGORIES.filter((c) => allowedIds.includes(c.id));

  const getInitialCategory = () => {
    const param = searchParams.get("category")?.toUpperCase();
    if (param === "SPOT") {
      const type = searchParams.get("type")?.toUpperCase();
      if (type === "BUSINESS" && allowedIds.includes("SPOT_BUSINESS")) return "SPOT_BUSINESS";
      if (allowedIds.includes("SPOT_INDIVIDUAL")) return "SPOT_INDIVIDUAL";
    }
    if (allowedIds.includes(param)) return param;
    return allowedIds[0] || "SPOT_INDIVIDUAL";
  };

  const initialCat = getInitialCategory();
  const [selectedCategory, setSelectedCategory] = useState(initialCat);
  const isInitialSpot = initialCat === "SPOT" || initialCat === "SPOT_INDIVIDUAL" || initialCat === "SPOT_BUSINESS";

  const initialDate = isInitialSpot ? getTodayDateYMD() : "";
  const initialStartTime = isInitialSpot ? getCurrentTimeHHMM() : "";
  const initialEndTime = isInitialSpot ? addMinutesToTime(initialStartTime, 30) : "";

  const isAdminOrStaff = ["super_admin", "admin", "receptionist", "security", "org_admin", "unit_admin"].includes(
    user?.role_type || user?.role
  );

  const [formData, setFormData] = useState({
    visit_category: isInitialSpot ? "SPOT" : initialCat,
    host_user_id: isAdminOrStaff ? "" : user?.id || "",
    department_id: user?.department_id || "",
    organization_id: user?.organization_id || "",
    purpose: "",
    visit_date: initialDate,
    visit_start_time: initialStartTime,
    visit_end_time: initialEndTime,
    accompanying_count: 0,
    visitor_id: "",
    visitor_phone: "",
    visitor_name: "",
    visitor_email: "",
    company_name: "",
    vendor_email: "",
    contact_person: "",
    gst_number: "",
    work_order_ref: "",
    service_type: "",
    companions: [],
  });

  // â”€â”€ Data fetching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const fetchDropdownData = async () => {
      try {
        // Use the authenticated endpoint  -  the JWT tells the backend which unit DB to query.
        const deptsRes = await apiClient.get("/departments");
        // Departments API is now paginated: { departments: [], pagination: {} }
        const dRaw = deptsRes.data?.data;
        setDepartments(dRaw?.departments ?? (Array.isArray(dRaw) ? dRaw : []));
      } catch (err) {
        console.error("Failed to load departments", err);
      }
    };
    fetchDropdownData();
  }, []);

  // Fetch all employees of the current unit admin's unit
  useEffect(() => {
    if (user?.role_type === "unit_admin" && formData.visit_category === "EMPLOYEE_VISIT") {
      apiClient.get("/users/hosts", { params: { include_all: 'true', roles: 'employee', _t: Date.now() } })
        .then(res => {
          setAdminVisitorAllEmployees(res.data?.data ?? []);
          setAdminVisitorEmployees(res.data?.data ?? []);
        })
        .catch(() => { });
    }
  }, [user?.role_type, formData.visit_category]);

  // Fetch employees of the currently-managed unit for Super Admin EMPLOYEE_VISIT visitor picker
  useEffect(() => {
    if (user?.role_type === "super_admin" && activeUnit?.id && formData.visit_category === "EMPLOYEE_VISIT") {
      const _t = Date.now();
      Promise.allSettled([
        apiClient.get("/departments", { params: { _t } }),
        apiClient.get("/users/hosts", { params: { include_all: 'true', roles: 'employee', _t } }),
      ]).then(([deptRes, empRes]) => {
        if (deptRes.status === 'fulfilled') {
          const dRaw = deptRes.value.data?.data;
          setDepartments(dRaw?.departments ?? (Array.isArray(dRaw) ? dRaw : []));
        }
        if (empRes.status === 'fulfilled') {
          setAdminVisitorAllEmployees(empRes.value.data?.data ?? []);
          setAdminVisitorEmployees(empRes.value.data?.data ?? []);
        }
      });
    }
  }, [user?.role_type, activeUnit?.id, formData.visit_category]);

  // â”€â”€ Visitor phone lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleVisitorLookup = async () => {
    const phone = formData.visitor_phone.trim().replace(/\D/g, "");
    if (phone.length !== 10) {
      toast.error("Please enter a valid 10-digit mobile number to look up.");
      return;
    }
    setVisitorLookupState("loading");
    setFoundVisitorData(null);
    try {
      const res = await apiClient.get("/visitors/lookup", { params: { phone } });
      const { found, visitor } = res.data.data;
      if (found && visitor) {
        if (formData.visit_category === "PERSONAL_VISIT" && visitor.visitor_type && visitor.visitor_type !== "individual") {
          setVisitorLookupState("not_found");
          setFormData(p => ({ ...p, visitor_id: "", visitor_name: "", visitor_email: "" }));
          toast.success("New contact");
          return;
        }
        setVisitorLookupState("found");
        setFoundVisitorData(visitor);
        setFormData(p => ({
          ...p,
          visitor_id: visitor.id || "",
          visitor_name: visitor.full_name || "",
          visitor_email: visitor.email || "",
          company_name: visitor.company_name || p.company_name,
        }));
        if (formData.visit_category === "SPOT") {
          if (visitor.visitor_type === "business" || visitor.company_name) {
            setSelectedCategory("SPOT_BUSINESS");
            setSpotVisitorType("business");
          } else {
            setSelectedCategory("SPOT_INDIVIDUAL");
            setSpotVisitorType("individual");
          }
        }
        toast.success(`Returning visitor found: ${visitor.full_name}`);
      } else {
        setVisitorLookupState("not_found");
        setFormData(p => ({ ...p, visitor_id: "", visitor_name: "", visitor_email: "" }));
        toast.success("New contact");
      }
    } catch {
      setVisitorLookupState("not_found");
    }
  };

  // â”€â”€ Vendor phone lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleVendorLookup = async () => {
    const phone = formData.visitor_phone.trim().replace(/\D/g, "");
    if (phone.length !== 10) {
      toast.error("Please enter a valid 10-digit contact number to look up.");
      return;
    }
    setVendorLookupState("loading");
    try {
      const res = await apiClient.get("/visitors/lookup", { params: { phone } });
      const { found, visitor } = res.data.data;
      if (found && visitor) {
        if (visitor.visitor_type && visitor.visitor_type !== "business") {
          setVendorLookupState("not_found");
          toast.success("New contact");
          return;
        }
        setVendorLookupState("found");
        // Auto-fill contact person name and email from past records
        setFormData(p => ({
          ...p,
          contact_person: visitor.full_name || p.contact_person,
          vendor_email: visitor.email || p.vendor_email,
        }));
        toast.success(`Returning contact found: ${visitor.full_name}`);
      } else {
        setVendorLookupState("not_found");
        toast.success("New contact");
      }
    } catch {
      setVendorLookupState("not_found");
    }
  };

  // Fetch all units on mount for the EMPLOYEE_VISIT unit picker
  useEffect(() => {
    apiClient.get("/units/public")
      .then(res => setUnits(res.data?.data ?? []))
      .catch(() => { });
  }, []);

  // â”€â”€ Time helper: add minutes to "HH:MM" string â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


  // â”€â”€ Standard handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const next = { ...prev, [name]: value };
      // Auto-fill end time when start time changes.
      // Update if: end is empty, end <= new start (invalid), or end is within
      // the auto-30-min window of the new start (was previously auto-set).
      // Only preserve end if user deliberately chose a window > 30 min after new start.
      if (name === 'visit_start_time' && value) {
        const auto30 = addMinutesToTime(value, 30);
        const noEnd = !prev.visit_end_time;
        const endBeforeStart = prev.visit_end_time && prev.visit_end_time <= value;
        const endWithinAuto = prev.visit_end_time && prev.visit_end_time <= auto30;
        if (noEnd || endBeforeStart || endWithinAuto) {
          next.visit_end_time = auto30;
        }
      }
      return next;
    });
  };

  const handleDeptChange = async (e) => {
    const deptId = e.target.value;
    setSelectedDeptId(deptId);
    setFormData((prev) => ({ ...prev, host_user_id: "", department_id: deptId }));
    setHosts([]);

    if (deptId) {
      try {
        const hostsRes = await apiClient.get(`/users/hosts`, {
          params: { department_id: deptId, _t: Date.now() }
        });
        setHosts(hostsRes.data.data || []);
      } catch (err) {
        toast.error("Failed to load hosts for selected department.");
      }
    }
  };

  const handleHostChange = (e) => {
    const hostId = e.target.value;
    const selectedHost = hosts.find((h) => String(h.id) === String(hostId));
    setFormData((prev) => ({
      ...prev,
      host_user_id: hostId,
      department_id: selectedHost ? selectedHost.department_id : prev.department_id,
      organization_id: selectedHost ? selectedHost.organization_id || prev.organization_id : prev.organization_id,
    }));
  };

  // â”€â”€ EMPLOYEE_VISIT handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const resetEmpVisitState = () => {
    setSelectedUnitId("");
    setEmpDeptId("");
    setEmpDepartments([]);
    setSelectedEmpId("");
    setEmployees([]);
    setAllUnitEmployees([]);
  };

  const resetAdminEmpVisitState = () => {
    setAdminVisitorDeptId("");
    setAdminVisitorEmpId("");
    setAdminVisitorAllEmployees([]);
    setAdminVisitorEmployees([]);
    setAdminHostUnitId("");
    setAdminHostDeptId("");
    setAdminHostEmpId("");
    setAdminHostDepts([]);
    setAllAdminHostEmployees([]);
    setAdminHostEmployees([]);
  };

  // Ensure selected unit is not the user's own unit
  useEffect(() => {
    if (selectedUnitId && !otherUnits.some(u => String(u.id) === String(selectedUnitId))) {
      resetEmpVisitState();
    }
  }, [selectedUnitId, otherUnits]);

  useEffect(() => {
    if (adminHostUnitId && !otherUnits.some(u => String(u.id) === String(adminHostUnitId))) {
      resetAdminEmpVisitState();
    }
  }, [adminHostUnitId, otherUnits]);

  const handleEmpUnitChange = async (e) => {
    const uId = e.target.value;
    setSelectedUnitId(uId);
    setEmpDeptId("");
    setEmpDepartments([]);
    setSelectedEmpId("");
    setEmployees([]);
    setAllUnitEmployees([]);
    if (uId) {
      try {
        // Load departments and ALL employees in this unit independently
        const _t = Date.now(); // cache-buster  -  prevents 304 stale responses
        const [deptResult, empResult] = await Promise.allSettled([
          apiClient.get("/departments/public", { params: { unit_id: uId, _t } }),
          apiClient.get("/users/hosts", { params: { unit_id: uId, include_all: 'true', roles: 'employee', _t } }),
        ]);

        let hasDepts = false;
        // Handle departments (independent of employee fetch)
        if (deptResult.status === 'fulfilled') {
          const depts = deptResult.value.data?.data ?? [];
          setEmpDepartments(depts);
          if (depts.length > 0) {
            hasDepts = true;
          }
        } else {
          console.error("[NewRequest] Failed to load departments for unit", uId, deptResult.reason);
        }

        // Handle employees (independent of department fetch)
        if (empResult.status === 'fulfilled') {
          const list = (empResult.value.data?.data ?? []).filter(
            (emp) => !(String(emp.id) === String(user?.id) && String(emp.unit_id) === String(user?.unit_id))
          );
          setAllUnitEmployees(list);
          // If there are departments, we force department selection before listing employees
          if (hasDepts) {
            setEmployees([]);
          } else {
            setEmployees(list);
          }
        } else {
          console.error("[NewRequest] Failed to load employees for unit", uId, empResult.reason);
          toast.error("Failed to load employees from the selected unit.");
        }
      } catch (err) {
        console.error("[NewRequest] Unexpected error in handleEmpUnitChange:", err);
        toast.error("Failed to load unit data.");
      }
    }
  };


  const [allUnitEmployees, setAllUnitEmployees] = useState([]);

  const handleEmpDeptChange = (e) => {
    const dId = e.target.value;
    setEmpDeptId(dId);
    setSelectedEmpId("");
    if (!dId) {
      // Department selection is mandatory; clear employees if unselected
      setEmployees([]);
    } else {
      // Filter client-side strictly by selected department
      const filtered = allUnitEmployees.filter(
        (emp) => String(emp.department_id) === String(dId) && !(String(emp.id) === String(user?.id) && String(emp.unit_id) === String(user?.unit_id))
      );
      setEmployees(filtered);
    }
  };

  const handleAdminVisitorDeptChange = (e) => {
    const dId = e.target.value;
    setAdminVisitorDeptId(dId);
    setAdminVisitorEmpId("");
    if (!dId) {
      setAdminVisitorEmployees(adminVisitorAllEmployees);
    } else {
      const filtered = adminVisitorAllEmployees.filter(emp => String(emp.department_id) === String(dId));
      setAdminVisitorEmployees(filtered);
    }
  };

  const handleAdminHostUnitChange = async (e) => {
    const uId = e.target.value;
    setAdminHostUnitId(uId);
    setAdminHostDeptId("");
    setAdminHostEmpId("");
    setAdminHostDepts([]);
    setAdminHostEmployees([]);
    setAllAdminHostEmployees([]);
    if (uId) {
      try {
        const _t = Date.now();
        const [deptResult, empResult] = await Promise.allSettled([
          apiClient.get("/departments/public", { params: { unit_id: uId, _t } }),
          apiClient.get("/users/hosts", { params: { unit_id: uId, include_all: 'true', roles: 'employee', _t } }),
        ]);

        if (deptResult.status === 'fulfilled') {
          setAdminHostDepts(deptResult.value.data?.data ?? []);
        }
        if (empResult.status === 'fulfilled') {
          setAllAdminHostEmployees(empResult.value.data?.data ?? []);
          setAdminHostEmployees(empResult.value.data?.data ?? []);
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleAdminHostDeptChange = (e) => {
    const dId = e.target.value;
    setAdminHostDeptId(dId);
    setAdminHostEmpId("");
    if (!dId) {
      setAdminHostEmployees(allAdminHostEmployees);
    } else {
      const filtered = allAdminHostEmployees.filter(emp => String(emp.department_id) === String(dId));
      setAdminHostEmployees(filtered);
    }
  };

  // â”€â”€ Category change â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCategoryChange = (categoryId) => {
    setSelectedCategory(categoryId);
    const isSpotInd = categoryId === "SPOT_INDIVIDUAL";
    const isSpotBiz = categoryId === "SPOT_BUSINESS";
    const isSpot = isSpotInd || isSpotBiz || categoryId === "SPOT";
    const resolvedCategory = isSpot ? "SPOT" : categoryId;
    const subType = isSpotBiz ? "business" : "individual";
    setSpotVisitorType(subType);

    const nowTime = isSpot ? getCurrentTimeHHMM() : '';
    const endTime = isSpot ? addMinutesToTime(nowTime, 30) : '';
    const nowDate = isSpot ? getTodayDateYMD() : '';

    setFormData((prev) => {
      const isPrevSpot = prev.visit_category === "SPOT";
      return {
        ...prev,
        visit_category: resolvedCategory,
        host_user_id: isAdminOrStaff ? "" : user?.id || "",
        department_id: isAdminOrStaff ? "" : (resolvedCategory === "EMPLOYEE_VISIT" ? "" : user?.department_id || ""),
        target_unit_id: "",
        visitor_phone: "",
        visitor_name: "",
        visitor_email: "",
        company_name: "",
        vendor_email: "",
        contact_person: "",
        service_type: "",
        work_order_ref: "",
        visitor_id: "",
        visit_date: isSpot ? (isPrevSpot && prev.visit_date ? prev.visit_date : nowDate) : "",
        visit_start_time: isSpot ? (isPrevSpot && prev.visit_start_time ? prev.visit_start_time : nowTime) : "",
        visit_end_time: isSpot ? (isPrevSpot && prev.visit_end_time ? prev.visit_end_time : endTime) : "",
      };
    });
    resetVisitorLookup();
    resetVendorLookup();
    setSelectedDeptId("");
    setHosts([]);
    setVisitMode("visiting");
    resetEmpVisitState();
    resetAdminEmpVisitState();
  };

  // â”€â”€ Companions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const addCompanion = () => {
    setFormData((prev) => ({
      ...prev,
      companions: [...prev.companions, { full_name: "", id_type: "AADHAAR", id_number: "" }],
      accompanying_count: prev.companions.length + 1,
    }));
  };

  const updateCompanion = (index, field, value) => {
    const updated = [...formData.companions];
    if (field === "id_type") {
      updated[index].id_type = value;
      // If switching to AADHAAR, keep only digits and max 12 chars
      if (value === "AADHAAR" && updated[index].id_number) {
        updated[index].id_number = updated[index].id_number.replace(/\D/g, "").slice(0, 12);
      }
    } else if (field === "id_number") {
      if (updated[index].id_type === "AADHAAR") {
        // Aadhaar: only allow numeric digits, max 12
        updated[index].id_number = value.replace(/\D/g, "").slice(0, 12);
      } else {
        updated[index].id_number = value;
      }
    } else {
      updated[index][field] = value;
    }
    setFormData((prev) => ({ ...prev, companions: updated }));
  };

  const removeCompanion = (index) => {
    const updated = formData.companions.filter((_, i) => i !== index);
    setFormData((prev) => ({ ...prev, companions: updated, accompanying_count: updated.length }));
  };

  // â”€â”€ Submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const buildPayload = () => {
    const payload = { ...formData };
    const cat = payload.visit_category;

    if (cat !== "VENDOR" && !(cat === "SPOT" && spotVisitorType === "business")) {
      delete payload.company_name;
      delete payload.vendor_email;
      delete payload.contact_person;
      delete payload.gst_number;
      delete payload.work_order_ref;
      delete payload.service_type;
    }

    if (cat === "EMPLOYEE_VISIT") {
      if (isAdminEmpVisit) {
        const selectedVisitor = adminVisitorAllEmployees.find(emp => String(emp.id) === String(adminVisitorEmpId));
        payload.visitor_name = selectedVisitor?.full_name || null;
        payload.visitor_phone = selectedVisitor?.phone || null;
        payload.visitor_email = selectedVisitor?.email || null;
        payload.visitor_user_id = Number(selectedVisitor?.id) || null;
        payload.visitor_unit_id = Number(selectedVisitor?.unit_id || user?.unit_id) || null;
        payload.host_user_id = Number(adminHostEmpId) || null;
        payload.department_id = Number(adminHostDeptId) || null;
        payload.target_unit_id = Number(adminHostUnitId) || null;
        payload.request_source = "HOST";
      } else {
        const isVisiting = visitMode === "visiting";
        const isHosting = visitMode === "hosting";
        payload.request_source = isVisiting ? "SELF" : "HOST";
        if (isVisiting) {
          payload.visitor_name = user?.full_name || null;
          payload.visitor_phone = user?.phone || null;
          payload.visitor_email = user?.email || null;
          payload.visitor_user_id = Number(user?.id) || null;
          payload.visitor_unit_id = Number(user?.unit_id) || null;
          payload.host_user_id = Number(selectedEmpId) || null;
          payload.department_id = Number(empDeptId) || null;
          payload.target_unit_id = Number(selectedUnitId) || null;
        } else if (isHosting) {
          const selectedEmp = employees.find(emp => String(emp.id) === String(selectedEmpId));
          payload.visitor_name = selectedEmp?.full_name || null;
          payload.visitor_phone = selectedEmp?.phone || null;
          payload.visitor_email = selectedEmp?.email || null;
          payload.visitor_user_id = Number(selectedEmp?.id) || null;
          payload.visitor_unit_id = Number(selectedUnitId || selectedEmp?.unit_id) || null;
          // Hosting mode: request is always stored in the HOST's own unit DB.
          // Do NOT send target_unit_id — that would wrongly route the INSERT to the
          // visitor's unit DB where the host_user_id doesn't exist (FK violation).
          payload.target_unit_id = null;
        }
      }
      if (payload.visitor_user_id) payload.visitor_user_id = Number(payload.visitor_user_id);
      if (payload.visitor_unit_id) payload.visitor_unit_id = Number(payload.visitor_unit_id);
      if (payload.host_user_id) payload.host_user_id = Number(payload.host_user_id);
      if (payload.department_id) payload.department_id = Number(payload.department_id);
      if (payload.target_unit_id) payload.target_unit_id = Number(payload.target_unit_id);
    } else {
      payload.visitor_phone = formData.visitor_phone?.trim() || null;
      if (cat === 'VENDOR') {
        payload.visitor_name = formData.contact_person?.trim() || formData.company_name?.trim() || null;
        payload.visitor_email = formData.vendor_email?.trim() || null;
      } else {
        payload.visitor_name = formData.visitor_name?.trim() || null;
        payload.visitor_email = formData.visitor_email?.trim() || null;
      }
      payload.visitor_id = null;
      payload.host_user_id = Number(payload.host_user_id) || user?.id || null;
      payload.department_id = Number(payload.department_id) || user?.department_id || null;
      payload.organization_id = Number(payload.organization_id) || null;
    }

    payload.accompanying_count = Number(payload.accompanying_count);
    if (!payload.visit_start_time) payload.visit_start_time = null;
    if (!payload.visit_end_time) payload.visit_end_time = null;
    delete payload.visitor_id;
    return payload;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // â”€â”€ Time order validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { visit_start_time, visit_end_time } = formData;
    if (visit_start_time && visit_end_time && visit_end_time <= visit_start_time) {
      toast.error('End time must be after start time.');
      return;
    }

    // Companion Aadhaar validation
    for (let i = 0; i < formData.companions.length; i++) {
      const comp = formData.companions[i];
      const name = comp.full_name?.trim() || `Companion ${i + 1}`;
      if (comp.id_type === "AADHAAR") {
        const cleanAadhaar = (comp.id_number || "").replace(/[\s-]/g, "");
        if (!/^\d{12}$/.test(cleanAadhaar)) {
          toast.error(`${name}: Aadhaar number must be exactly 12 digits.`);
          return;
        }
      }
    }

    // Visitor phone validation for non-employee visits
    if (["SPOT", "PERSONAL_VISIT", "VENDOR"].includes(formData.visit_category)) {
      const cleanPhone = (formData.visitor_phone || "").replace(/\D/g, "");
      if (cleanPhone.length !== 10) {
        toast.error("Please enter a valid 10-digit mobile number.");
        return;
      }
    }

    if (formData.visit_category === "SPOT" && spotVisitorType === "business" && !formData.company_name?.trim()) {
      toast.error("Company / Organization name is required for vendor/business walk-in visits.");
      return;
    }

    setLoading(true);
    try {
      const payload = buildPayload();
      await apiClient.post("/visit-requests", payload);
      toast.success("Visit request created successfully");
      navigate("/requests");
    } catch (error) {
      const data = error.response?.data;
      // ── Conflict detected → show confirmation modal instead of toast ──
      if (error.response?.status === 409 && data?.conflict) {
        setConflictModal({
          types: data.types || [],
          host_conflict: data.host_conflict || null,
          visitor_conflict: data.visitor_conflict || null,
          pendingPayload: buildPayload(),
        });
        setLoading(false);
        return;
      }
      console.error('[NewRequest] Submit error:', error.response?.data);
      // 409 conflict is handled above; all other errors use field-level extraction
      toast.error(getApiErrorMessage(error, "Failed to create request."), { duration: 6000 });
    } finally {
      setLoading(false);
    }
  };

  // â”€â”€ Force submit (override conflict) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleForceSubmit = async () => {
    if (!conflictModal) return;
    setLoading(true);
    setConflictModal(null);
    try {
      const payload = { ...conflictModal.pendingPayload, force_create: true };
      await apiClient.post("/visit-requests", payload);
      toast.success("Visit request created (conflict overridden).");
      navigate("/requests");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to create request."));
    } finally {
      setLoading(false);
    }
  };

  // â”€â”€ Derived booleans â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const isUnitAdmin = user?.role_type === "unit_admin";
  const isSuperAdminUser = user?.role_type === "super_admin";
  // Super Admin can create emp-visit only when managing a unit
  const isAdminEmpVisit = (isUnitAdmin || (isSuperAdminUser && !!activeUnit));
  const cat = formData.visit_category;
  const isVendor = cat === "VENDOR";
  const isSpotBusiness = cat === "SPOT" && spotVisitorType === "business";
  const isVendorBusiness = isVendor || isSpotBusiness;
  const isEmpVisit = cat === "EMPLOYEE_VISIT";
  const isSelfHosting = !isAdminOrStaff && !isEmpVisit && !isUnitAdmin;

  // Hide the standard visitor phone fields for VENDOR / SPOT_BUSINESS (they have their own Vendor Details card)
  const showVisitorFields = !isVendorBusiness && !isEmpVisit;
  const showHostPicker = (!isSelfHosting || isUnitAdmin) && !isEmpVisit;

  // Shared input style
  const inputCls = "w-full bg-bg-primary border-0 border-b border-subtle px-3 py-2.5 text-loud focus:ring-0 focus:border-border transition-colors duration-300";

  return (
    <div className=" mx-auto py-5 px-4 sm:px-6 lg:px-8 animate-fade-in">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-loud">
          New Request
        </h1>

      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* â”€â”€ Step 1: Category Selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className=" rounded-md  ">
          <h2 className="text-sm text-loud mb-6 flex items-center gap-2">
            <span className="w-6 h-6 rounded-sm bg-mixed-bg text-loud flex items-center justify-center text-sm font-bold">
              1
            </span>
            Visit Category
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {availableCategories.map((c) => {
              const isSelected = selectedCategory === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleCategoryChange(c.id)}
                  className={`p-3.5 text-sm rounded-md border text-left transition-all duration-300 ${isSelected
                      ? "border-border bg-mixed-bg shadow-soft-sm"
                      : "border-subtle hover:border-border hover:bg-bg-primary"
                    }`}
                >
                  <div className={`font-semibold ${isSelected ? "text-accent" : "text-loud"}`}>
                    {c.label}
                  </div>
                  {c.desc && (
                    <div className="text-xs text-muted mt-1 leading-relaxed">
                      {c.desc}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* â”€â”€ Step 2: Visit Details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className=" rounded-md ">
          <h2 className="text-sm text-loud mb-6 flex items-center gap-2">
            <span className="w-6 h-6 rounded-sm bg-mixed-bg text-loud flex items-center justify-center text-sm font-bold">
              2
            </span>
            Visit Details
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Date */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-loud flex items-center gap-2">
                <Calendar className="w-4 h-4 text-accent" />
                Visit Date *
              </label>
              <input
                type="date"
                name="visit_date"
                required
                value={formData.visit_date}
                onChange={handleInputChange}
                className={inputCls}
              />
            </div>

            {/* Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-loud flex items-center gap-2">
                  <Clock className="w-4 h-4 text-accent" />
                  Start Time
                </label>
                <input
                  type="time"
                  name="visit_start_time"
                  value={formData.visit_start_time}
                  onChange={handleInputChange}
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-loud">End Time</label>
                <input
                  type="time"
                  name="visit_end_time"
                  min={formData.visit_start_time || undefined}
                  value={formData.visit_end_time}
                  onChange={handleInputChange}
                  className={inputCls}
                />
                {formData.visit_start_time && formData.visit_end_time && formData.visit_end_time <= formData.visit_start_time && (
                  <p className="text-xs font-medium" style={{ color: '#ef4444' }}>
                    &#9888; End time must be after {formData.visit_start_time}
                  </p>
                )}
              </div>
            </div>

            {/* Employee Visit - mode selector + cascading employee picker */}
            {isEmpVisit && !isAdminEmpVisit && (
              <div className="md:col-span-2 space-y-5">

                {/* Mode toggle */}
                <div>
                  <label className="block text-sm font-medium text-loud mb-2">
                    What are you doing?
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { mode: "visiting", label: "I'm visiting someone", desc: "You are the visitor  -  they must approve" },
                      { mode: "hosting", label: "I'm hosting someone", desc: "You are the host  -  auto-approved" },
                    ].map(({ mode, label, desc }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => { setVisitMode(mode); resetEmpVisitState(); }}
                        className={`p-3 rounded-md border text-left transition-all duration-200 ${visitMode === mode
                            ? "border-border bg-mixed-bg"
                            : "border-subtle hover:border-border"
                          }`}
                      >
                        <div className={`font-medium text-sm ${visitMode === mode ? "text-accent" : "text-loud"}`}>
                          {label}
                        </div>
                        <div className="text-xs text-muted mt-0.5">{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* My role display */}
                <div className="p-3 rounded-md border border-subtle bg-bg-primary text-sm">
                  <p className="text-loud">
                    <span className="text-faint text-xs uppercase tracking-wider block mb-0.5">
                      {visitMode === "visiting" ? "Visitor (You)" : "Host (You)"}
                    </span>
                    {user?.full_name}  -  {user?.designation || user?.role_type}
                  </p>
                </div>

                {/* Unit picker */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-loud flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-accent" />
                    {visitMode === "visiting" ? "Select Unit to Visit *" : "Select Visitor's Unit *"}
                  </label>
                  <select
                    value={selectedUnitId}
                    onChange={handleEmpUnitChange}
                    required
                    className={inputCls}
                  >
                    <option value="">
                      {units.length > 0 && otherUnits.length === 0
                        ? " -  No other units available  - "
                        : " -  Select Unit  - "}
                    </option>
                    {otherUnits.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.city ? `  -  ${u.city}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Department picker  -  mandatory */}
                {selectedUnitId && empDepartments.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-loud flex items-center gap-1.5">
                      <Building className="w-4 h-4 text-accent" />
                      Select Department *
                    </label>
                    <select
                      value={empDeptId}
                      onChange={handleEmpDeptChange}
                      required
                      className={inputCls}
                    >
                      <option value=""> -  Select Department  - </option>
                      {empDepartments.map(d => (
                        <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Employee picker  -  disabled until department is selected if departments exist */}
                {selectedUnitId && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-loud flex items-center gap-1.5">
                      <User className="w-4 h-4 text-accent" />
                      {visitMode === "visiting" ? "Select Host Employee *" : "Select Visitor (Employee) *"}
                      {employees.length > 0 && (
                        <span className="text-xs text-faint font-normal ml-1">({employees.length} found)</span>
                      )}
                    </label>
                    <select
                      value={selectedEmpId}
                      onChange={e => setSelectedEmpId(e.target.value)}
                      required
                      disabled={empDepartments.length > 0 ? !empDeptId || employees.length === 0 : employees.length === 0}
                      className={`${inputCls} disabled:opacity-50`}
                    >
                      <option value="">
                        {empDepartments.length > 0 && !empDeptId
                          ? " -  Select Department First  - "
                          : employees.length === 0
                            ? (empDepartments.length > 0 ? " -  No users found in this department  - " : " -  No users found in this unit  - ")
                            : " -  Select Person  - "
                        }
                      </option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.full_name} ({emp.department_name ? `${emp.department_name}  ·  ` : ''}{emp.designation_name || emp.role_type})
                        </option>
                      ))}
                    </select>
                    {visitMode === "hosting" && (
                      <p className="text-xs text-faint mt-1">
                        &#10003; This request will be auto-approved since you are the host.
                      </p>
                    )}
                    {visitMode === "visiting" && (
                      <p className="text-xs text-faint mt-1">
                        &#9203; The selected person will need to approve your visit.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* â”€â”€ EMPLOYEE VISIT for Unit Admin & Super Admin (while managing a unit) â”€â”€ */}
            {isEmpVisit && isAdminEmpVisit && (
              <div className="md:col-span-2 space-y-6">

                {/* Section header or info */}
                <div className="p-4 rounded-md border border-subtle bg-mixed-bg text-sm">
                  <p className="text-loud font-medium">
                    Arrange Employee Visit
                  </p>
                  <p className="text-xs text-muted mt-1">
                    {isSuperAdminUser
                      ? `Select a visitor from the managed unit (${activeUnit?.name}) and a host from any unit.`
                      : "Select a visitor from your unit and a host from any unit."
                    }
                  </p>
                </div>

                {/* VISITOR SIDE: Fixed to admin's own unit */}
                <div className="space-y-4 p-5 rounded-md border border-subtle bg-bg-primary/30">
                  <h3 className="text-sm font-semibold text-accent uppercase tracking-wider flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Visitor (From: {isSuperAdminUser ? (activeUnit?.name || 'Managed Unit') : (user?.unit_name || 'My Unit')})
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Visitor Department */}
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-muted">Select Department</label>
                      <select
                        value={adminVisitorDeptId}
                        onChange={handleAdminVisitorDeptChange}
                        className={inputCls}
                      >
                        <option value=""> -  All Departments  - </option>
                        {departments.map(d => (
                          <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                        ))}
                      </select>
                    </div>

                    {/* Visitor Employee */}
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-muted">Select Employee *</label>
                      <select
                        value={adminVisitorEmpId}
                        onChange={e => setAdminVisitorEmpId(e.target.value)}
                        required
                        disabled={adminVisitorEmployees.length === 0}
                        className={`${inputCls} disabled:opacity-50`}
                      >
                        <option value="">
                          {adminVisitorEmployees.length === 0 ? " -  No users found  - " : " -  Select Person  - "}
                        </option>
                        {adminVisitorEmployees.map(emp => (
                          <option key={emp.id} value={emp.id}>
                            {emp.full_name} ({emp.department_name ? `${emp.department_name}  ·  ` : ''}{emp.designation_name || emp.role_type})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* HOST SIDE: Pick any unit */}
                <div className="space-y-4 p-5 rounded-md border border-subtle bg-bg-primary/30">
                  <h3 className="text-sm font-semibold text-accent uppercase tracking-wider flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    Host (Any Unit)
                  </h3>

                  <div className="space-y-4">
                    {/* Host Unit */}
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-muted">Select Host's Unit *</label>
                      <select
                        value={adminHostUnitId}
                        onChange={handleAdminHostUnitChange}
                        required
                        className={inputCls}
                      >
                        <option value="">
                          {units.length > 0 && otherUnits.length === 0
                            ? " -  No other units available  - "
                            : " -  Select Unit  - "}
                        </option>
                        {otherUnits.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.name}{u.city ? `  -  ${u.city}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    {adminHostUnitId && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Host Department */}
                        {adminHostDepts.length > 0 && (
                          <div className="space-y-2">
                            <label className="block text-xs font-medium text-muted">Filter by Department</label>
                            <select
                              value={adminHostDeptId}
                              onChange={handleAdminHostDeptChange}
                              className={inputCls}
                            >
                              <option value=""> -  All Departments  - </option>
                              {adminHostDepts.map(d => (
                                <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Host Employee */}
                        <div className="space-y-2">
                          <label className="block text-xs font-medium text-muted">Select Host *</label>
                          <select
                            value={adminHostEmpId}
                            onChange={e => setAdminHostEmpId(e.target.value)}
                            required
                            disabled={adminHostEmployees.length === 0}
                            className={`${inputCls} disabled:opacity-50`}
                          >
                            <option value="">
                              {adminHostEmployees.length === 0 ? " -  No users found  - " : " -  Select Person  - "}
                            </option>
                            {adminHostEmployees.map(emp => (
                              <option key={emp.id} value={emp.id}>
                                {emp.full_name} ({emp.department_name ? `${emp.department_name}  ·  ` : ''}{emp.designation_name || emp.role_type})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* â”€â”€ Standard Visitor / Host section (non-EMPLOYEE_VISIT) â”€â”€â”€â”€â”€â”€â”€â”€ */}
            {(() => {
              return (
                <>
                  {/* Visitor Section */}
                  {showVisitorFields ? (
                    <div className="space-y-4 md:col-span-2">
                      <label className="text-sm font-medium text-loud flex items-center gap-2">
                        <Phone className="w-4 h-4 text-accent" />
                        {cat === "SPOT" && spotVisitorType === "business" ? "Representative Mobile Number *" : "Visitor Mobile Number *"}
                      </label>

                      {/* Phone + Lookup button */}
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          placeholder="10-digit mobile number"
                          maxLength={10}
                          value={formData.visitor_phone}
                          onChange={e => {
                            const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                            setFormData(p => ({ ...p, visitor_phone: val, visitor_name: '', visitor_email: '', visitor_id: '' }));
                            resetVisitorLookup();
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleVisitorLookup(); } }}
                          required
                          className={`${inputCls} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={handleVisitorLookup}
                          disabled={visitorLookupState === 'loading' || formData.visitor_phone?.length !== 10}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 disabled:opacity-50 shrink-0"
                          style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}
                        >
                          {visitorLookupState === 'loading'
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Search className="w-4 h-4" />}
                          {visitorLookupState === 'loading' ? 'Looking up...' : 'Lookup'}
                        </button>
                      </div>
                      {visitorLookupState === 'idle' && formData.visitor_phone?.length > 0 && formData.visitor_phone?.length < 10 && (
                        <p className="text-xs text-amber-500">
                          Please enter a valid 10-digit mobile number
                        </p>
                      )}

                      {/* Status banners */}
                      {visitorLookupState === 'found' && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm"
                          style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span><strong>Returning visitor</strong> — details auto-filled from our records.</span>
                        </div>
                      )}
                      {visitorLookupState === 'not_found' && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm"
                          style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span><strong>New visitor</strong> — fill in the details below. They will be saved automatically.</span>
                        </div>
                      )}
                      {visitorLookupState === 'idle' && (!formData.visitor_phone || formData.visitor_phone.length === 0) && (
                        <p className="text-xs text-faint">
                          Enter a valid 10-digit mobile number and click <strong>Lookup</strong>.
                          Details auto-fill for returning visitors.
                        </p>
                      )}

                      {/* Name + Email shown after lookup */}
                      {(visitorLookupState === 'found' || visitorLookupState === 'not_found') && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-faint uppercase tracking-wider">
                                {cat === "SPOT" && spotVisitorType === "business" ? "Representative Full Name *" : "Full Name *"}
                              </label>
                              <input
                                type="text"
                                required
                                readOnly={visitorLookupState === 'found'}
                                value={formData.visitor_name}
                                onChange={e => setFormData(p => ({ ...p, visitor_name: e.target.value }))}
                                placeholder={cat === "SPOT" && spotVisitorType === "business" ? "Representative full name" : "Visitor full name"}
                                className={`${inputCls}${visitorLookupState === 'found' ? ' opacity-60 cursor-default' : ''}`}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-faint uppercase tracking-wider">Email (optional)</label>
                              <input
                                type="email"
                                readOnly={visitorLookupState === 'found'}
                                value={formData.visitor_email}
                                onChange={e => setFormData(p => ({ ...p, visitor_email: e.target.value }))}
                                placeholder="visitor@email.com"
                                className={`${inputCls}${visitorLookupState === 'found' ? ' opacity-60 cursor-default' : ''}`}
                              />
                            </div>
                          </div>

                          {/* Vendor/Business specific fields for SPOT walk-in */}
                          {cat === "SPOT" && spotVisitorType === "business" && (
                            <div className="p-4 rounded-xl border border-accent/20 bg-accent/5 space-y-4 animate-fade-in">
                              <div className="flex items-center gap-2 text-accent text-xs font-bold uppercase tracking-wider">
                                <Building className="w-4 h-4" />
                                <span>Vendor / Organization Details</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1 sm:col-span-2">
                                  <label className="block text-xs font-semibold text-muted">
                                    Company / Vendor Name *
                                  </label>
                                  <input
                                    type="text"
                                    name="company_name"
                                    required
                                    value={formData.company_name}
                                    onChange={handleInputChange}
                                    placeholder="e.g., L&T Hydro, BHEL, Siemens, Schneider Electric"
                                    className={inputCls}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="block text-xs font-semibold text-muted">
                                    Service / Work Nature (optional)
                                  </label>
                                  <input
                                    type="text"
                                    name="service_type"
                                    value={formData.service_type}
                                    onChange={handleInputChange}
                                    placeholder="e.g., Transformer maintenance, cable supply"
                                    className={inputCls}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="block text-xs font-semibold text-muted">
                                    Work Order / Reference # (optional)
                                  </label>
                                  <input
                                    type="text"
                                    name="work_order_ref"
                                    value={formData.work_order_ref}
                                    onChange={handleInputChange}
                                    placeholder="e.g., WO-2026-0812"
                                    className={inputCls}
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* Department Section */}
                  {showHostPicker && (
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm font-medium text-loud flex items-center gap-2">
                        <Building className="w-4 h-4 text-accent" />
                        Select Department *
                      </label>
                      <select
                        name="selected_department_id"
                        required
                        value={selectedDeptId}
                        onChange={handleDeptChange}
                        className={inputCls}
                      >
                        <option value="">-- Select Department --</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Host Section */}
                  {showHostPicker ? (
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm font-medium text-loud flex items-center gap-2">
                        <Building className="w-4 h-4 text-accent" />
                        Select Host (Employee) *
                      </label>
                      <select
                        name="host_user_id"
                        required
                        value={formData.host_user_id}
                        onChange={handleHostChange}
                        disabled={!selectedDeptId}
                        className={`${inputCls} disabled:opacity-50`}
                      >
                        <option value="">
                          {!selectedDeptId ? "-- Select Department First --" : "-- Select Host Employee --"}
                        </option>
                        {hosts.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.full_name} ({h.department_name || h.designation || h.role_type})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : !isEmpVisit ? (
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm font-medium text-loud flex items-center gap-2">
                        <Building className="w-4 h-4 text-accent" />
                        Host (You)
                      </label>
                      <div className="py-2 text-loud font-medium border-b border-subtle">
                        {user?.full_name}  -  {user?.designation || user?.role}
                      </div>
                      <input type="hidden" name="host_user_id" value={user?.id || ""} />
                    </div>
                  ) : null}
                </>
              );
            })()}

            {/* Purpose */}
            <div className="space-y-2 md:col-span-2">
              <label className="block text-sm font-medium text-loud">
                Purpose of Visit *
              </label>
              <textarea
                name="purpose"
                required
                minLength={10}
                rows="2"
                value={formData.purpose}
                onChange={handleInputChange}
                className={`${inputCls} resize-none`}
                placeholder="Brief description of the visit purpose (min 10 chars)..."
              />
            </div>
          </div>
        </div>


        {/* â”€â”€ Step 3: Vendor Details (conditional) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {isVendorBusiness && (
          <div className="vms-card rounded-md p-8 shadow-card animate-fade-in">
            <h2 className="text-xl text-loud mb-6 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
                3
              </span>
              <Building className="w-5 h-5 text-accent" />
              {isSpotBusiness ? "Vendor / Business Details" : "Vendor Details"}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Company Name */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-loud">Company Name *</label>
                <input type="text" name="company_name" required value={formData.company_name} onChange={handleInputChange} className={inputCls} />
              </div>

              {/* Email Address */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-loud">Email Address</label>
                <input
                  type="email" name="vendor_email"
                  value={formData.vendor_email}
                  onChange={handleInputChange}
                  readOnly={vendorLookupState === 'found'}
                  className={`${inputCls}${vendorLookupState === 'found' ? ' opacity-60 cursor-default' : ''}`}
                  placeholder="For gate pass delivery"
                />
              </div>

              {/* Contact Phone with Lookup  -  full width */}
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-loud flex items-center gap-2">
                  <Phone className="w-4 h-4 text-accent" />
                  Contact Phone *
                </label>
                <div className="flex gap-2">
                  <input
                    type="tel" name="visitor_phone" required
                    placeholder="10-digit contact / mobile number"
                    maxLength={10}
                    value={formData.visitor_phone}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setFormData(p => ({ ...p, visitor_phone: val, contact_person: '' }));
                      resetVendorLookup();
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleVendorLookup(); } }}
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={handleVendorLookup}
                    disabled={vendorLookupState === 'loading' || formData.visitor_phone?.length !== 10}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 disabled:opacity-50 shrink-0"
                    style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}
                  >
                    {vendorLookupState === 'loading'
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Search className="w-4 h-4" />}
                    {vendorLookupState === 'loading' ? 'Looking up...' : 'Lookup'}
                  </button>
                </div>
                {vendorLookupState === 'idle' && formData.visitor_phone?.length > 0 && formData.visitor_phone?.length < 10 && (
                  <p className="text-xs text-amber-500">
                    Please enter a valid 10-digit mobile number
                  </p>
                )}
                {vendorLookupState === 'found' && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm"
                    style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span><strong>Returning contact</strong>  -  name and email auto-filled from previous visit.</span>
                  </div>
                )}
                {vendorLookupState === 'not_found' && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm"
                    style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span><strong>New contact</strong>  -  fill in the name below.</span>
                  </div>
                )}
                {vendorLookupState === 'idle' && (!formData.visitor_phone || formData.visitor_phone.length === 0) && (
                  <p className="text-xs text-faint">
                    Enter a valid 10-digit mobile number and click <strong>Lookup</strong> to auto-fill details.
                  </p>
                )}
              </div>

              {/* Contact Person  -  auto-filled or manual */}
              <div className="space-y-2 md:col-span-2">
                <label className="block text-sm font-medium text-loud">Contact Person *</label>
                <input
                  type="text" name="contact_person" required
                  value={formData.contact_person}
                  onChange={e => setFormData(p => ({ ...p, contact_person: e.target.value, visitor_name: e.target.value }))}
                  readOnly={vendorLookupState === 'found'}
                  placeholder="Representative's full name"
                  className={`${inputCls}${vendorLookupState === 'found' ? ' opacity-60 cursor-default' : ''}`}
                />
              </div>

              {/* Service Type */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-loud">Service Type</label>
                <input type="text" name="service_type" value={formData.service_type} onChange={handleInputChange} className={inputCls} placeholder="e.g. AC Maintenance, Delivery" />
              </div>

              {/* Work Order Ref */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-loud">Work Order Ref</label>
                <input type="text" name="work_order_ref" value={formData.work_order_ref} onChange={handleInputChange} className={inputCls} />
              </div>
            </div>
          </div>
        )}

        {/* â”€â”€ Companions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className=" rounded-md ">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
            <h2 className="text-sm text-loud flex items-center gap-2">
              <span className="w-6 h-6 rounded-sm bg-mixed-bg text-loud flex items-center justify-center text-sm font-bold shrink-0">
                {isVendorBusiness ? "4" : "3"}
              </span>
              <Users className="w-5 h-5 text-accent shrink-0" />
              <span>Companions <span className="text-base font-normal text-muted">({formData.accompanying_count})</span></span>
            </h2>
            <button
              type="button"
              onClick={addCompanion}
              className="btn-secondary text-accent text-xs font-medium uppercase tracking-wider hover:bg-mixed-bg transition-colors flex items-center gap-1 self-start sm:self-auto"
            >
              <Plus className="w-3 h-3" /> Add Companion
            </button>
          </div>


          {formData.companions.length === 0 ? (
            <div className="text-center py-6 text-faint italic border border-dashed border-subtle rounded-md">
              No companions added.
            </div>
          ) : (
            <div className="space-y-4">
              {formData.companions.map((comp, idx) => (
                <div
                  key={idx}
                  className="flex flex-col sm:flex-row gap-4 items-start sm:items-center bg-bg-secondary p-4 rounded-md border border-subtle"
                >
                  <div className="flex-1 space-y-1 w-full">
                    <input
                      type="text"
                      placeholder="Full Name"
                      required
                      value={comp.full_name}
                      onChange={(e) => updateCompanion(idx, "full_name", e.target.value)}
                      className="w-full outline-none bg-bg-primary px-2 border-0 border-b border-subtle  py-2 text-sm text-loud focus:ring-0 focus:border-border"
                    />
                  </div>
                  <div className="flex-1 space-y-1 w-full">
                    <select
                      value={comp.id_type}
                      onChange={(e) => updateCompanion(idx, "id_type", e.target.value)}
                      className="w-full bg-bg-primary outline-none  border-0 border-b border-subtle px-2 py-2 text-sm text-loud focus:ring-0 focus:border-border"
                    >
                      <option value="AADHAAR">Aadhaar</option>
                      <option value="PAN">PAN</option>
                      <option value="DRIVING_LICENSE">Driving License</option>
                      <option value="PASSPORT">Passport</option>
                    </select>
                  </div>
                  <div className="flex-1 space-y-1 w-full">
                    <input
                      type="text"
                      placeholder={comp.id_type === "AADHAAR" ? "12-digit Aadhaar Number" : "ID Number"}
                      required
                      value={comp.id_number}
                      maxLength={comp.id_type === "AADHAAR" ? 12 : 50}
                      onChange={(e) => updateCompanion(idx, "id_number", e.target.value)}
                      className={`w-full bg-bg-primary px-2 border-0 border-b py-2 text-sm text-loud focus:ring-0 focus:border-border transition-colors ${comp.id_type === "AADHAAR" && comp.id_number && comp.id_number.length !== 12
                          ? "border-red-500 focus:border-red-500"
                          : "border-subtle"
                        }`}
                    />
                    {comp.id_type === "AADHAAR" && comp.id_number && comp.id_number.length !== 12 && (
                      <p className="text-xs text-red-500 pt-0.5">
                        Aadhaar must be exactly 12 digits
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCompanion(idx)}
                    className="p-2 text-color  rounded-sm transition-colors self-end sm:self-auto"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* â”€â”€ Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="flex justify-end gap-4 pt-4">
          <button
            type="button"
            onClick={() => navigate("/requests")}
            className="btn-secondary text-accent uppercase tracking-widest text-sm font-medium hover:bg-mixed-bg transition-colors duration-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary text-white uppercase tracking-widest text-sm font-medium hover:bg-accent transition-colors duration-300 shadow-card hover:shadow-hover disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              "Submitting..."
            ) : (
              <>
                <Check className="w-4 h-4" />
                Submit Request
              </>
            )}
          </button>
        </div>
      </form>

      {/* â”€â”€ Schedule Conflict Modal  -  portalled to document.body to escape transform containing block â”€â”€ */}
      {conflictModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setConflictModal(null)}
          />
          {/* Dialog */}
          <div
            className="relative w-full max-w-md rounded-xl shadow-2xl overflow-hidden"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
          >
            {/* Header */}
            <div
              className="flex items-start justify-between px-6 pt-5 pb-4"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: '#fef3c7' }}
                >
                  <AlertTriangle className="w-5 h-5" style={{ color: 'var(--color-warning)' }} strokeWidth={2} />
                </div>
                <div>
                  <h3 className="font-bold text-base" style={{ color: 'var(--color-text)' }}>
                    Schedule Conflict Detected
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-faint)' }}>
                    Review the conflicts below before proceeding
                  </p>
                </div>
              </div>
              <button
                onClick={() => setConflictModal(null)}
                className="p-1 rounded-full hover:bg-bg-primary transition-colors"
                style={{ color: 'var(--color-text-faint)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Conflict details */}
            <div className="px-6 py-4 space-y-3">
              {/* HOST_BUSY */}
              {conflictModal.types.includes('HOST_BUSY') && conflictModal.host_conflict && (
                <div
                  className="rounded-lg px-4 py-3 space-y-1"
                  style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}
                >
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#c2410c' }}>
                    &#128308; Host is already busy
                  </p>
                  <p className="text-sm" style={{ color: '#9a3412' }}>
                    <strong>{conflictModal.host_conflict.visitor_name}</strong> is already visiting the host during{' '}
                    <strong>{conflictModal.host_conflict.time_window}</strong>.
                  </p>
                </div>
              )}

              {/* VISITOR_BUSY */}
              {conflictModal.types.includes('VISITOR_BUSY') && conflictModal.visitor_conflict && (
                <div
                  className="rounded-lg px-4 py-3 space-y-1"
                  style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}
                >
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#c2410c' }}>
                    &#128308; Visitor already has another visit
                  </p>
                  <p className="text-sm" style={{ color: '#9a3412' }}>
                    This visitor already has a request at{' '}
                    <strong>{conflictModal.visitor_conflict.dept_name}</strong> during{' '}
                    <strong>{conflictModal.visitor_conflict.time_window}</strong>.
                  </p>
                </div>
              )}

              <p className="text-xs pt-1" style={{ color: 'var(--color-text-faint)' }}>
                You can go back and adjust the time, or continue anyway to override the conflict.
                Overridden requests are flagged with a &#9888; badge for admin review.
              </p>
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-end gap-3 px-6 py-4"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <button
                onClick={() => setConflictModal(null)}
                className="btn-secondary text-sm px-5 py-2"
              >
                Go Back &amp; Change Time
              </button>
              <button
                onClick={handleForceSubmit}
                disabled={loading}
                className="btn-primary text-sm px-5 py-2 flex items-center gap-2 disabled:opacity-60"
                style={{ background: 'var(--color-accent)', color: '#fff' }}
              >
                {loading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />
                }
                Continue Anyway
              </button>
            </div>
          </div>
        </div>
        , document.body)}



    </div>
  );
}

