import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Check,
  Plus,
  Trash2,
  Calendar,
  Building,
  User,
  Users,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  AlertTriangle,
  CreditCard,
  Camera,
} from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import { getApiErrorMessage } from "../../utils/apiError";
import Select from "../../components/Select";
import { PageHeader, SectionTitle, Field, Modal, Note } from "../../components/ui";
import PhotoCapture from "../../components/PhotoCapture";
import { ID_PROOFS, cleanIdNumber, idProofError } from "../../lib/idProof";

// ── Category definitions ───────────────────────────────────────────────────────
const ALL_CATEGORIES = [
  { id: "EMPLOYEE_VISIT", label: "Employee Visit", desc: "Visit or invite a fellow employee" },
  { id: "PERSONAL_VISIT", label: "Personal Visit", desc: "Family / friend visiting you" },
  { id: "VENDOR", label: "Vendor / Contractor", desc: "Service and maintenance vendor" },
  { id: "SPOT_INDIVIDUAL", label: "Individual walk-in", desc: "Unplanned visit by a person" },
  { id: "SPOT_BUSINESS", label: "Vendor / business walk-in", desc: "Unplanned visit for a company" },
];

const ROLE_CATEGORIES = {
  security: ["SPOT_INDIVIDUAL", "SPOT_BUSINESS"],
  employee: ["EMPLOYEE_VISIT", "PERSONAL_VISIT", "VENDOR"],
  unit_admin: ["EMPLOYEE_VISIT", "VENDOR", "SPOT_INDIVIDUAL", "SPOT_BUSINESS"],
  super_admin: ["EMPLOYEE_VISIT", "VENDOR", "SPOT_INDIVIDUAL", "SPOT_BUSINESS"],
  receptionist: ["EMPLOYEE_VISIT", "VENDOR", "SPOT_INDIVIDUAL", "SPOT_BUSINESS"],
  org_admin: ["EMPLOYEE_VISIT", "PERSONAL_VISIT", "VENDOR", "SPOT_INDIVIDUAL", "SPOT_BUSINESS"],
};

