const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const path = require("path");

dotenv.config();

/* =========================================================
   JWT SECRET CHECK
   ========================================================= */

if (!process.env.JWT_SECRET) {
  console.error(
    "JWT_SECRET is missing. Add it to Render Environment Variables."
  );
  process.exit(1);
}

/* =========================================================
   DATABASE
   ========================================================= */

const db = require("./database");

/* =========================================================
   AUTH ROUTES
   ========================================================= */

const authRoutes = require("./routes/authRoutes");

/* =========================================================
   OPTIONAL ROUTES
   ========================================================= */

let taskRoutes;
let missionRoutes;
let activityRoutes;
let performanceRoutes;
let adminRoutes;
let studentRoutes;
let notificationRoutes;
let auditRoutes;
let studentsRoutes;

try {
  taskRoutes = require("./routes/taskRoutes");
} catch (error) {
  console.log("taskRoutes not loaded:", error.message);
}

try {
  missionRoutes = require("./routes/missionRoutes");
} catch (error) {
  console.log("missionRoutes not loaded:", error.message);
}

try {
  activityRoutes = require("./routes/activityRoutes");
} catch (error) {
  console.log("activityRoutes not loaded:", error.message);
}

try {
  performanceRoutes = require("./routes/performanceRoutes");
} catch (error) {
  console.log("performanceRoutes not loaded:", error.message);
}

try {
  adminRoutes = require("./routes/adminRoutes");
} catch (error) {
  console.log("adminRoutes not loaded:", error.message);
}

try {
  studentRoutes = require("./routes/studentRoutes");
} catch (error) {
  console.log("studentRoutes not loaded:", error.message);
}

try {
  notificationRoutes = require("./routes/notificationRoutes");
} catch (error) {
  console.log("notificationRoutes not loaded:", error.message);
}

try {
  auditRoutes = require("./routes/auditRoutes");
} catch (error) {
  console.log("auditRoutes not loaded:", error.message);
}

try {
  studentsRoutes = require("./routes/studentsRoutes");
} catch (error) {
  console.log("studentsRoutes not loaded:", error.message);
}

/* =========================================================
   EXPRESS APP
   ========================================================= */

const app = express();

const PORT = Number(process.env.PORT) || 5000;

/* =========================================================
   CORS
   ========================================================= */

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "https://technis-work-portal-05.vercel.app",
  "https://technis-work-portal-05-ep1h6tgcr.vercel.app",
];

console.log("Allowed CORS origins:");
console.log(allowedOrigins);

