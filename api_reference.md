# VMS — Complete API Reference
### For Postman / Client Testing

---

## 🔐 Authentication Overview

**Type:** JWT Bearer Token  
**Base URL:** `http://localhost:5000/api`

### How to authenticate

1. Call `POST /api/auth/login` to get a token
2. Copy the `token` from the response
3. On every subsequent request, add this **Header**:

```
Authorization: Bearer <paste_token_here>
```

### Super Admin — managing a unit

When `super_admin` wants to act on a specific unit's data, also send:
```
X-Unit-Id: 1
```
*(Replace `1` with the actual unit ID from `/api/units`)*

---

## Role Reference

| Role | Abbreviation | Description |
|---|---|---|
| `super_admin` | SA | Full system access |
| `unit_admin` | UA | Full access to their unit |
| `employee` | EMP | Can raise visit requests, approve own visitors |
| `security` | SEC | Gate check-in / check-out |
| `receptionist` | REC | Gate + visitor registration |
| `unit_auditor` | UAUD | Read-only access to their unit |
| `global_auditor` | GAUD | Read-only access to all units |

---

---

## 1. 🔓 AUTH — `/api/auth`

### POST `/api/auth/login`
> **No token required**

**Body (JSON):**
```json
{
  "email": "admin@company.com",
  "password": "YourPassword@1",
  "unit_code": "HQ"
}
```
> `unit_code` is **optional** for `super_admin` / `global_auditor`. Required for all unit-level users.

**Success Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "full_name": "Admin User",
      "email": "admin@company.com",
      "role_type": "unit_admin",
      "unit_id": 1
    }
  }
}
```

---

### GET `/api/auth/me`
> **Auth required** — any role

Returns the currently logged-in user's profile.

---

### PUT `/api/auth/change-password`
> **Auth required** — any role

**Body:**
```json
{
  "currentPassword": "OldPass@1",
  "newPassword": "NewPass@2"
}
```

---

### POST `/api/auth/refresh`
> **Auth required** — any role

Refreshes the JWT token. Returns a new token.

---

---

## 2. 🏢 UNITS — `/api/units`

### GET `/api/units/public`
> **No auth required**

Returns all active units (for login page dropdown).

**Response:**
```json
{
  "data": [
    { "id": 1, "name": "Head Office", "code": "HQ", "city": "Mumbai", "state": "Maharashtra" }
  ]
}
```

---

### GET `/api/units/by-code/:code`
> **No auth required**

```
GET /api/units/by-code/HQ
```

---

### GET `/api/units`
> **Auth:** `super_admin`, `global_auditor`

**Query Parameters (now server-paginated):**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |
| `search` | string | — | Filter by name, code, or city |

**Example:**
```
GET /api/units?page=1&limit=10&search=Mumbai
```

**Response:**
```json
{
  "success": true,
  "data": {
    "units": [ { "id": 1, "name": "Head Office", "code": "HQ", "db_status": "ACTIVE", "user_count": 12, "department_count": 4 } ],
    "pagination": { "page": 1, "limit": 10, "total": 3, "pages": 1 }
  }
}
```

---

### GET `/api/units/:id`
> **Auth:** `super_admin`, `global_auditor`

---

### POST `/api/units`
> **Auth:** `super_admin` only

**Body:**
```json
{
  "name": "South Branch",
  "code": "SB",
  "city": "Chennai",
  "state": "Tamil Nadu",
  "phone": "+91 44 1234 5678",
  "email": "sb@company.com",
  "unit_admin": {
    "full_name": "Branch Admin",
    "email": "sb.admin@company.com",
    "phone": "+91 9876543210",
    "employee_code": "SB-ADM-001",
    "password": "Admin@123"
  }
}
```
> `unit_admin` is optional. If provided, creates the first admin user for the new unit.

---

### PUT `/api/units/:id`
> **Auth:** `super_admin`

**Body (any of):**
```json
{
  "name": "Updated Name",
  "city": "Pune",
  "state": "Maharashtra",
  "phone": "+91 20 9999 9999",
  "email": "updated@company.com"
}
```

---

### DELETE `/api/units/:id`
> **Auth:** `super_admin`

Deactivates (suspends) the unit. Fails if active users still exist.

---

---

## 3. 👥 USERS — `/api/users`

> **Note:** These operate on the **unit database**. Super admin must send `X-Unit-Id` header.

### GET `/api/users`
> **Auth:** `super_admin` (+ `X-Unit-Id`), `unit_admin`

**Query Parameters (server-paginated):**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |
| `search` | string | — | Filter by name, email, or employee code |
| `role` | string | — | Filter by role type (e.g. `employee`) |

**Example:**
```
GET /api/users?page=1&limit=10&search=john&role=employee
```

**Response:**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": 5,
        "full_name": "John Doe",
        "email": "john@company.com",
        "employee_code": "EMP-001",
        "role_type": "employee",
        "department_name": "Engineering",
        "is_active": true
      }
    ],
    "pagination": { "page": 1, "limit": 10, "total": 45, "pages": 5 }
  }
}
```

