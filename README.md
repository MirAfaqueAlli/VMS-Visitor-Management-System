# 🚪 Visitor Management System (VMS)

A secure, multi-tenant **Visitor Management System** built for government offices, PSUs, and secured premises. It digitises the complete visitor lifecycle — registration → approval → gate pass → check-in/check-out — with role-based access control, QR-code gate passes, real-time web-push notifications, SMS/email alerts, and financial-year archiving.

---

## 🌟 Key Features

| Feature | Details |
|---|---|
| **5 Visit Types** | Employee Visit, Vendor/AMC, Personal Visit, Spot Walk-in, Public Self-Registration |
| **Approval Workflow** | Host / Unit Admin approval with conflict detection |
| **QR Code Gate Passes** | Auto-generated, printable, scan-to-verify |
| **Real-Time Notifications** | Socket.IO → browser Web Push for every key event |
| **Role-Based Access** | 7 roles — Super Admin through Auditor |
| **Multi-Unit / Multi-Tenant** | Each unit has its own isolated MySQL database |
| **SMS & Email Alerts** | Visitor notified on approval / rejection |
| **Financial Year Archive** | Backup + purge old records per Indian FY (Apr–Mar) |
| **Audit Logs** | Full immutable trail of all actions |
| **Reports & Analytics** | Overview charts, department breakdowns, host activity |
| **Visitor Blacklist** | Unit-level and host-level phone blacklisting |
| **Public Registration** | Visitors self-register via a shareable public link |

---

## 💻 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, Vanilla CSS (custom design system) |
| **Backend** | Node.js, Express, mysql2 |
| **Database** | MySQL 8 — one central DB + one isolated DB per unit |
| **Real-time** | Socket.IO (WebSocket + polling fallback) |
| **Auth** | JWT, bcrypt (cost 12), Helmet, express-rate-limit |
| **Notifications** | Nodemailer (SMTP), Fast2SMS (optional), Browser Web Push (SW) |
| **Gate Passes** | QR code generation via `qrcode` library |

---

## 📋 Prerequisites

