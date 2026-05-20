const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const db = require("./db");

const authRoutes = require("./routes/auth.routes");
const visitorRoutes = require("./routes/visitor.routes");
const visitRequestRoutes = require("./routes/visitRequest.routes");
const approvalRoutes = require("./routes/approval.routes");
const otpRoutes = require("./routes/otp.routes");
const gateRoutes = require("./routes/gate.routes");
const gatePassRoutes = require("./routes/gatePass.routes");
const userRoutes = require("./routes/user.routes");
const reportRoutes = require("./routes/report.routes");
const departmentRoutes = require("./routes/department.routes");
const organizationRoutes = require("./routes/organization.routes");

const app = express();

// Security Middlewares
app.use(helmet()); // Sets secure HTTP headers
app.use(
  cors({
    origin: [
      process.env.CLIENT_URL,
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
    ].filter(Boolean),
    credentials: true,
  }),
);

// Rate limiting to prevent brute force
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 100 : 10000, // Strict limit in production, relaxed for local dev
  message: "Too many requests from this IP, please try again later.",
});
app.use("/api/", limiter);

// Standard Middlewares
app.use(morgan("combined")); // HTTP request logger
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static file serving for uploaded photos and QR codes ────────────────────
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── API Routes ──────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/visitors", visitorRoutes);
app.use("/api/visit-requests", visitRequestRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/gate", gateRoutes);
app.use("/api/passes", gatePassRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/organizations", organizationRoutes);

// Basic health check route
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res
      .status(200)
      .json({
        status: "OK",
        message: "Server is running securely and DB is connected",
      });
  } catch (error) {
    console.error("Database connection failed:", error);
    res
      .status(500)
      .json({ status: "ERROR", message: "Database connection failed" });
  }
});

// Centralized Error Handling Middleware (To be implemented fully later)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res
    .status(500)
    .json({
      status: "ERROR",
      message: "Internal Server Error",
      error: err.message,
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(` Backend is running on port ${PORT}`);
});