---

### GET `/api/users/hosts`
> **Optional auth** (public-ish, used by visitor forms)

```
GET /api/users/hosts?department_id=2
GET /api/users/hosts?unit_code=HQ&department_id=2
```

---

### GET `/api/users/:id`
> **Auth:** `super_admin`, `unit_admin`

---

### POST `/api/users`
> **Auth:** `super_admin` (+ `X-Unit-Id`), `unit_admin`

**Body:**
```json
{
  "full_name": "Jane Smith",
  "email": "jane@company.com",
  "phone": "+91 9876543210",
  "employee_code": "EMP-002",
  "password": "Jane@Pass1",
  "role_type": "employee",
  "department_id": 2,
  "designation_id": 5
}
```

**Valid `role_type` values:** `unit_admin`, `employee`, `security`, `receptionist`, `unit_auditor`

---

### PUT `/api/users/:id`
> **Auth:** `super_admin`, `unit_admin`

**Body (any updatable fields):**
```json
{
  "full_name": "Jane Updated",
  "phone": "+91 9999999999",
  "department_id": 3,
  "designation_id": 7,
  "role_type": "receptionist"
}
```

---

### DELETE `/api/users/:id`
> **Auth:** `super_admin`, `unit_admin`

Deactivates the user (soft delete).

---

---

## 4. 🌐 CENTRAL USERS — `/api/central-users`

> **Auth:** `super_admin` only (all endpoints)
> Central users = `super_admin` + `global_auditor` accounts in the central DB.

### GET `/api/central-users`
**Query Parameters (server-paginated):**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |
| `search` | string | — | Filter by name, email, or employee code |

**Response:**
```json
{
  "success": true,
  "data": {
    "users": [ { "id": 1, "role_type": "super_admin", "full_name": "Super Admin", "email": "sa@company.com" } ],
    "pagination": { "page": 1, "limit": 10, "total": 3, "pages": 1 }
  }
}
```

---

### POST `/api/central-users`
**Body:**
```json
{
  "full_name": "Global Auditor",
  "email": "auditor@company.com",
  "phone": "+91 9000000000",
  "employee_code": "GA-001",
  "password": "Audit@Pass1",
  "role_type": "global_auditor"
}
```
> Only `global_auditor` can be created. `super_admin` cannot be created via UI.

---

### PUT `/api/central-users/:id`
**Body:**
```json
{
  "full_name": "Updated Name",
  "phone": "+91 8888888888",
  "employee_code": "GA-002"
}
```

---

### DELETE `/api/central-users/:id`
Deactivates the central user.

---

---

## 5. 🏬 DEPARTMENTS — `/api/departments`

### GET `/api/departments/public`
> **No auth required**
```
GET /api/departments/public?unit_code=HQ
GET /api/departments/public?unit_id=1
```

---

### GET `/api/departments`
> **Auth:** any unit-level user  
> **Super admin** must send `X-Unit-Id` header

**Query Parameters (server-paginated):**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |
| `search` | string | — | Filter by name or code |

**Response:**
```json
{
  "success": true,
  "data": {
    "departments": [
      { "id": 1, "name": "Engineering", "code": "ENG", "user_count": 12, "designation_count": 5 }
    ],
    "pagination": { "page": 1, "limit": 10, "total": 8, "pages": 1 }
  }
}
```

---

### POST `/api/departments`
> **Auth:** `super_admin`, `unit_admin`

**Body:**
```json
{
  "name": "Finance",
  "code": "FIN",
  "description": "Finance and Accounts",
  "designations": ["Manager", "Analyst", "Clerk"]
}
```

---

### PUT `/api/departments/:id`
**Body:**
```json
{
  "name": "Finance & Accounts",
  "code": "FINAC",
  "description": "Updated description"
}
```

---

### DELETE `/api/departments/:id`
> **Auth:** `super_admin`, `unit_admin`

Fails if users are still assigned to the department.

---

---

## 6. 🏷️ DESIGNATIONS — `/api/designations`

