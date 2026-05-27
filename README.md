# 🚪 Visitor Management System (VMS)

A secure, multi-tenant **Visitor Management System** built for government offices, PSUs, and secured premises. It digitises the complete visitor lifecycle — registration → approval → gate pass → check-in/check-out — with role-based access control, QR code gate passes, SMS/email notifications, and financial year archiving.

---

## 🌟 Key Features

| Feature | Details |
|---|---|
| **4 Visitor Types** | Employee Visit, Vendor/AMC, Prior Approval, Spot Walk-in |
| **Approval Workflow** | Host / Unit Admin approval flow |
| **QR Code Gate Passes** | Auto-generated, printable, scan-to-verify |
| **Role-Based Access** | 7 roles: Super Admin, Unit Admin, Employee, Security, Receptionist, Auditor |
| **Multi-Unit / Multi-Tenant** | Each unit has its own isolated MySQL database |
| **SMS & Email Alerts** | Visitor notified on approval/rejection |
| **Financial Year Archive** | Backup + purge old records per Indian FY (Apr–Mar) |
| **Audit Logs** | Full immutable trail of all actions |
| **Reports & Analytics** | Overview charts, department breakdowns, host activity |
| **Public Registration** | Visitors self-register via shareable public link |

---

## 💻 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite, Vanilla CSS (custom design system) |
| **Backend** | Node.js, Express 5, mysql2 |
| **Database** | MySQL 8 — one central DB + one isolated DB per unit |
| **Auth** | JWT (RS256), bcrypt, Helmet, express-rate-limit |
| **Notifications** | Nodemailer (SMTP), Fast2SMS (optional) |
| **Gate Passes** | QR code generation via `qrcode` library |

---

## 📋 Prerequisites

Before you begin, make sure you have:

- **Node.js** v18 or higher — [Download](https://nodejs.org/)
- **npm** v9 or higher (comes with Node.js)
- **MySQL Server** v8.x — [Download](https://dev.mysql.com/downloads/mysql/)
- A MySQL user with **CREATE DATABASE** privileges (root works for local dev)

---

## 🚀 First-Time Setup (Step by Step)

### Step 1 — Clone & enter the project

```bash
git clone <your-repo-url>
cd <project-folder>
```

---

### Step 2 — Configure the Backend

```bash
cd backend
```

**Install dependencies:**
```bash
npm install
```

**Create your `.env` file:**
```bash
# On Windows
copy .env.example .env

# On Mac/Linux
cp .env.example .env
```

**Edit `.env` with your settings:**
```env
# MySQL connection
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password

# Central database name (created automatically)
DB_CENTRAL_NAME=vms_central

# JWT secret — use any long random string
JWT_SECRET=replace_with_a_long_random_secret_key_here

# (Optional) Email notifications via SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_gmail_app_password
EMAIL_FROM="VMS System" <your@gmail.com>
```

> 💡 Email and SMS are optional. The system works fully without them — notifications are simply skipped.

---

### Step 3 — Initialize the Database

Run the reset script. It will:
- Create the `vms_central` database from scratch
- Apply the full schema (tables, indexes, lookup data)
- Leave it empty so you set up your own org and admin

```bash
npm run reset-db
```

Expected output:
```
✅  Connected to MySQL at localhost:3306
[ 1 / 3 ]  Dropping unit databases…   → none found
[ 2 / 3 ]  Recreating central database: vms_central
[ 3 / 3 ]  Verifying clean state…
✅  Organizations: empty ✓
✅  Units: empty ✓
✅  Users: empty ✓
✅  Clean reset complete!
```

> ⚠️ **Do NOT manually run any SQL files.** The `reset-db` script handles everything automatically.

---

### Step 4 — Start the Backend

```bash
npm run dev
```

The API server starts at **`http://localhost:5000`**

---

### Step 5 — Configure & Start the Frontend

Open a new terminal:

```bash
cd frontend
npm install
```

**Create your `.env` file:**
```bash
# Windows
copy .env.example .env

# Mac/Linux
cp .env.example .env
```

The default `.env` content is already correct for local development:
```env
VITE_API_URL=http://localhost:5000/api
```

**Start the frontend:**
```bash
npm run dev
```

The app opens at **`http://localhost:5173`**

---

### Step 6 — Initialize the System (First Run Only)

Open your browser and go to:

```
http://localhost:5173/setup
```

You will see the **Setup Wizard**. Fill in:

| Field | Description |
|---|---|
| Organization Name | Your company / department name |
| Organization Code | Short unique code (e.g. `MYCO`) |
| Super Admin Name | Your full name |
| Super Admin Email | Your login email |
| Super Admin Password | Minimum 8 characters |

Click **"Initialize System"** — this creates your organization and Super Admin account.

> This setup page is only accessible once. After initialization it becomes inaccessible.

---

### Step 7 — Log In and Configure

Go to:
```
http://localhost:5173/login
```

Log in with the Super Admin credentials you just created.

**From the dashboard, complete the following:**

1. **Create a Unit** → *Super Admin → Unit Management → New Unit*  
   *(Each unit gets its own isolated database, auto-provisioned)*

2. **Add Departments** → *Unit Admin → User Management → Departments*

3. **Create Users** → *Unit Admin → User Management → New User*  
   Assign roles: `unit_admin`, `employee`, `security`, `receptionist`

4. **Share the Public Link** → Visitors can self-register at:
   ```
   http://localhost:5173/public-request
   ```

---

## 📂 Project Structure

```
VMS/
├── backend/
│   ├── controllers/          # Business logic (one file per feature)
│   ├── routes/               # Express route definitions
│   ├── middlewares/          # JWT auth, RBAC, file upload, validation
│   ├── services/             # DB manager, email, QR code, notifications
│   ├── utils/                # Audit logger, response helpers, pass numbering
│   ├── scripts/
│   │   ├── reset_db.js       # ← Full DB wipe + fresh schema (run to reset)
│   │   └── seed_unit.js      # Dev-only: seeds demo data into a unit
│   ├── uploads/              # Runtime files (gitignored)
│   │   ├── visitor-photos/
│   │   ├── qrcodes/
│   │   └── id-proofs/
│   ├── .env.example          # ← Copy this to .env and fill in your values
│   ├── server.js
│   └── package.json
│
├── database/
│   ├── vms_central_schema.sql  # Central DB schema (used by reset_db.js)
│   └── vms_unit_schema.sql     # Per-unit DB schema (used by provisionUnitDb)
│
├── frontend/
│   └── src/
│       ├── api/              # Axios client with auth + unit headers
│       ├── components/       # Layout (Sidebar, Navbar) + shared components
│       ├── context/          # AuthContext (user, token, activeUnit)
│       ├── hooks/            # useAuth hook
│       └── pages/
│           ├── admin/        # User mgmt, Departments, FY Archive
│           ├── approvals/    # Approval inbox
│           ├── audit/        # Audit log viewer
│           ├── auth/         # Login, Setup wizard
│           ├── dashboard/    # Overview + live stats
│           ├── gate/         # Check-in, Check-out, Gate Pass print
│           ├── reports/      # Charts + tabular reports
│           ├── requests/     # New request, request list/detail
│           ├── super/        # Unit management, Global users
│           └── visitors/     # Visitor registry
│
├── .gitignore
└── README.md
```

---

## 👥 User Roles

| Role | Access |
|---|---|
| `super_admin` | Full system access, manages all units |
| `unit_admin` | Full access within their unit |
| `employee` | Raises visit requests, approves requests directed to them |
| `security` | Gate check-in / check-out |
| `receptionist` | Visitor registration, gate operations |
| `unit_auditor` | Read-only: reports and audit logs for their unit |
| `global_auditor` | Read-only: reports and audit logs across all units |

---

## 🔄 Resetting to a Clean Slate

To completely wipe all data and start fresh:

```bash
cd backend
npm run reset-db
```

Then go to `http://localhost:5173/setup` and re-initialize.

---

## 🔒 Security

- Passwords hashed with **bcrypt** (cost factor 12)
- All API routes protected by **JWT Bearer tokens**
- Super admin and unit users stored in **separate databases** (token-bound pool isolation)
- **CORS** restricted to configured `CLIENT_URL`
- **Rate limiting** on all `/api/` routes
- **Helmet** sets secure HTTP headers
- No credentials, secrets, or generated files in the repository

---

## 📄 License

Distributed under the **ISC License**. See `backend/package.json` for details.