app.use(
  cors({
    origin: function (origin, callback) {
      /*
       * Allow requests without an Origin header.
       * This is required for PowerShell/Postman testing.
       */
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("Blocked CORS origin:", origin);

      return callback(
        new Error("Not allowed by CORS")
      );
    },

    credentials: true,

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

/* =========================================================
   BODY PARSERS
   ========================================================= */

app.use(
  express.json({
    limit: "1mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

/* =========================================================
   STATIC FILES (AVATAR UPLOADS)
   ========================================================= */

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* =========================================================
   DATABASE CONNECTION
   ========================================================= */

app.locals.db = db;

console.log("SQLite database connected");

/* =========================================================
   STUDENT SEEDING (if STUDENT_SEED_DATA is set)
   ========================================================= */

if (process.env.STUDENT_SEED_DATA) {
  try {
    const { seedStudents } = require("./seed-students");
    console.log("STUDENT_SEED_DATA is set, running student seed...");
    seedStudents(process.env.STUDENT_SEED_DATA);
    console.log("Student seed completed");
  } catch (error) {
    console.error("Student seed failed:", error);
    process.exit(1);
  }
}

/* =========================================================
   JWT SECRET
   ========================================================= */

function getSecret() {
  return String(process.env.JWT_SECRET);
}

/* =========================================================
   DEFAULT ACCOUNTS
   =========================================================

   ADMIN
   Email    : ceo@techins.com
   Password : ceo@2006

   MANAGER
   Email    : manager@techins.com
   Password : Manager@123

   STUDENT
   Email    : student@techins.com
   Password : Student@123

   IMPORTANT:
   These passwords are intentionally hard-coded here.

   They do NOT use:
   ADMIN_PASSWORD
   MANAGER_PASSWORD
   STUDENT_PASSWORD

   This makes sure Render creates the same credentials
   every time the server starts.
   ========================================================= */

function ensureDefaultAccounts() {
  try {
    const accounts = [
      {
        name: "TECHINS Admin",
        email: "ceo@techins.com",
        password: "ceo@2006",
        role: "admin",
        department: "Administration",
      },

      {
        name: "TECHINS Manager",
        email: "manager@techins.com",
        password: "Manager@123",
        role: "manager",
        department: "Techins",
      },
    ];

    /* =====================================================
       FIND USER
       ===================================================== */

    const findUser = db.prepare(`
      SELECT
        id,
        name,
        email,
        password,
        role,
        department,
        active
      FROM users
      WHERE LOWER(TRIM(email)) = ?
      LIMIT 1
    `);

    /* =====================================================
       UPDATE USER
       ===================================================== */

    const updateUser = db.prepare(`
      UPDATE users
      SET
        name = ?,
        password = ?,
        role = ?,
        department = ?,
        active = 1
      WHERE id = ?
    `);

    /* =====================================================
       INSERT USER
       ===================================================== */

    const insertUser = db.prepare(`
      INSERT INTO users
      (
        name,
        email,
        password,
        role,
        department,
        active
      )
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    /* =====================================================
       CREATE / UPDATE ACCOUNTS
       ===================================================== */

    for (const account of accounts) {
      const plainPassword = String(
        account.password
      );

      /* Generate fresh bcrypt hash */
      const hashedPassword = bcrypt.hashSync(
        plainPassword,
        12
      );

      if (
        !hashedPassword ||
        !hashedPassword.startsWith("$2")
      ) {
        throw new Error(
          `Password hash generation failed for ${account.email}`
        );
      }

      console.log(
        `Password hash generated for ${account.email}: true`
      );

      /* Check if account exists */
      const existingUser = findUser.get(
        account.email
      );

      /* ===================================================
         UPDATE EXISTING ACCOUNT
         =================================================== */

      if (existingUser) {
        updateUser.run(
          account.name,
          hashedPassword,
          account.role,
          account.department,
          existingUser.id
        );

        console.log(
          `${account.role.toUpperCase()} account updated: ${account.email}`
        );
      }

      /* ===================================================
         CREATE NEW ACCOUNT
         =================================================== */

      else {
        insertUser.run(
          account.name,
          account.email,
          hashedPassword,
          account.role,
          account.department
        );

        console.log(
          `${account.role.toUpperCase()} account created: ${account.email}`
        );
      }

      /* ===================================================
         READ ACCOUNT AGAIN
         =================================================== */

      const savedUser = findUser.get(
        account.email
      );

      if (!savedUser) {
        throw new Error(
          `Unable to read ${account.email} after saving`
        );
      }

      /* ===================================================
         VERIFY PASSWORD
         =================================================== */

      const passwordVerified =
        bcrypt.compareSync(
          plainPassword,
          String(savedUser.password)
        );

      console.log(
        `Password verification for ${account.email}: ${passwordVerified}`
      );

      if (!passwordVerified) {
        throw new Error(
          `Password verification failed for ${account.email}`
        );
      }

      /* ===================================================
         VERIFY ACTIVE STATUS
         =================================================== */

      if (Number(savedUser.active) !== 1) {
        throw new Error(
          `${account.email} is not active`
        );
      }
    }

    /* =====================================================
       SUCCESS MESSAGE
       ===================================================== */

    console.log("");
    console.log(
      "================================================="
    );
    console.log(
      "       TECHINS DEFAULT ACCOUNTS READY"
    );
    console.log(
      "================================================="
    );
    console.log(
      "ADMIN   : ceo@techins.com / ceo@2006"
    );
    console.log(
      "MANAGER : manager@techins.com / Manager@123"
    );
    console.log(
      "================================================="
    );
    console.log("");
  } catch (error) {
    console.error(
      "Automatic default account setup failed:",
      error
    );

    process.exit(1);
  }
}

/* =========================================================
   CREATE DEFAULT ACCOUNTS ON SERVER START
   ========================================================= */

ensureDefaultAccounts();

/* =========================================================
   ROOT HEALTH CHECK
   ========================================================= */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "TECHINS Work Portal API is running",
    timestamp: new Date().toISOString(),
    environment:
      process.env.NODE_ENV || "development",
  });
});

/* =========================================================
   API HEALTH CHECK
   ========================================================= */

app.get("/api", (req, res) => {
  res.status(200).json({
    success: true,
    message: "TECHINS Work Portal API",
  });
});

/* =========================================================
   AUTH ROUTES
   ========================================================= */

app.use(
  "/api/auth",
  authRoutes
);

/* =========================================================
   STUDENT ROUTES
   ========================================================= */

if (studentRoutes) {
  app.use(
    "/api/student",
    studentRoutes
  );
}

/* =========================================================
   STUDENTS ROUTES (LIST)
   ========================================================= */

if (studentsRoutes) {
  app.use(
    "/api/students",
    studentsRoutes
  );
}

/* =========================================================
   NOTIFICATION ROUTES
   ========================================================= */

if (notificationRoutes) {
  app.use(
    "/api/notifications",
    notificationRoutes
  );
}

/* =========================================================
   TASK ROUTES
   ========================================================= */

if (taskRoutes) {
  app.use(
    "/api/tasks",
    taskRoutes
  );
}

/* =========================================================
   MISSION ROUTES
   ========================================================= */

if (missionRoutes) {
  app.use(
    "/api/missions",
    missionRoutes
  );
}

/* =========================================================
   ACTIVITY ROUTES
   ========================================================= */

if (activityRoutes) {
  app.use(
    "/api/activities",
    activityRoutes
  );
}

/* =========================================================
   PERFORMANCE ROUTES
   ========================================================= */

if (performanceRoutes) {
  app.use(
    "/api/performance",
    performanceRoutes
  );
}

/* =========================================================
   ADMIN ROUTES
   ========================================================= */

if (adminRoutes) {
  app.use(
    "/api/admin",
    adminRoutes
  );
}

/* =========================================================
   AUDIT ROUTES
   ========================================================= */

if (auditRoutes) {
  app.use(
    "/api/audit-logs",
    auditRoutes
  );
}

/* =========================================================
   404 HANDLER
   ========================================================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
    path: req.originalUrl,
  });
});

/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "SERVER ERROR:",
      error
    );

    if (
      error.message ===
      "Not allowed by CORS"
    ) {
      return res.status(403).json({
        success: false,
        message: "CORS origin not allowed",
      });
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",

      error:
        process.env.NODE_ENV ===
        "production"
          ? undefined
          : error.message,
    });
  }
);

/* =========================================================
   START SERVER
   ========================================================= */

app.listen(PORT, () => {
  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    "       TECHINS WORK PORTAL SERVER"
  );
  console.log(
    "=============================================="
  );

  console.log(
    `TECHINS server running on port ${PORT}`
  );

  console.log(
    `Environment: ${
      process.env.NODE_ENV || "development"
    }`
  );

  console.log(
    "Production frontend: https://technis-work-portal-05.vercel.app"
  );

  console.log(
    "=============================================="
  );
});