// ── Time & date helpers (walk-ins default to today, now → +30 min) ─────────────
const getTodayDateYMD = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const getCurrentTimeHHMM = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
};
const addMinutesToTime = (timeStr, minutes = 30) => {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const isSpotId = (id) => id === "SPOT" || id === "SPOT_INDIVIDUAL" || id === "SPOT_BUSINESS";

/** Where an ID proof / photo on record came from. */
const RECORD_SOURCE = {
  profile:        "the visitor's portal profile",
  previous_visit: "an earlier visit",
  request:        "an earlier request",
};

export default function NewRequest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, activeUnit } = useAuth();
  const [loading, setLoading] = useState(false);
  const [hosts, setHosts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState("");
  // Walk-ins (visit_category SPOT) are either a person or a company representative
  const [spotVisitorType, setSpotVisitorType] = useState(() =>
    searchParams.get("type")?.toLowerCase() === "business" ? "business" : "individual");

  // ── Conflict confirmation modal state ─────────────────────────────────────────
  const [conflictModal, setConflictModal] = useState(null); // null | { types, host_conflict, visitor_conflict, pendingPayload }

  // ── Visitor phone lookup state ────────────────────────────────────────────────
  const [visitorLookupState, setVisitorLookupState] = useState("idle"); // idle | loading | found | not_found
  const [foundVisitorData, setFoundVisitorData] = useState(null);

  // ID proof / photo already on record for the looked-up mobile (portal profile or an earlier visit)
  const [onRecord, setOnRecord] = useState(null);
  const [retakePhoto, setRetakePhoto] = useState(false);
  const idOnRecord = !!onRecord?.id_proof_type;

  const resetVisitorLookup = useCallback(() => {
    setVisitorLookupState("idle");
    setFoundVisitorData(null);
    setOnRecord(null);
    setRetakePhoto(false);
  }, []);

  // ── Vendor phone lookup state ────────────────────────────────────────────────
  const [vendorLookupState, setVendorLookupState] = useState("idle"); // idle | loading | found | not_found

  const resetVendorLookup = useCallback(() => {
    setVendorLookupState("idle");
    setOnRecord(null);
    setRetakePhoto(false);
  }, []);

  // ── EMPLOYEE_VISIT state ─────────────────────────────────────────────────────
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

  // ── Unit Admin EMPLOYEE_VISIT state ──────────────────────────────────────────
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
  // Security and reception can't open Visit Requests: send them back to where they
  // started (dashboard or gate), or to the dashboard on a fresh tab
  const leave = (created = false) => {
    if (!["security", "receptionist"].includes(role)) navigate("/requests");
    else if (created) navigate("/gate/walk-ins");
    else if (window.history.state?.idx > 0) navigate(-1);
    else navigate("/dashboard");
  };
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

  // The card picked in the UI (SPOT_INDIVIDUAL / SPOT_BUSINESS both send visit_category SPOT)
  const initialCat = getInitialCategory();
  const [selectedCategory, setSelectedCategory] = useState(initialCat);
  const initialStart = isSpotId(initialCat) ? getCurrentTimeHHMM() : "";

  const isAdminOrStaff = ["super_admin", "admin", "receptionist", "security", "org_admin", "unit_admin"].includes(
    user?.role_type || user?.role
  );

  const [formData, setFormData] = useState({
    visit_category: isSpotId(initialCat) ? "SPOT" : initialCat,
    host_user_id: isAdminOrStaff ? "" : user?.id || "",
    department_id: user?.department_id || "",
    organization_id: user?.organization_id || "",
    purpose: "",
    visit_date: getTodayDateYMD(),   // most visits are for today; easy to change
    visit_start_time: initialStart,
    visit_end_time: initialStart ? addMinutesToTime(initialStart, 30) : "",
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
    id_proof_type: "AADHAAR",
    id_proof_number: "",
    companions: [],
  });
  const [visitorPhoto, setVisitorPhoto] = useState(null);   // optional; uploaded after the request is created

  // ── Data fetching ─────────────────────────────────────────────────────────────
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

  // ── Visitor phone lookup ───────────────────────────────────────────────────────
  // phoneArg: the number just typed (auto-lookup on the 10th digit); a button click passes an event
  const handleVisitorLookup = async (phoneArg) => {
    const phone = String(typeof phoneArg === "string" ? phoneArg : formData.visitor_phone).trim().replace(/\D/g, "");
    if (phone.length !== 10) {
      toast.error("Please enter a valid 10-digit mobile number to look up.");
      return;
    }
    setVisitorLookupState("loading");
    setFoundVisitorData(null);
    try {
      const res = await apiClient.get("/visitors/lookup", { params: { phone } });
      const { found, visitor } = res.data.data;
      setOnRecord(visitor?.on_record?.id_proof_type || visitor?.on_record?.photo_url ? visitor.on_record : null);
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
        // A returning business visitor at the gate → business walk-in
        if (formData.visit_category === "SPOT") {
          const biz = visitor.visitor_type === "business" || !!visitor.company_name;
          setSelectedCategory(biz ? "SPOT_BUSINESS" : "SPOT_INDIVIDUAL");
          setSpotVisitorType(biz ? "business" : "individual");
        }
        const where = visitor.source === "portal" ? " (visitor portal account)" : visitor.source === "other_unit" ? " (visited another OHPC unit)" : "";
        toast.success(`Returning visitor found: ${visitor.full_name}${where}`);
      } else {
        setVisitorLookupState("not_found");
        setFormData(p => ({ ...p, visitor_id: "", visitor_name: "", visitor_email: "" }));
        toast.success("New contact");
      }
    } catch {
      setVisitorLookupState("not_found");
    }
  };

  // ── Vendor phone lookup ───────────────────────────────────────────────────────
  const handleVendorLookup = async (phoneArg) => {
    const phone = String(typeof phoneArg === "string" ? phoneArg : formData.visitor_phone).trim().replace(/\D/g, "");
    if (phone.length !== 10) {
      toast.error("Please enter a valid 10-digit contact number to look up.");
      return;
    }
    setVendorLookupState("loading");
    try {
      const res = await apiClient.get("/visitors/lookup", { params: { phone } });
      const { found, visitor } = res.data.data;
      setOnRecord(visitor?.on_record?.id_proof_type || visitor?.on_record?.photo_url ? visitor.on_record : null);
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

  // ── Time helper: add minutes to "HH:MM" string ────────────────────────────────

  // ── Standard handlers ─────────────────────────────────────────────────────────
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

  // ── EMPLOYEE_VISIT handlers ───────────────────────────────────────────────────
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

  // ── Category change ────────────────────────────────────────────────────────────
  const handleCategoryChange = (categoryId) => {
    setSelectedCategory(categoryId);
    const isSpot = isSpotId(categoryId);
    const resolvedCategory = isSpot ? "SPOT" : categoryId;
    setSpotVisitorType(categoryId === "SPOT_BUSINESS" ? "business" : "individual");

    // Walk-ins happen now: today, from now for 30 minutes (kept when switching between the two walk-in types)
    const nowTime = isSpot ? getCurrentTimeHHMM() : "";
    const endTime = isSpot ? addMinutesToTime(nowTime, 30) : "";
    const nowDate = isSpot ? getTodayDateYMD() : "";

    setFormData((prev) => {
      const wasSpot = prev.visit_category === "SPOT";
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
        visit_date: isSpot ? (wasSpot && prev.visit_date ? prev.visit_date : nowDate) : (prev.visit_date || getTodayDateYMD()),
        visit_start_time: isSpot ? (wasSpot && prev.visit_start_time ? prev.visit_start_time : nowTime) : "",
        visit_end_time: isSpot ? (wasSpot && prev.visit_end_time ? prev.visit_end_time : endTime) : "",
      };
    });
    resetVendorLookup();
    resetVisitorLookup();
    setSelectedDeptId("");
    setHosts([]);
    setVisitMode("visiting");
    resetEmpVisitState();
    resetAdminEmpVisitState();
  };

  // ── Companions ─────────────────────────────────────────────────────────────────
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

  // ── Submit ─────────────────────────────────────────────────────────────────────
  const buildPayload = () => {
    const payload = { ...formData };
    const cat = payload.visit_category;

    if (["PERSONAL_VISIT", "SPOT", "VENDOR"].includes(cat) && idOnRecord) {
      // The ID on record is used as it is — the server looks it up (staff may only see it masked)
      payload.id_proof_from_record = true;
      delete payload.id_proof_type;
      delete payload.id_proof_number;
    } else if (["PERSONAL_VISIT", "SPOT", "VENDOR"].includes(cat)) {
      payload.id_proof_number = cleanIdNumber(payload.id_proof_type, payload.id_proof_number);
    } else {
      delete payload.id_proof_type;
      delete payload.id_proof_number;
    }

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

    // ── Time order validation ──────────────────────────────────────────────────
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
      toast.error("Company / organisation name is required for a business walk-in.");
      return;
    }

    // The visitor's name: walk-ins and personal visits show name + email only after the
    // number is looked up — never submit a visitor without a name
    const catNow = formData.visit_category;
    const companyCard = catNow === "VENDOR" || (catNow === "SPOT" && spotVisitorType === "business");
    const visitorCard = ["SPOT", "PERSONAL_VISIT"].includes(catNow) && !companyCard && formData.visitor_phone;
    if (visitorCard) {
      if (visitorLookupState !== "found" && visitorLookupState !== "not_found") {
        toast.error("Look up the visitor's number first, then check their name.");
        handleVisitorLookup(formData.visitor_phone);
        return;
      }
      if (!formData.visitor_name?.trim()) {
        toast.error("Enter the visitor's full name.");
        document.getElementById("visitor_name")?.focus();
        return;
      }
    }
    if (companyCard && !formData.contact_person?.trim()) {
      toast.error("Enter the contact person's name.");
      document.getElementById("contact_person")?.focus();
      return;
    }
    if (["PERSONAL_VISIT", "SPOT", "VENDOR"].includes(catNow) && !idOnRecord) {
      const idError = idProofError(formData.id_proof_type, formData.id_proof_number, true);
      if (idError) {
        toast.error(`ID proof: ${idError}`);
        document.getElementById("id_proof_number")?.focus();
        return;
      }
    }

    setLoading(true);
    try {
      const payload = buildPayload();
      const res = await apiClient.post("/visit-requests", payload);
      await savePhoto(res.data?.data?.id);
      toast.success("Visit request created successfully");
      leave(true);
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

  /** Uploads the optional visitor photo for a request just created; the request stands if this fails. */
  const savePhoto = async (requestId) => {
    if (!visitorPhoto || !requestId) return;
    try {
      const fd = new FormData();
      fd.append("photo", await (await fetch(visitorPhoto)).blob(), "visitor_photo.jpg");
      await apiClient.post(`/visit-requests/${requestId}/photo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
    } catch (err) {
      toast.error(getApiErrorMessage(err, "The request is saved, but the photo couldn't be uploaded. Take it at check-in."), { duration: 6000 });
    }
  };

  // ── Force submit (override conflict) ──────────────────────────────────────────
  const handleForceSubmit = async () => {
    if (!conflictModal) return;
    setLoading(true);
    setConflictModal(null);
    try {
      const payload = { ...conflictModal.pendingPayload, force_create: true };
      const res = await apiClient.post("/visit-requests", payload);
      await savePhoto(res.data?.data?.id);
      toast.success("Visit request created (conflict overridden).");
      leave(true);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to create request."));
    } finally {
      setLoading(false);
    }
  };

  // ── Derived booleans ──────────────────────────────────────────────────────────
  const isUnitAdmin = user?.role_type === "unit_admin";
  const isSuperAdminUser = user?.role_type === "super_admin";
  // Super Admin can create emp-visit only when managing a unit
  const isAdminEmpVisit = (isUnitAdmin || (isSuperAdminUser && !!activeUnit));
  const cat = formData.visit_category;
  const isVendor = cat === "VENDOR";
  const isSpotBusiness = cat === "SPOT" && spotVisitorType === "business";
  // Vendors and business walk-ins share the company card (contact by phone lookup)
  const isVendorBusiness = isVendor || isSpotBusiness;
  const isEmpVisit = cat === "EMPLOYEE_VISIT";
  const isSelfHosting = !isAdminOrStaff && !isEmpVisit && !isUnitAdmin;

  // Hide the standard visitor phone fields and host picker for EMPLOYEE_VISIT
  const showVisitorFields = !isVendorBusiness && !isEmpVisit;
  const showHostPicker = (!isSelfHosting || isUnitAdmin) && !isEmpVisit;

  // Read-only look for fields filled from a lookup
  const lockedCls = (state) => (state === "found" ? " bg-surface-alt text-ink-2 cursor-default" : "");
  const personLabel = (emp) =>
    `${emp.full_name} (${emp.department_name ? `${emp.department_name} · ` : ""}${emp.designation_name || emp.role_type})`;
  const unitLabel = (u) => `${u.name}${u.city ? ` · ${u.city}` : ""}`;
  const endBeforeStart = !!(formData.visit_start_time && formData.visit_end_time && formData.visit_end_time <= formData.visit_start_time);

  // Selectable card (visit type, visit mode)
  const choiceCls = (on) =>
    `text-left rounded-lg border px-3 py-2.5 transition-colors ${on ? "border-primary bg-primary-soft" : "border-line hover:border-line-strong bg-surface"}`;

  // Phone + Lookup row shared by the visitor and the vendor sections
  const lookupRow = ({ state, onLookup, onChange, placeholder, name }) => (
    <div className="flex gap-2">
      <input
        type="tel"
        name={name}
        placeholder={placeholder}
        maxLength={10}
        inputMode="numeric"
        value={formData.visitor_phone}
        onChange={onChange}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onLookup(); } }}
        required
        className="control tabular flex-1"
      />
      <button
        type="button"
        onClick={onLookup}
        disabled={state === "loading" || formData.visitor_phone?.length !== 10}
        className="btn-outline shrink-0"
      >
        {state === "loading" ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        {state === "loading" ? "Looking up…" : "Look up"}
      </button>
    </div>
  );

  const lookupStatus = (state, kind) => (
    <>
      {state === "idle" && formData.visitor_phone?.length > 0 && formData.visitor_phone?.length < 10 && (
        <p className="field-error">Enter a valid 10-digit mobile number.</p>
      )}
      {state === "idle" && !formData.visitor_phone && (
        <p className="field-hint">
          Enter the 10-digit mobile number and choose Look up. Details fill in for returning {kind === "vendor" ? "contacts" : "visitors"}.
        </p>
      )}
      {state === "found" && (
        <Note tone="success" icon={CheckCircle2} className="mt-2">
          <b>Returning {kind === "vendor" ? "contact" : "visitor"}.</b>{" "}
          {kind === "vendor" ? "Name and email filled in from the last visit." : "Details filled in from our records."}
        </Note>
      )}
      {state === "not_found" && (
        <Note tone="warning" icon={AlertCircle} className="mt-2">
          <b>New {kind === "vendor" ? "contact" : "visitor"}.</b>{" "}
          {kind === "vendor" ? "Enter the name below." : "Fill in the details below; they are saved for next time."}
        </Note>
      )}
    </>
  );

  return (
    <div className="animate-fade-in">
      <PageHeader title="New visit request" />

      {/* Wide screens: who on the left; when / why / submit in a sticky panel on the right,
          so the whole request fits on one screen without scrolling */}
      <form onSubmit={handleSubmit}
        className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-x-8 gap-y-6 items-start max-w-[1440px]">
        <div className="min-w-0">
        {/* ── Visit type ── */}
        <section>
          <SectionTitle icon={Users} title="Visit type" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" role="radiogroup" aria-label="Visit type">
            {availableCategories.map((c) => {
              const on = selectedCategory === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => handleCategoryChange(c.id)}
                  className={choiceCls(on)}
                >
                  <span className={`block text-[13px] font-medium ${on ? "text-primary-strong" : "text-ink"}`}>{c.label}</span>
                  {c.desc && <span className="block text-[12px] text-muted mt-0.5">{c.desc}</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Visitor and host ── */}
        <section className="section">
          <SectionTitle icon={Users} title="Visitor and host" />

          {/* Employee visit — mode + cascading employee picker */}
          {isEmpVisit && !isAdminEmpVisit && (
            <div className="space-y-4">
              <div>
                <p className="field-label">What are you doing?</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Visit mode">
                  {[
                    { mode: "visiting", label: "I'm visiting someone", desc: "You are the visitor; they must approve." },
                    { mode: "hosting", label: "I'm hosting someone", desc: "You are the host; it is approved automatically." },
                  ].map(({ mode, label, desc }) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={visitMode === mode}
                      onClick={() => { setVisitMode(mode); resetEmpVisitState(); }}
                      className={choiceCls(visitMode === mode)}
                    >
                      <span className={`block text-[13px] font-medium ${visitMode === mode ? "text-primary-strong" : "text-ink"}`}>{label}</span>
                      <span className="block text-[12px] text-muted mt-0.5">{desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="inset-cell">
                <p className="group-heading mb-1">{visitMode === "visiting" ? "Visitor (you)" : "Host (you)"}</p>
                <p className="text-ink">{user?.full_name} <span className="text-muted">· {user?.designation || user?.role_type}</span></p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <Field label={visitMode === "visiting" ? "Unit to visit" : "Visitor's unit"} required>
                  <Select searchable value={selectedUnitId} onChange={handleEmpUnitChange} required aria-label="Unit">
                    <option value="">
                      {units.length > 0 && otherUnits.length === 0 ? "No other units available" : "Select unit"}
                    </option>
                    {otherUnits.map(u => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}
                  </Select>
                </Field>

                {selectedUnitId && empDepartments.length > 0 && (
                  <Field label="Department" required>
                    <Select searchable value={empDeptId} onChange={handleEmpDeptChange} required aria-label="Department">
                      <option value="">Select department</option>
                      {empDepartments.map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                    </Select>
                  </Field>
                )}

                {selectedUnitId && (
                  <Field
                    label={
                      <>
                        {visitMode === "visiting" ? "Host employee" : "Visitor (employee)"}
                        {employees.length > 0 && <span className="ml-1 font-normal text-muted">· {employees.length} found</span>}
                      </>
                    }
                    required
                    hint={visitMode === "hosting"
                      ? "Approved automatically because you are the host."
                      : "The selected person must approve your visit."}
                    className="sm:col-span-2"
                  >
                    <Select searchable
                      value={selectedEmpId}
                      onChange={e => setSelectedEmpId(e.target.value)}
                      required
                      disabled={empDepartments.length > 0 ? !empDeptId || employees.length === 0 : employees.length === 0}
                      aria-label="Employee"
                    >
                      <option value="">
                        {empDepartments.length > 0 && !empDeptId
                          ? "Select a department first"
                          : employees.length === 0
                            ? (empDepartments.length > 0 ? "No users in this department" : "No users in this unit")
                            : "Select person"}
                      </option>
                      {employees.map(emp => <option key={emp.id} value={emp.id}>{personLabel(emp)}</option>)}
                    </Select>
                  </Field>
                )}
              </div>
            </div>
          )}

          {/* Employee visit arranged by a unit admin (or a super admin managing a unit) */}
          {isEmpVisit && isAdminEmpVisit && (
            <div className="space-y-3">
              <Note tone="info" icon={AlertCircle}>
                <b>Arrange an employee visit.</b>{" "}
                {isSuperAdminUser
                  ? `Choose a visitor from the managed unit (${activeUnit?.name}) and a host from any unit.`
                  : "Choose a visitor from your unit and a host from any unit."}
              </Note>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="tile">
                  <p className="group-heading mb-3">
                    Visitor · {isSuperAdminUser ? (activeUnit?.name || "Managed unit") : (user?.unit_name || "My unit")}
                  </p>
                  <div className="space-y-3">
                    <Field label="Department">
                      <Select searchable value={adminVisitorDeptId} onChange={handleAdminVisitorDeptChange} aria-label="Visitor department">
                        <option value="">All departments</option>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                      </Select>
                    </Field>
                    <Field label="Employee" required>
                      <Select searchable
                        value={adminVisitorEmpId}
                        onChange={e => setAdminVisitorEmpId(e.target.value)}
                        required
                        disabled={adminVisitorEmployees.length === 0}
                        aria-label="Visitor employee"
                      >
                        <option value="">{adminVisitorEmployees.length === 0 ? "No users found" : "Select person"}</option>
                        {adminVisitorEmployees.map(emp => <option key={emp.id} value={emp.id}>{personLabel(emp)}</option>)}
                      </Select>
                    </Field>
                  </div>
                </div>

                <div className="tile">
                  <p className="group-heading mb-3">Host · any unit</p>
                  <div className="space-y-3">
                    <Field label="Host's unit" required>
                      <Select searchable value={adminHostUnitId} onChange={handleAdminHostUnitChange} required aria-label="Host unit">
                        <option value="">
                          {units.length > 0 && otherUnits.length === 0 ? "No other units available" : "Select unit"}
                        </option>
                        {otherUnits.map(u => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}
                      </Select>
                    </Field>
                    {adminHostUnitId && adminHostDepts.length > 0 && (
                      <Field label="Department">
                        <Select searchable value={adminHostDeptId} onChange={handleAdminHostDeptChange} aria-label="Host department">
                          <option value="">All departments</option>
                          {adminHostDepts.map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                        </Select>
                      </Field>
                    )}
                    {adminHostUnitId && (
                      <Field label="Host" required>
                        <Select searchable
                          value={adminHostEmpId}
                          onChange={e => setAdminHostEmpId(e.target.value)}
                          required
                          disabled={adminHostEmployees.length === 0}
                          aria-label="Host employee"
                        >
                          <option value="">{adminHostEmployees.length === 0 ? "No users found" : "Select person"}</option>
                          {adminHostEmployees.map(emp => <option key={emp.id} value={emp.id}>{personLabel(emp)}</option>)}
                        </Select>
                      </Field>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Visitor (non employee-visit, non vendor) */}
          {showVisitorFields && (
            <div>
              <Field label="Visitor mobile number" required>
                {lookupRow({
                  state: visitorLookupState,
                  onLookup: handleVisitorLookup,
                  placeholder: "10-digit mobile number",
                  onChange: e => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setFormData(p => ({ ...p, visitor_phone: val, visitor_name: "", visitor_email: "", visitor_id: "" }));
                    resetVisitorLookup();
                    if (val.length === 10) handleVisitorLookup(val);   // details appear as soon as the number is complete
                  },
                })}
                {lookupStatus(visitorLookupState, "visitor")}
              </Field>

              {(visitorLookupState === "found" || visitorLookupState === "not_found") && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 mt-3">
                  <Field label="Full name" htmlFor="visitor_name" required>
                    <input id="visitor_name" type="text" required readOnly={visitorLookupState === "found"}
                      value={formData.visitor_name}
                      onChange={e => setFormData(p => ({ ...p, visitor_name: e.target.value }))}
                      placeholder="Visitor's full name"
                      className={`control${lockedCls(visitorLookupState)}`} />
                  </Field>
                  <Field label="Email" htmlFor="visitor_email">
                    <input id="visitor_email" type="email" readOnly={visitorLookupState === "found"}
                      value={formData.visitor_email}
                      onChange={e => setFormData(p => ({ ...p, visitor_email: e.target.value }))}
                      placeholder="name@example.com"
                      className={`control${lockedCls(visitorLookupState)}`} />
                  </Field>
                </div>
              )}
            </div>
          )}

          {/* Host */}
          {showHostPicker ? (
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3${showVisitorFields ? " mt-4" : ""}`}>
              <Field label="Department" required>
                <Select searchable name="selected_department_id" required value={selectedDeptId} onChange={handleDeptChange} aria-label="Department">
                  <option value="">Select department</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                </Select>
              </Field>
              <Field label="Host employee" required>
                <Select searchable name="host_user_id" required value={formData.host_user_id} onChange={handleHostChange}
                  disabled={!selectedDeptId} aria-label="Host employee">
                  <option value="">{!selectedDeptId ? "Select a department first" : "Select host"}</option>
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>{h.full_name} ({h.department_name || h.designation || h.role_type})</option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : !isEmpVisit ? (
            <div className={`inset-cell${showVisitorFields ? " mt-4" : ""}`}>
              <p className="group-heading mb-1">Host (you)</p>
              <p className="text-ink">{user?.full_name} <span className="text-muted">· {user?.designation || user?.role}</span></p>
              <input type="hidden" name="host_user_id" value={user?.id || ""} />
            </div>
          ) : null}

        </section>

        {/* ── Vendor details ── */}
        {isVendorBusiness && (
          <section className="section animate-fade-in">
            <SectionTitle icon={Building} title={isSpotBusiness ? "Company details" : "Vendor details"} />
            <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-x-4 gap-y-3">
              <Field label="Company name" htmlFor="company_name" required>
                <input id="company_name" type="text" name="company_name" required value={formData.company_name}
                  onChange={handleInputChange} className="control" />
              </Field>
              <Field label="Email" htmlFor="vendor_email" hint="Used to send the gate pass.">
                <input id="vendor_email" type="email" name="vendor_email" value={formData.vendor_email}
                  onChange={handleInputChange} readOnly={vendorLookupState === "found"}
                  className={`control${lockedCls(vendorLookupState)}`} placeholder="name@company.com" />
              </Field>

              <Field label="Contact mobile number" required className="sm:col-span-2 2xl:col-span-1">
                {lookupRow({
                  state: vendorLookupState,
                  onLookup: handleVendorLookup,
                  name: "visitor_phone",
                  placeholder: "10-digit contact number",
                  onChange: e => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setFormData(p => ({ ...p, visitor_phone: val, contact_person: "" }));
                    resetVendorLookup();
                    if (val.length === 10) handleVendorLookup(val);
                  },
                })}
                {lookupStatus(vendorLookupState, "vendor")}
              </Field>

              <Field label="Contact person" htmlFor="contact_person" required className="sm:col-span-2 2xl:col-span-1">
                <input id="contact_person" type="text" name="contact_person" required value={formData.contact_person}
                  onChange={e => setFormData(p => ({ ...p, contact_person: e.target.value, visitor_name: e.target.value }))}
                  readOnly={vendorLookupState === "found"} placeholder="Representative's full name"
                  className={`control${lockedCls(vendorLookupState)}`} />
              </Field>

              <Field label="Service type" htmlFor="service_type">
                <input id="service_type" type="text" name="service_type" value={formData.service_type}
                  onChange={handleInputChange} className="control" placeholder="e.g. AC maintenance, delivery" />
              </Field>
              <Field label="Work order ref." htmlFor="work_order_ref">
                <input id="work_order_ref" type="text" name="work_order_ref" value={formData.work_order_ref}
                  onChange={handleInputChange} className="control mono" />
              </Field>
            </div>
          </section>
        )}

        {/* ── Visitor ID proof + optional photo (checked again at the gate) ── */}
        {["PERSONAL_VISIT", "SPOT", "VENDOR"].includes(cat) && (
          <section className="section">
            <SectionTitle icon={CreditCard} title="ID proof and visitor photo"
              meta={isVendorBusiness ? "of the contact person" : "of the visitor"} />
            <div className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)] gap-x-4 gap-y-3 max-w-[720px]">
              {idOnRecord ? (
                <>
                  {/* On record — shown, not edited (the gate checks the card against it) */}
                  <Field label="ID type">
                    <Select value={onRecord.id_proof_type} aria-label="ID type" disabled onChange={() => {}}>
                      {ID_PROOFS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="ID number" hint={`On record from ${RECORD_SOURCE[onRecord.id_proof_source] || "an earlier record"} — it can't be changed here.`}>
                    <input type="text" value={onRecord.id_proof_number || ""} disabled className="control mono" aria-label="ID number" />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="ID type" required>
                    <Select value={formData.id_proof_type} aria-label="ID type"
                      onChange={(e) => setFormData((p) => ({ ...p, id_proof_type: e.target.value }))}>
                      {ID_PROOFS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="ID number" htmlFor="id_proof_number" required
                    error={idProofError(formData.id_proof_type, formData.id_proof_number)}
                    hint="Security checks the card against this at check-in.">
                    <input id="id_proof_number" type="text" required value={formData.id_proof_number}
                      onChange={(e) => setFormData((p) => ({ ...p, id_proof_number: e.target.value }))}
                      placeholder={ID_PROOFS.find((t) => t.value === formData.id_proof_type)?.placeholder}
                      maxLength={formData.id_proof_type === "AADHAAR" ? 14 : 30} autoComplete="off"
                      aria-invalid={!!idProofError(formData.id_proof_type, formData.id_proof_number) || undefined}
                      className="control mono uppercase" />
                  </Field>
                </>
              )}
              <Field label="Visitor photo (face)" className="sm:col-span-2"
                hint={onRecord?.photo_url && !visitorPhoto
                  ? `On record from ${RECORD_SOURCE[onRecord.photo_source] || "an earlier record"}. Take a new one only if it doesn't match.`
                  : "Optional — a photo of the person, not of the ID card. It can also be taken at check-in."}>
                {onRecord?.photo_url && !visitorPhoto && !retakePhoto ? (
                  <div className="flex items-start gap-3">
                    <img src={onRecord.photo_url} alt="Visitor photo on record" className="w-24 h-24 object-cover rounded border border-line" />
                    <button type="button" onClick={() => setRetakePhoto(true)} className="btn-outline btn-sm mt-1">
                      <Camera size={13} /> Take a new photo
                    </button>
                  </div>
                ) : (
                  <PhotoCapture value={visitorPhoto} onChange={setVisitorPhoto} label="Visitor photo" />
                )}
              </Field>
            </div>
          </section>
        )}

        {/* ── Companions ── */}
        <section className="section">
          <SectionTitle
            icon={User}
            title="Companions"
            meta={`${formData.accompanying_count}`}
            actions={(
              <button type="button" onClick={addCompanion} className="btn-outline btn-sm">
                <Plus size={13} /> Add companion
              </button>
            )}
          />

          {formData.companions.length === 0 ? (
            <p className="text-[12.5px] text-muted">No companions. Add anyone coming with the visitor.</p>
          ) : (
            <div className="space-y-2">
              <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)_30px] gap-2 group-heading">
                <span>Full name</span><span>ID type</span><span>ID number</span><span />
              </div>
              {formData.companions.map((comp, idx) => {
                const badAadhaar = comp.id_type === "AADHAAR" && comp.id_number && comp.id_number.length !== 12;
                return (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)_30px] gap-2 items-start">
                    <input type="text" placeholder="Full name" required value={comp.full_name}
                      aria-label={`Companion ${idx + 1} name`}
                      onChange={(e) => updateCompanion(idx, "full_name", e.target.value)} className="control" />
                    <Select value={comp.id_type} onChange={(e) => updateCompanion(idx, "id_type", e.target.value)}
                      aria-label={`Companion ${idx + 1} ID type`}>
                      <option value="AADHAAR">Aadhaar</option>
                      <option value="PAN">PAN</option>
                      <option value="DRIVING_LICENSE">Driving licence</option>
                      <option value="PASSPORT">Passport</option>
                    </Select>
                    <div>
                      <input type="text" required value={comp.id_number}
                        placeholder={comp.id_type === "AADHAAR" ? "12-digit Aadhaar number" : "ID number"}
                        aria-label={`Companion ${idx + 1} ID number`}
                        maxLength={comp.id_type === "AADHAAR" ? 12 : 50}
                        onChange={(e) => updateCompanion(idx, "id_number", e.target.value)}
                        className={`control mono${badAadhaar ? " is-invalid" : ""}`} />
                      {badAadhaar && <p className="field-error">Aadhaar must be exactly 12 digits.</p>}
                    </div>
                    <button type="button" onClick={() => removeCompanion(idx)} className="btn-icon"
                      aria-label={`Remove companion ${idx + 1}`} title="Remove companion">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        </div>

        {/* ── When and why + submit (sticky on wide screens) ── */}
        <aside className="tile xl:sticky xl:top-4 space-y-3">
          <SectionTitle icon={Calendar} title="When and why" />
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <Field label="Visit date" htmlFor="visit_date" required className="col-span-2">
              <input id="visit_date" type="date" name="visit_date" required value={formData.visit_date}
                onChange={handleInputChange} className="control tabular" />
            </Field>
            <Field label="Start time" htmlFor="visit_start_time">
              <input id="visit_start_time" type="time" name="visit_start_time" value={formData.visit_start_time}
                onChange={handleInputChange} className="control tabular" />
            </Field>
            <Field label="End time" htmlFor="visit_end_time"
              error={endBeforeStart ? `End time must be after ${formData.visit_start_time}.` : ""}>
              <input id="visit_end_time" type="time" name="visit_end_time" min={formData.visit_start_time || undefined}
                value={formData.visit_end_time} onChange={handleInputChange}
                className={`control tabular${endBeforeStart ? " is-invalid" : ""}`} />
            </Field>
          </div>
          <Field label="Purpose of visit" htmlFor="purpose" required hint="At least 10 characters.">
            <textarea id="purpose" name="purpose" required minLength={10} rows={3} value={formData.purpose}
              onChange={handleInputChange} className="control resize-none"
              placeholder="e.g. Quarterly maintenance review of the turbine hall" />
          </Field>
          <div className="pt-3 border-t border-line flex flex-wrap gap-2">
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {loading ? "Submitting…" : "Submit request"}
            </button>
            <button type="button" onClick={() => leave()} className="btn-outline">Cancel</button>
          </div>
        </aside>
      </form>

      {/* ── Schedule conflict ── */}
      <Modal
        open={!!conflictModal}
        onClose={() => setConflictModal(null)}
        busy={loading}
        width={460}
        title="Schedule conflict"
        footer={(
          <>
            <button type="button" onClick={() => setConflictModal(null)} className="btn-outline" disabled={loading}>
              Change the time
            </button>
            <button type="button" onClick={handleForceSubmit} disabled={loading} className="btn-primary">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
              Continue anyway
            </button>
          </>
        )}
      >
        {conflictModal && (
          <div className="space-y-2">
            {conflictModal.types.includes("HOST_BUSY") && conflictModal.host_conflict && (
              <Note tone="warning" icon={AlertTriangle}>
                <b>The host is busy.</b> {conflictModal.host_conflict.visitor_name} is already visiting the host
                during <b>{conflictModal.host_conflict.time_window}</b>.
              </Note>
            )}
            {conflictModal.types.includes("VISITOR_BUSY") && conflictModal.visitor_conflict && (
              <Note tone="warning" icon={AlertTriangle}>
                <b>The visitor has another visit.</b> They already have a request at{" "}
                {conflictModal.visitor_conflict.dept_name} during <b>{conflictModal.visitor_conflict.time_window}</b>.
              </Note>
            )}
            <p className="text-[12.5px] text-ink-2 pt-1">
              Change the time, or continue to override the conflict. Overridden requests are flagged for admin review.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