### GET `/api/designations`
> **Auth:** any authenticated user
```
GET /api/designations?department_id=2
```

---

### POST `/api/designations/bulk`
> **Auth:** `super_admin`, `unit_admin`
```json
{
  "department_id": 2,
  "names": ["Senior Engineer", "Junior Engineer", "Tech Lead"]
}
```

---

### PUT `/api/designations/:id`
```json
{ "name": "Principal Engineer" }
```

---

### DELETE `/api/designations/:id`
> **Auth:** `super_admin`, `unit_admin`

---

---

## 7. 👁️ VISITORS — `/api/visitors`

### GET `/api/visitors`
> **Auth:** `super_admin`, `unit_admin`, `security`, `receptionist`, `employee`, auditors  
> Super admin needs `X-Unit-Id`

**Query Parameters (already paginated):**
| Param | Type | Description |
|---|---|---|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 10) |
| `search` | string | Search by name or phone |
| `blacklisted` | boolean | Filter blacklisted visitors |

```
GET /api/visitors?page=1&limit=10&search=John
```

---

### GET `/api/visitors/lookup`
> **Auth required**
```
GET /api/visitors/lookup?phone=9876543210
```

---

### GET `/api/visitors/blacklist-check`
> **Optional auth**
```
GET /api/visitors/blacklist-check?phone=9876543210
```

---

### GET `/api/visitors/:id`
> **Auth required**

---

### POST `/api/visitors`
> **Auth:** `super_admin`, `unit_admin`, `security`, `receptionist`, `employee`

**Body (form-data or JSON):**
```json
{
  "full_name": "Rahul Verma",
  "phone": "9876543210",
  "email": "rahul@example.com",
  "address": "123 Main St, Mumbai",
  "id_type": "Aadhaar",
  "id_number": "1234-5678-9012"
}
```
> Can also include a `photo` as `multipart/form-data`.

---

### POST `/api/visitors/:id/blacklist`
> **Auth:** `super_admin`, `unit_admin`
```json
{ "reason": "Security concern" }
```

---

### PUT `/api/visitors/:id/blacklist/lift`
> **Auth:** `super_admin`, `unit_admin`

---

---

## 8. 📋 VISIT REQUESTS — `/api/visit-requests`

### GET `/api/visit-requests`
> **Auth:** `super_admin`, `unit_admin`, `security`, `receptionist`, `employee`, auditors

**Query Parameters (already paginated):**
| Param | Type | Description |
|---|---|---|
| `page` | number | Page number |
| `limit` | number | Items per page |
| `status` | string | `PENDING`, `APPROVED`, `REJECTED`, `CHECKED_IN`, `CHECKED_OUT` |
| `search` | string | Search by visitor name or purpose |
| `from_date` | date | `YYYY-MM-DD` |
| `to_date` | date | `YYYY-MM-DD` |

---

### GET `/api/visit-requests/my`
> **Auth required** — returns own requests as host/requester

---

### GET `/api/visit-requests/my-visitors`
> **Auth required** — returns visitor history for the logged-in employee

---

### GET `/api/visit-requests/:id`
> **Auth required**

---

### POST `/api/visit-requests`
> **Auth:** `super_admin`, `unit_admin`, `employee`, `security`, `receptionist`

**Body:**
```json
{
  "visit_category": "EMPLOYEE_VISIT",
  "host_user_id": 5,
  "department_id": 2,
  "purpose": "Project discussion",
  "visit_date": "2026-07-20",
  "visit_start_time": "10:00",
  "visit_end_time": "12:00",
  "visitor_name": "Rahul Verma",
  "visitor_phone": "9876543210",
  "visitor_email": "rahul@example.com",
  "accompanying_count": 2,
  "companions": [
    { "full_name": "Companion One", "id_type": "Passport", "id_number": "A1234567" }
  ]
}
```

**`visit_category` options:**
- `EMPLOYEE_VISIT` — visiting an employee
- `VENDOR` — vendor/supplier visit
- `SPOT` — walk-in / spot visit
- `PERSONAL_VISIT` — personal visitor

**`request_source` options:** `SELF`, `HOST`, `RECEPTION`

---

### POST `/api/visit-requests/public`
> **No auth required** — external visitor self-registration

**Body:**
```json
{
  "unit_code": "HQ",
  "visit_category": "EMPLOYEE_VISIT",
  "host_user_id": 5,
  "department_id": 2,
  "purpose": "Interview",
  "visit_date": "2026-07-20",
  "visitor_name": "Jane Visitor",
  "visitor_phone": "9000000001"
}
```

