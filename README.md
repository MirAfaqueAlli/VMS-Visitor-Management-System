# 🚪 Visitor Management System (VMS)

A robust, modern, and highly secure **Visitor Management System (VMS)** built using a decoupled React (frontend) and Node.js/Express (backend) architecture. The system streamlines visitor registrations, manages check-ins/check-outs, processes approvals from organizational administrators, and facilitates gate security clearance using dynamic QR codes and badge verification.

---

## 🌟 Key Features

### 🏢 Organization & Department Management
- **Multi-Tenant Capability**: Support registration and management of multiple organizations.
- **Department Routing**: Department-level hierarchies to streamline visitor routing and approval workflows.

### ✍️ Visitor Registration & Workflow
- **Public & Guided Requests**: Visitors can request gate passes through a public page or be registered directly.
- **Biometric & Verification Ready**: Upload visitor photos and ID proofs securely.
- **QR Code Gate Passes**: Automatic generation of secure, unique QR codes for passes to enable rapid scan-to-verify.

### 🛡️ Multi-Level Access Control & Permissions
- **Role-Based Access (RBAC)**: Custom panels and functionalities tailored for **Super Admins**, **Org Admins**, **Department Admins**, and **Security Personnel**.
- **Real-Time Approval System**: Immediate notifications and action logs for request approvals.

### 📊 Analytics & Reporting
- **Visitor Logs**: Searchable, paginated audit trails of visitor entries, exits, and active presence.
- **Export & Insight Panels**: View real-time stats of current visitors, pending clearances, and historical logs.

---

## 💻 Tech Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Frontend** | React 19, Vite, TailwindCSS | Ultra-fast, responsive user interface with clean and harmonized UI patterns. |
| **Backend** | Node.js, Express 5 | High-performance API server with rate-limiting, sanitization, and structured routing. |
| **Database** | MySQL | Relational data integrity for organizations, departments, users, and logs. |
| **Security** | JSON Web Tokens (JWT), Bcrypt, Helmet | Comprehensive authentication, secure HTTP headers, and hashed user credentials. |

---

## 🚀 Getting Started

### 📋 Prerequisites
- **Node.js** (v18 or higher recommended)
- **npm** (v9 or higher)
- **MySQL Database Server** (v8.x recommended)

---

### 🗄️ 1. Database Setup

All database schema scripts are organized in the `/database` directory:

1. Log in to your MySQL terminal or client (e.g., MySQL Workbench, phpMyAdmin):
   ```sql
   CREATE DATABASE vms_db;
   ```
2. Run the **full setup schema** to initialize all tables, relationships, and indexes:
   ```bash
   mysql -u your_user -p vms_db < database/vms_full_setup.sql
   ```
3. (Optional) Run the **seed data script** to load pre-configured roles, initial departments, and test users:
   ```bash
   mysql -u your_user -p vms_db < database/seed_data.sql
   ```

---

### ⚙️ 2. Backend Setup & Configuration

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables. Copy the `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
4. Edit the newly created `.env` file with your local MySQL database credentials, SMTP configuration (for email notifications), and a secure secret key for signing JWTs:
   ```env
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_mysql_password
   DB_NAME=vms_db
   JWT_SECRET=your_super_secret_jwt_key
   ```
5. Start the backend in development mode (with hot-reloading via `nodemon`):
   ```bash
   npm run dev
   ```
   *The server runs by default on `http://localhost:5000`.*

---

### 🎨 3. Frontend Setup & Configuration

1. Navigate to the frontend directory:
   ```bash
   cd ../frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure the environment variables. Copy the `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
4. If necessary, adjust the API connection URL:
   ```env
   VITE_API_URL=http://localhost:5000/api
   ```
5. Run the frontend dev server:
   ```bash
   npm run dev
   ```
   *The client app will launch at `http://localhost:5173`.*

---

## 📂 Project Directory Structure

```filepath
├── backend/
│   ├── controllers/      # API Request handlers (Users, Passes, Visitors, etc.)
│   ├── routes/           # Express router endpoints mapped to controllers
│   ├── middlewares/      # JWT Authentication & authorization guards
│   ├── uploads/          # Dynamic files (Visitor pictures, QR codes, ID proofs)
│   ├── db.js             # MySQL Connection Pool initializer
│   ├── server.js         # Express app bootstrap & security config
│   ├── .env.example      # Backend environment template
│   └── package.json
├── database/
│   ├── vms_full_setup.sql# Master SQL database schema setup
│   ├── vms_schema.sql    # Clean tables database schema (without seeds)
│   ├── migrate_saas.sql  # Database migrations
│   └── seed_data.sql     # Initial seed database records
├── frontend/
│   ├── src/
│   │   ├── components/   # Shared presentation components (Sidebar, Navbar, Cards)
│   │   ├── context/      # AuthContext and App State providers
│   │   ├── pages/        # Router views (Dashboard, Gate Control, Admin, Registration)
│   │   ├── App.jsx       # Layout structure & routing mappings
│   │   └── main.jsx
│   ├── index.html
│   ├── .env.example      # Frontend environment template
│   └── package.json
└── README.md             # This master documentation file
```

---

## 🔒 Security Best Practices Implemented

- **Password Hashing**: Done securely using `bcrypt` on the backend before database insertion.
- **SQL Injection Defense**: Uses prepared statements via the `mysql2/promise` package.
- **CORS Protection**: Access limits configured dynamically using customizable white-lists.
- **Secure Headers**: Configured using Express `helmet` middleware.
- **API Rate Limiting**: Avoids brute-force attacks via standard `express-rate-limit`.
- **Environment Isolation**: No hardcoded API keys, passwords, or emails; all configurations load strictly from isolated `.env` environments.

---

## 🤝 Contributing

Contributions to enhance VMS are welcome!
1. Fork the project.
2. Create a Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## 📄 License
Distributed under the ISC License. See `backend/package.json` for details.
