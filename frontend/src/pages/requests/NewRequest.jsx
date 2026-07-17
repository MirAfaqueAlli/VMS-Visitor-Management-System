import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";

// â”€â”€ Category definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ALL_CATEGORIES = [
  { id: "EMPLOYEE_VISIT", label: "Employee Visit",      desc: "Visit or invite a fellow employee" },
  { id: "PERSONAL_VISIT", label: "Personal Visit",      desc: "Family / friend visiting you" },
  { id: "VENDOR",         label: "Vendor / Contractor", desc: "Service and maintenance vendor" },
  { id: "SPOT",           label: "Spot Walk-in",        desc: "Urgent unplanned visit" },
];

const ROLE_CATEGORIES = {
  security:     ["SPOT"],
  employee:     ["EMPLOYEE_VISIT", "PERSONAL_VISIT", "VENDOR"],
  unit_admin:   ["EMPLOYEE_VISIT", "VENDOR", "SPOT"],
  super_admin:  ["EMPLOYEE_VISIT", "VENDOR", "SPOT"],
  receptionist: ["EMPLOYEE_VISIT", "VENDOR", "SPOT"],
  org_admin:    ["EMPLOYEE_VISIT", "PERSONAL_VISIT", "VENDOR", "SPOT"],
};

export default function NewRequest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, activeUnit } = useAuth();
  const [loading, setLoading] = useState(false);
  const [hosts, setHosts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState("");

  // â”€â”€ Conflict confirmation modal state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [conflictModal, setConflictModal] = useState(null); // null | { types, host_conflict, visitor_conflict, pendingPayload }

  // â”€â”€ Visitor phone lookup state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [visitorLookupState, setVisitorLookupState] = useState("idle"); // idle | loading | found | not_found
  const [foundVisitorData,   setFoundVisitorData]   = useState(null);

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
  const [visitMode,      setVisitMode]      = useState("visiting"); // 'visiting' | 'hosting'
  const [units,          setUnits]          = useState([]);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [empDepartments, setEmpDepartments] = useState([]);
  const [empDeptId,      setEmpDeptId]      = useState("");
  const [employees,      setEmployees]      = useState([]);
  const [selectedEmpId,  setSelectedEmpId]  = useState("");

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
    if (allowedIds.includes(param)) return param;
    return allowedIds[0];
  };

  const isAdminOrStaff = ["super_admin", "admin", "receptionist", "security", "org_admin", "unit_admin"].includes(
    user?.role_type || user?.role
  );

  const [formData, setFormData] = useState({
    visit_category: getInitialCategory(),
    host_user_id:    isAdminOrStaff ? "" : user?.id || "",
    department_id:   user?.department_id || "",
    organization_id: user?.organization_id || "",
    purpose: "",
    visit_date: "",
    visit_start_time: "",
    visit_end_time: "",
    accompanying_count: 0,
    visitor_id:    "",
    visitor_phone: "",
    visitor_name:  "",
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
        setDepartments(deptsRes.data.data || []);
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
        .catch(() => {});
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
        if (deptRes.status === 'fulfilled') setDepartments(deptRes.value.data?.data ?? []);
        if (empRes.status  === 'fulfilled') {
          setAdminVisitorAllEmployees(empRes.value.data?.data ?? []);
          setAdminVisitorEmployees(empRes.value.data?.data ?? []);
        }
      });
    }
  }, [user?.role_type, activeUnit?.id, formData.visit_category]);

  // â”€â”€ Visitor phone lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleVisitorLookup = async () => {
    const phone = formData.visitor_phone.trim();
    if (!phone || phone.length < 5) {
      toast.error("Please enter a valid phone number to look up.");
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
          visitor_id:    visitor.id    || "",
          visitor_name:  visitor.full_name || "",
          visitor_email: visitor.email    || "",
        }));
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
    const phone = formData.visitor_phone.trim();
    if (!phone || phone.length < 5) {
      toast.error("Please enter a valid contact number to look up.");
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
          vendor_email:   visitor.email     || p.vendor_email,
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
      .catch(() => {});
  }, []);

  // â”€â”€ Time helper: add minutes to "HH:MM" string â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const addMinutesToTime = (timeStr, minutes) => {
    const [h, m] = timeStr.split(':').map(Number);
    const total = h * 60 + m + minutes;
    const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const getCurrentTimeHHMM = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  };

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
        const noEnd          = !prev.visit_end_time;
        const endBeforeStart = prev.visit_end_time && prev.visit_end_time <= value;
        const endWithinAuto  = prev.visit_end_time && prev.visit_end_time <= auto30;
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
  const handleCategoryChange = (category) => {
    const isSpot = category === 'SPOT';
    const isSecurity = ['security', 'receptionist', 'unit_admin'].includes(role);
    const now = isSpot && isSecurity ? getCurrentTimeHHMM() : '';
    const end = now ? addMinutesToTime(now, 30) : '';

    setFormData((prev) => ({
      ...prev,
      visit_category: category,
      host_user_id: isAdminOrStaff ? "" : user?.id || "",
      department_id: isAdminOrStaff ? "" : (category === "EMPLOYEE_VISIT" ? "" : user?.department_id || ""),
      target_unit_id: "",
      visitor_phone: "",
      visitor_name:  "",
      visitor_email: "",
      visitor_id:    "",
      visit_start_time: now,
      visit_end_time:   end,
    }));
    resetVisitorLookup();
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
    updated[index][field] = value;
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

    if (cat !== "VENDOR") {
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
        payload.visitor_name   = selectedVisitor?.full_name || null;
        payload.visitor_phone  = selectedVisitor?.phone     || null;
        payload.visitor_email  = selectedVisitor?.email     || null;
        payload.host_user_id   = Number(adminHostEmpId)     || null;
        payload.department_id  = Number(adminHostDeptId)    || null;
        payload.target_unit_id = Number(adminHostUnitId)    || null;
        payload.request_source = "HOST";
      } else {
        const isVisiting = visitMode === "visiting";
        const isHosting  = visitMode === "hosting";
        payload.request_source = isVisiting ? "SELF" : "HOST";
        if (isVisiting) {
          payload.visitor_name   = user?.full_name || null;
          payload.visitor_phone  = user?.phone     || null;
          payload.visitor_email  = user?.email     || null;
          payload.host_user_id   = Number(selectedEmpId) || null;
          payload.department_id  = Number(empDeptId)     || null;
          payload.target_unit_id = Number(selectedUnitId) || null;
        } else if (isHosting) {
          const selectedEmp = employees.find(emp => String(emp.id) === String(selectedEmpId));
          payload.visitor_name   = selectedEmp?.full_name || null;
          payload.visitor_phone  = selectedEmp?.phone     || null;
          payload.visitor_email  = selectedEmp?.email     || null;
          // Hosting mode: request is always stored in the HOST's own unit DB.
          // Do NOT send target_unit_id — that would wrongly route the INSERT to the
          // visitor's unit DB where the host_user_id doesn't exist (FK violation).
          payload.target_unit_id = null;
        }
      }
      if (payload.host_user_id)   payload.host_user_id   = Number(payload.host_user_id);
      if (payload.department_id)  payload.department_id  = Number(payload.department_id);
      if (payload.target_unit_id) payload.target_unit_id = Number(payload.target_unit_id);
    } else {
      payload.visitor_phone = formData.visitor_phone?.trim() || null;
      if (cat === 'VENDOR') {
        payload.visitor_name  = formData.contact_person?.trim() || formData.company_name?.trim() || null;
        payload.visitor_email = formData.vendor_email?.trim() || null;
      } else {
        payload.visitor_name  = formData.visitor_name?.trim() || null;
        payload.visitor_email = formData.visitor_email?.trim() || null;
      }
      payload.visitor_id    = null;
      payload.host_user_id    = Number(payload.host_user_id)  || user?.id  || null;
      payload.department_id   = Number(payload.department_id) || user?.department_id || null;
      payload.organization_id = Number(payload.organization_id) || null;
    }

    payload.accompanying_count = Number(payload.accompanying_count);
    if (!payload.visit_start_time) payload.visit_start_time = null;
    if (!payload.visit_end_time)   payload.visit_end_time   = null;
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
          types:           data.types || [],
          host_conflict:   data.host_conflict   || null,
          visitor_conflict: data.visitor_conflict || null,
          pendingPayload:  buildPayload(),
        });
        setLoading(false);
        return;
      }
      console.error('[NewRequest] Submit error:', error.response?.data);
      const zodErrors = error.response?.data?.errors;
      if (Array.isArray(zodErrors) && zodErrors.length > 0) {
        const details = zodErrors
          .map((e) => `${e.path?.join('.') || 'field'}: ${e.message}`)
          .join(' | ');
        toast.error(`Validation failed  -  ${details}`, { duration: 8000 });
      } else {
        toast.error(data?.message || "Failed to create request");
      }
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
      toast.error(error.response?.data?.message || "Failed to create request");
    } finally {
      setLoading(false);
    }
  };

  // â”€â”€ Derived booleans â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const isUnitAdmin   = user?.role_type === "unit_admin";
  const isSuperAdminUser = user?.role_type === "super_admin";
  // Super Admin can create emp-visit only when managing a unit
  const isAdminEmpVisit = (isUnitAdmin || (isSuperAdminUser && !!activeUnit));
  const cat           = formData.visit_category;
  const isVendor      = cat === "VENDOR";
  const isEmpVisit    = cat === "EMPLOYEE_VISIT";
  const isSelfHosting = !isAdminOrStaff && !isEmpVisit && !isUnitAdmin;

  // Hide the standard visitor phone fields and host picker for EMPLOYEE_VISIT
  const showVisitorFields = !isVendor && !isEmpVisit;
  const showHostPicker    = (!isSelfHosting || isUnitAdmin) && !isEmpVisit;

  // Shared input style
  const inputCls = "w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300";

  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8 animate-fade-in">
      <div className="mb-12">
        <h1 className="text-2xl font-bold text-loud">
          New <em className="italic">Request</em>
        </h1>
        <p className="text-muted mt-3 text-lg">
          Schedule a new visit or register a walk-in.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* â”€â”€ Step 1: Category Selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="vms-card rounded-md p-8 shadow-card">
          <h2 className="text-xl text-loud mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
              1
            </span>
            Visit Category
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {availableCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleCategoryChange(c.id)}
                className={`p-4 rounded-md border text-left transition-all duration-300 ${
                  formData.visit_category === c.id
                    ? "border-border bg-mixed-bg shadow-soft-sm"
                    : "border-subtle hover:border-border hover:bg-bg-primary"
                }`}
              >
                <div className={`font-medium mb-1 ${formData.visit_category === c.id ? "text-accent" : "text-loud"}`}>
                  {c.label}
                </div>
                <div className="text-xs text-muted">{c.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* â”€â”€ Step 2: Visit Details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="vms-card rounded-md p-8 shadow-card">
          <h2 className="text-xl text-loud mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
              2
            </span>
            Visit Details
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Date */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-loud flex items-center gap-2">
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
                <label className="block text-sm font-medium text-loud flex items-center gap-2">
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
                      { mode: "visiting", label: "I'm visiting someone",  desc: "You are the visitor  -  they must approve" },
                      { mode: "hosting",  label: "I'm hosting someone",   desc: "You are the host  -  auto-approved" },
                    ].map(({ mode, label, desc }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => { setVisitMode(mode); resetEmpVisitState(); }}
                        className={`p-3 rounded-md border text-left transition-all duration-200 ${
                          visitMode === mode
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
                  <label className="block text-sm font-medium text-loud flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-accent" />
                    {visitMode === "visiting" ? "Select Unit to Visit *" : "Select Visitor's Unit *"}
                  </label>
                  <select
                    value={selectedUnitId}
                    onChange={handleEmpUnitChange}
                    required
                    className={inputCls}
                  >
                    <option value=""> -  Select Unit  - </option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.city ? `  -  ${u.city}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Department picker  -  mandatory */}
                {selectedUnitId && empDepartments.length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-loud flex items-center gap-1.5">
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
                    <label className="block text-sm font-medium text-loud flex items-center gap-1.5">
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
                        <option value=""> -  Select Unit  - </option>
                        {units.map(u => (
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
                      <label className="block text-sm font-medium text-loud flex items-center gap-2">
                        <Phone className="w-4 h-4 text-accent" />
                        Visitor *
                      </label>

                      {/* Phone + Lookup button */}
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          placeholder="WhatsApp / mobile number"
                          value={formData.visitor_phone}
                          onChange={e => {
                            setFormData(p => ({ ...p, visitor_phone: e.target.value, visitor_name: '', visitor_email: '', visitor_id: '' }));
                            resetVisitorLookup();
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleVisitorLookup(); }}}
                          required
                          className={`${inputCls} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={handleVisitorLookup}
                          disabled={visitorLookupState === 'loading' || !formData.visitor_phone}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 disabled:opacity-50 shrink-0"
                          style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}
                        >
                          {visitorLookupState === 'loading'
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Search className="w-4 h-4" />}
                          {visitorLookupState === 'loading' ? 'Looking up...' : 'Lookup'}
                        </button>
                      </div>

                      {/* Status banners */}
                      {visitorLookupState === 'found' && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm"
                          style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span><strong>Returning visitor</strong>  -  details auto-filled from our records.</span>
                        </div>
                      )}
                      {visitorLookupState === 'not_found' && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm"
                          style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span><strong>New visitor</strong>  -  fill in the details below. They will be saved automatically.</span>
                        </div>
                      )}
                      {visitorLookupState === 'idle' && (
                        <p className="text-xs text-faint">
                          Enter the visitor's WhatsApp / mobile number and click <strong>Lookup</strong>.
                          Details auto-fill for returning visitors.
                        </p>
                      )}

                      {/* Name + Email shown after lookup */}
                      {(visitorLookupState === 'found' || visitorLookupState === 'not_found') && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="block text-xs font-medium text-faint uppercase tracking-wider">Full Name *</label>
                            <input
                              type="text"
                              required
                              readOnly={visitorLookupState === 'found'}
                              value={formData.visitor_name}
                              onChange={e => setFormData(p => ({ ...p, visitor_name: e.target.value }))}
                              placeholder="Visitor full name"
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
                      )}
                    </div>
                  ) : null}

                  {/* Department Section */}
                  {showHostPicker && (
                    <div className="space-y-2 md:col-span-2">
                      <label className="block text-sm font-medium text-loud flex items-center gap-2">
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
                      <label className="block text-sm font-medium text-loud flex items-center gap-2">
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
                      <label className="block text-sm font-medium text-loud flex items-center gap-2">
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
        {isVendor && (
          <div className="vms-card rounded-md p-8 shadow-card animate-fade-in">
            <h2 className="text-xl text-loud mb-6 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
                3
              </span>
              <Building className="w-5 h-5 text-accent" />
              Vendor Details
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
                <label className="block text-sm font-medium text-loud flex items-center gap-2">
                  <Phone className="w-4 h-4 text-accent" />
                  Contact Phone *
                </label>
                <div className="flex gap-2">
                  <input
                    type="tel" name="visitor_phone" required
                    placeholder="Representative's WhatsApp / mobile number"
                    value={formData.visitor_phone}
                    onChange={e => {
                      setFormData(p => ({ ...p, visitor_phone: e.target.value, contact_person: '' }));
                      resetVendorLookup();
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleVendorLookup(); }}}
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={handleVendorLookup}
                    disabled={vendorLookupState === 'loading' || !formData.visitor_phone}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 disabled:opacity-50 shrink-0"
                    style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}
                  >
                    {vendorLookupState === 'loading'
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Search className="w-4 h-4" />}
                    {vendorLookupState === 'loading' ? 'Looking up...' : 'Lookup'}
                  </button>
                </div>
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
                {vendorLookupState === 'idle' && (
                  <p className="text-xs text-faint">
                    Enter the representative's mobile and click <strong>Lookup</strong> to auto-fill details.
                  </p>
                )}
              </div>

              {/* Contact Person  -  auto-filled or manual */}
              <div className="space-y-2 md:col-span-2">
                <label className="block text-sm font-medium text-loud">Contact Person *</label>
                <input
                  type="text" name="contact_person" required
                  value={formData.contact_person}
                  onChange={e => setFormData(p => ({ ...p, contact_person: e.target.value }))}
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
        <div className="vms-card rounded-md p-5 sm:p-8 shadow-card">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
            <h2 className="text-xl text-loud flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold shrink-0">
                {isVendor ? "4" : "3"}
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
                  className="flex flex-col sm:flex-row gap-4 items-start sm:items-center bg-bg-primary p-4 rounded-md border border-subtle"
                >
                  <div className="flex-1 space-y-1 w-full">
                    <input
                      type="text"
                      placeholder="Full Name"
                      required
                      value={comp.full_name}
                      onChange={(e) => updateCompanion(idx, "full_name", e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-subtle px-0 py-1 text-sm text-loud focus:ring-0 focus:border-border"
                    />
                  </div>
                  <div className="flex-1 space-y-1 w-full">
                    <select
                      value={comp.id_type}
                      onChange={(e) => updateCompanion(idx, "id_type", e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-subtle px-0 py-1 text-sm text-loud focus:ring-0 focus:border-border"
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
                      placeholder="ID Number"
                      required
                      value={comp.id_number}
                      onChange={(e) => updateCompanion(idx, "id_number", e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-subtle px-0 py-1 text-sm text-loud focus:ring-0 focus:border-border"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCompanion(idx)}
                    className="p-2 text-warning hover:bg-accent/10 rounded-full transition-colors self-end sm:self-auto"
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