---

### PUT `/api/visit-requests/:id/cancel`
> **Auth required**

---

### POST `/api/visit-requests/:id/blacklist-visitor`
> **Auth:** `super_admin`, `unit_admin`, `employee`
```json
{ "reason": "No-show repeated" }
```

---

### GET `/api/visit-requests/my-blocked-visitors`
> **Auth:** `super_admin`, `unit_admin`, `employee`

---

### DELETE `/api/visit-requests/blocked-visitors/:blockId`
> **Auth:** `super_admin`, `unit_admin`, `employee`

---

---

## 9. ✅ APPROVALS — `/api/approvals`

### GET `/api/approvals/inbox`
> **Auth:** `super_admin` (+X-Unit-Id), `unit_admin`, `employee`, auditors

**Query Parameters (server-paginated — newly added):**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "visit_request_id": 23,
        "visitor_name": "Rahul Verma",
        "visitor_phone": "9876543210",
        "visit_date": "2026-07-20",
        "purpose": "Project discussion",
        "status": "PENDING",
        "host_name": "John Doe",
        "department_name": "Engineering"
      }
    ],
    "pagination": { "page": 1, "limit": 10, "total": 7, "pages": 1 }
  }
}
```

---

### PUT `/api/approvals/:id/approve`
> **Auth:** `super_admin`, `unit_admin`, `employee` (host only)

```
PUT /api/approvals/23/approve
```
Body: none (or optional `{ "notes": "Approved" }`)

---

### PUT `/api/approvals/:id/reject`
> **Auth:** `super_admin`, `unit_admin`, `employee`

```
PUT /api/approvals/23/reject
```
Body: optional `{ "reason": "Not available" }`

---

---

## 10. 🚪 GATE — `/api/gate`

### GET `/api/gate/dashboard`
> **Auth:** all roles

Returns summary stats: today's check-ins, pending requests, active visitors.

---

### GET `/api/gate/active`
> **Auth:** `super_admin`, `unit_admin`, `security`, `receptionist`, auditors

Lists all currently checked-in visitors.

---

### POST `/api/gate/checkin/:requestId`
> **Auth:** `super_admin`, `unit_admin`, `security`, `receptionist`

```
POST /api/gate/checkin/23
```

**Body (multipart/form-data or JSON):**
```json
{
  "notes": "Verified ID"
}
```
> Can include a `photo` file.

---

### POST `/api/gate/checkout`
> **Auth:** `super_admin`, `unit_admin`, `security`, `receptionist`

**Body:**
```json
{ "visit_log_id": 55 }
```

---

### POST `/api/gate/checkout/:visitLogId`
```
POST /api/gate/checkout/55
```

---

### POST `/api/gate/checkout/qr`
> **Auth:** `super_admin`, `unit_admin`, `security`, `receptionist`

**Body:**
```json
{ "qr_code": "VMS-PASS-ABCD1234" }
```

---

### POST `/api/gate/reject`
> **Auth:** `super_admin`, `unit_admin`, `security`

**Body:**
```json
{
  "visit_request_id": 23,
  "reason": "Invalid ID"
}
```

---

---

## 11. 🎫 GATE PASSES — `/api/passes`

### GET `/api/passes`
> **Auth:** `super_admin`, `unit_admin`, `security`, `receptionist`, auditors

**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `status` | string | `ACTIVE`, `USED`, `EXPIRED`, `CANCELLED` |
| `date` | date | `YYYY-MM-DD` |

---

### GET `/api/passes/pass/:passNumber`
```
GET /api/passes/pass/VMS-PASS-ABCD1234
```

---

### POST `/api/passes/generate/:requestId`
> **Auth:** `super_admin`, `unit_admin`, `security`, `receptionist`

```
POST /api/passes/generate/23
```

---

### PUT `/api/passes/:id/cancel`
> **Auth:** `super_admin`, `unit_admin`

---

---

## 12. 📊 REPORTS — `/api/reports`

> All report endpoints require admin/auditor roles.  
> Super admin needs `X-Unit-Id` to target a specific unit.

### GET `/api/reports/visitor-summary`
Returns total visitors, avg visit duration, category breakdown.

**Query Params:** `from_date`, `to_date`

---

### GET `/api/reports/by-status`
```
GET /api/reports/by-status?from_date=2026-07-01&to_date=2026-07-31
```

---

### GET `/api/reports/by-department`
---

### GET `/api/reports/visitor-type`
---

### GET `/api/reports/daily-traffic`
```
GET /api/reports/daily-traffic?days=30
```

---

### GET `/api/reports/top-hosts`
---

### GET `/api/reports/audit-logs`
> **Auth:** `super_admin`, `unit_admin`, `unit_auditor`, `global_auditor`

**Query Parameters (already paginated):**
| Param | Type | Description |
|---|---|---|
| `page` | number | Page number |
| `limit` | number | Items per page |
| `module` | string | Filter by module (e.g. `VISITOR`, `USER`) |
| `action` | string | Filter by action (e.g. `CREATE_VISITOR`) |
| `from_date` | date | Start date |
| `to_date` | date | End date |

---

### GET `/api/reports/audit-logs/global`
> **Auth:** `super_admin`, `global_auditor` only

---

### GET `/api/reports/global-summary`
> **Auth:** `super_admin`, `global_auditor`

---

### GET `/api/reports/global-recent-visits`
> **Auth:** `super_admin`, `global_auditor`

---

### GET `/api/reports/employee-wise`
```
GET /api/reports/employee-wise?from_date=2026-07-01&to_date=2026-07-31
```

---

### GET `/api/reports/department-wise`
---

### GET `/api/reports/unit-wise`
---

### GET `/api/reports/rejected`
---

### GET `/api/reports/active-expected`
---

### GET `/api/reports/visit-history`
---

### GET `/api/reports/meta/units`
### GET `/api/reports/meta/departments`
### GET `/api/reports/meta/employees`
> Used to populate filter dropdowns in the Reports UI.

---

---

## 13. 📦 ARCHIVE — `/api/archive`

### GET `/api/archive`
> **Auth:** `unit_admin`, `super_admin` (+X-Unit-Id)

Returns archive status per financial year.

---

### POST `/api/archive/run`
> **Auth:** `unit_admin`, `super_admin`
```json
{ "financial_year": "2025-26" }
```

---

### GET `/api/archive/:fy/download`
```
GET /api/archive/2025-26/download
```

---

### DELETE `/api/archive/:fy/purge`
> **⚠️ Destructive — permanently deletes archived data**
```
DELETE /api/archive/2025-26/purge
```

---

### GET `/api/archive/global` *(super_admin only)*
### POST `/api/archive/global/run` *(super_admin only)*
### GET `/api/archive/global/:fy/download` *(super_admin only)*
### DELETE `/api/archive/global/:fy/purge` *(super_admin only)*

---

---

## 14. 📲 OTP — `/api/otp`

### POST `/api/otp/send`
> **Optional auth** (unit's DB resolved from token or unit_code)

```json
{
  "phone": "9876543210",
  "purpose": "visitor_checkin"
}
```

---

### POST `/api/otp/verify`
```json
{
  "phone": "9876543210",
  "otp": "123456",
  "purpose": "visitor_checkin"
}
```

---

---

## 15. 🖼️ STATIC FILES

### GET `/uploads/:filename`
> No auth required — visitor photos served as static files
```
GET http://localhost:5000/uploads/visitor_1234567890.jpg
```

---

---

## 📌 Pagination — Testing Checklist

These are the **newly implemented server-side paginated endpoints**. Test each one by changing `page` values:

| Endpoint | Test URL |
|---|---|
| Approval Inbox | `GET /api/approvals/inbox?page=1&limit=5` |
| Users | `GET /api/users?page=2&limit=5&role=employee` |
| Users + Search | `GET /api/users?page=1&limit=10&search=john` |
| Central Users | `GET /api/central-users?page=1&limit=5` |
| Central Users + Search | `GET /api/central-users?page=1&search=admin` |
| Units | `GET /api/units?page=1&limit=5` |
| Units + Search | `GET /api/units?search=mumbai` |
| Departments | `GET /api/departments?page=1&limit=5` |
| Departments + Search | `GET /api/departments?search=eng` |

**Expected pagination shape in every response:**
```json
"pagination": {
  "page": 1,
  "limit": 10,
  "total": 47,
  "pages": 5
}
```

---

## 🔧 Postman Environment Setup (Recommended)

Create a Postman **Environment** with these variables:

| Variable | Value |
|---|---|
| `base_url` | `http://localhost:5000/api` |
| `token` | *(paste token after login)* |
| `unit_id` | *(set after listing units)* |

**Auth Header (apply to collection):**
- Type: **Bearer Token**
- Token: `{{token}}`

**For Super Admin unit operations, add to Headers tab:**
- Key: `X-Unit-Id`
- Value: `{{unit_id}}`