- **Node.js** v18+ — [nodejs.org](https://nodejs.org/)
- **npm** v9+ (bundled with Node)
- **MySQL Server** v8.x — [dev.mysql.com](https://dev.mysql.com/downloads/mysql/)
- A MySQL user with **CREATE DATABASE** privilege (`root` is fine for local dev)

---

## 🚀 First-Time Setup

### Step 1 — Clone & enter the project

```bash
git clone <your-repo-url>
cd <project-folder>
```

### Step 2 — Configure the backend

```bash
cd backend
npm install
```

Copy and edit the environment file:

```bash
# Windows
copy .env.example .env

# Mac / Linux
cp .env.example .env
```

Key values to fill in:

```env
# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_CENTRAL_NAME=vms_central

# JWT — any long random string
JWT_SECRET=replace_with_a_long_random_secret_key

# (Optional) SMTP for email alerts
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_gmail_app_password
EMAIL_FROM="VMS System" <your@gmail.com>
```

> 💡 Email and SMS are optional — the system works fully without them.

### Step 3 — Initialise the database

```bash
npm run reset-db
```

Expected output:

```
✅  Connected to MySQL at localhost:3306
[ 1 / 3 ]  Dropping unit databases…   → none found
[ 2 / 3 ]  Recreating central database: vms_central
[ 3 / 3 ]  Verifying clean state…
✅  Clean reset complete!
```

> ⚠️ Do **not** manually run any `.sql` files — the reset script handles everything.

### Step 4 — Start the backend

```bash
npm run dev
```

API server starts at **`http://localhost:5000`**

### Step 5 — Configure & start the frontend

Open a new terminal:

```bash
cd frontend
npm install
```

```bash
# Windows
copy .env.example .env

# Mac / Linux
cp .env.example .env
```

The default `.env` is already correct for local dev:

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

```bash
npm run dev
```

App opens at **`http://localhost:5173`**

### Step 6 — Run the Setup Wizard (first run only)

Go to:

```
http://localhost:5173/setup
```

Fill in your organisation name, a short code, and Super Admin credentials, then click **"Initialize System"**. This page is disabled after first use.

### Step 7 — Log in and configure

1. **Create a Unit** → *Super Admin → Unit Management → New Unit*
   *(Each unit auto-provisions its own isolated MySQL database)*
2. **Add Departments** → *Unit Admin → User Management → Departments*
3. **Create Users** → *Unit Admin → User Management → New User*
   Assign roles: `unit_admin`, `employee`, `security`, `receptionist`
4. **Share the Public Link** — visitors self-register at:
   ```
   http://localhost:5173/public-request
   ```

---

## 📂 Project Structure

```
VMS/
├── backend/
│   ├── controllers/          # Request handlers — one file per feature
│   ├── routes/               # Express routers — URL to controller mapping
│   ├── middlewares/          # JWT auth, RBAC, file upload, input validation
│   ├── services/             # DB manager, email, OTP, gate pass, QR code
│   ├── socket/               # Socket.IO server & room management
│   ├── utils/                # Response helpers, audit logger, pass numbering
│   ├── database/             # SQL schemas — read by scripts at runtime
│   │   ├── vms_central_schema.sql   # Central DB schema
│   │   ├── vms_unit_schema.sql      # Per-unit DB schema template
│   │   ├── reset.js                 # Standalone lightweight DB reset
│   │   └── reset_all.sql            # Manual full-wipe SQL (reference)
│   ├── migrations/           # Incremental SQL migration patches
│   ├── scripts/              # One-off maintenance & seeding scripts
│   │   ├── reset_db.js       # Full DB wipe + fresh schema  (npm run reset-db)
│   │   ├── seed_unit.js      # Dev-only: seeds demo data into a unit
│   │   ├── patch_gate_passes.js
│   │   └── patch_request_source.js
│   ├── uploads/              # Runtime files — visitor photos, QR codes (gitignored)
│   ├── .env.example          # Copy to .env and fill in your values
│   ├── db.js                 # Deprecated compat shim → re-exports centralPool
│   ├── reset.js              # Alias DB reset script
│   ├── server.js             # Entry point — Express + Socket.IO bootstrap
│   └── package.json
│
├── frontend/
│   └── src/
│       ├── api/              # Axios instance with auth interceptors
│       ├── components/
│       │   ├── Layout/       # AppLayout, Navbar, Sidebar, ProtectedRoute
│       │   └── shared/       # StatusBadge, PaperGrain
│       ├── context/          # AuthContext, SocketContext, ThemeContext
│       ├── hooks/            # useAuth, useSocketEvent, useWebNotification
│       └── pages/
│           ├── admin/        # User management, Departments, FY Archive
│           ├── approvals/    # Approval inbox
│           ├── audit/        # Audit log viewer
│           ├── auth/         # Login page, Setup wizard
│           ├── dashboard/    # Role-aware overview + live stats
│           ├── gate/         # Check-in, Check-out, Gate Pass print
│           ├── profile/      # User profile & password change
│           ├── reports/      # Charts and tabular reports
│           ├── requests/     # New request form, request list & detail
│           ├── super/        # Unit management, Global users
│           └── visitors/     # Visitor registry & blacklist
│
├── .gitignore
└── README.md
```

---

## 🏗️ Architecture

### Multi-Tenant Database Model

VMS uses a **database-per-unit** multi-tenancy pattern:

- **`vms_central`** — Stores organisations, units, and super-admin users.
- **`vms_unit_<code>`** — One database per unit/branch containing users, visit requests, gate passes, audit logs, etc.

Connection pools for all unit databases are managed lazily in `backend/services/dbManager.js`. The `auth.middleware.js` attaches `req.db` (the correct unit pool) and `req.user` to every authenticated request. When a new unit is created, `provisionUnitDb()` automatically creates its database and applies `vms_unit_schema.sql`.

### Visit Categories

| Category | Created By | Auto-Approved? | Approval From |
|---|---|---|---|
| `EMPLOYEE_VISIT` (SELF) | Employee visiting another | No | Host employee |
| `EMPLOYEE_VISIT` (HOST) | Employee hosting a visitor | Yes | — |
| `PERSONAL_VISIT` | Employee for personal guest | Yes | — |
| `VENDOR` | Employee for vendor/AMC | Yes | — |
| `SPOT` | Security / Receptionist | No | Host employee |
| Public Request | Visitor (unauthenticated) | No | Host employee |

### Real-Time Notification Flow

All key events emit Socket.IO messages to scoped user/unit rooms, triggering browser Web Push notifications via a registered Service Worker:

| Trigger | Recipients | Channel |
|---|---|---|
| New PENDING request | Host employee | Socket → Web Push |
| Request APPROVED | Requester / Security | Socket → Web Push |
| Request REJECTED | Requester / Security | Socket → Web Push |
| Visitor check-in | Host + Security/Reception | Socket → Web Push |
| Visitor check-out | Security / Reception | Socket → Web Push |
| Request approved/rejected | Visitor | Email + SMS |

---

## 👥 User Roles

| Role | Scope | Access |
|---|---|---|
| `super_admin` | Global | Full system — manages all units and global settings |
| `unit_admin` | Unit | Full access within their unit |
| `employee` | Unit | Raises visit requests; approves requests directed to them |
| `security` | Unit | Gate check-in / check-out; creates SPOT requests |
| `receptionist` | Unit | Visitor registration, gate operations, SPOT requests |
| `unit_auditor` | Unit | Read-only: reports and audit logs for their unit |
| `global_auditor` | Global | Read-only: reports and audit logs across all units |

---

## 🔄 Resetting to a Clean Slate

```bash
cd backend
npm run reset-db
```

Then go to `http://localhost:5173/setup` and re-initialise.

---

## 🚢 Deploying to Production

### 1 — Set production environment variables

On your server, create `backend/.env` with production values:

```env
NODE_ENV=production
PORT=5000
CLIENT_URL=https://your-domain.com

DB_HOST=your-db-host
DB_USER=your-db-user
DB_PASSWORD=your-strong-password
DB_CENTRAL_NAME=vms_central

JWT_SECRET=a_very_long_random_string_at_least_64_characters
JWT_EXPIRES_IN=24h

SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your_smtp_password
EMAIL_FROM="VMS" <your@email.com>
```

### 2 — Build the frontend

```bash
cd frontend
npm ci
npm run build
# Static output lands in frontend/dist/
```

### 3 — Run the backend with PM2

```bash
npm install -g pm2

cd backend
npm ci --omit=dev
npm run reset-db        # First deploy only — creates the DB schema

pm2 start server.js --name vms-backend
pm2 save
pm2 startup             # Registers PM2 to auto-start on server reboot
```

### 4 — Nginx configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Serve the built React SPA
    root /path/to/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to Node backend
    location /api/ {
        proxy_pass         http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Proxy Socket.IO for real-time notifications
    location /socket.io/ {
        proxy_pass         http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
    }

    # Serve uploaded visitor photos and QR codes
    location /uploads/ {
        alias /path/to/backend/uploads/;
    }
}
```

> Enable HTTPS with Certbot: `sudo certbot --nginx -d your-domain.com`

---

## 🔒 Security

- Passwords hashed with **bcrypt** (cost factor 12)
- All API routes protected by **JWT Bearer tokens**
- Super admin and unit users stored in **separate databases** (token-bound pool isolation)
- **CORS** restricted to the configured `CLIENT_URL`
- **Rate limiting** on all `/api/` routes (100 req / 15 min in production)
- **Helmet** sets secure HTTP response headers
- No credentials, secrets, or generated files committed to the repository

---

## 📄 License

Distributed under the **ISC License**. See `backend/package.json` for details.
