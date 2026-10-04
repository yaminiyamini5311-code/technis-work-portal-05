const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error(
    "JWT_SECRET is missing. Add it to server/.env before starting the server."
  );
  process.exit(1);
}

const db = require("./database");
const authRoutes = require("./routes/authRoutes");
const taskRoutes = require("./routes/taskRoutes");
const missionRoutes = require("./routes/missionRoutes");
const activityRoutes = require("./routes/activityRoutes");
const performanceRoutes = require("./routes/performance");
const studentRoutes = require("./routes/studentRoutes");

const {
  authenticateToken,
  authorizeRoles,
} = require("./middleware/authMiddleware");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

/* =========================
   CORS CONFIGURATION
========================= */

const configuredOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(",").map(v => v.trim()).filter(Boolean) : []),
  ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
];
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without an origin
      // such as Postman/server-to-server requests
      if (!origin) {
        return callback(null, true);
      }

      if (configuredOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("Blocked CORS origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/* =========================
   MIDDLEWARE
========================= */

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.locals.db = db;

/* =========================
   ROOT / HEALTH
========================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "TECHINS Work Portal API is running",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    database: "sqlite",
    status: "ok",
  });
});

/* =========================
   NOTIFICATIONS
========================= */

app.get("/api/notifications", authenticateToken, (req, res) => {
  const rows = db
    .prepare(
      "SELECT id,type,title,message,related_task_id,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30"
    )
    .all(req.user.id);

  res.json({
    success: true,
    notifications: rows,
    unread: rows.filter((item) => !item.read_at).length,
  });
});

app.patch("/api/notifications/:id/read", authenticateToken, (req, res) => {
  const result = db
    .prepare(
      "UPDATE notifications SET read_at=? WHERE id=? AND user_id=?"
    )
    .run(
      new Date().toISOString(),
      Number(req.params.id),
      req.user.id
    );

  res.json({
    success: result.changes > 0,
  });
});

/* =========================
   ADMIN PROGRESS
========================= */

app.get(
  "/api/admin/progress",
  authenticateToken,
  authorizeRoles("admin"),
  (req, res) => {
    const period = ["week", "month", "year"].includes(
      String(req.query.period).toLowerCase()
    )
      ? String(req.query.period).toLowerCase()
      : "week";

    const db = req.app.locals.db;

    const days =
      period === "week" ? 7 : period === "month" ? 30 : 12;

    const labels = [];
    const values = [];

    if (period === "year") {
      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);

        const label = d.toISOString().slice(0, 7);

        labels.push(label);

        values.push(
          db
            .prepare(
              "SELECT COUNT(*) c FROM tasks WHERE LOWER(status)='completed' AND substr(COALESCE(completed_at,created_at),1,7)=?"
            )
            .get(label).c
        );
      }
    } else {
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);

        const label = d.toISOString().slice(0, 10);

        labels.push(label);

        values.push(
          db
            .prepare(
              "SELECT COUNT(*) c FROM tasks WHERE LOWER(status)='completed' AND substr(COALESCE(completed_at,created_at),1,10)=?"
            )
            .get(label).c
        );
      }
    }

    res.json({
      success: true,
      period,
      labels,
      values,
    });
  }
);

/* =========================
   AUDIT LOGS
========================= */
app.get("/api/audit-logs", authenticateToken, authorizeRoles("admin"), (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.name AS actor_name, u.email AS actor_email
    FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
    ORDER BY a.id DESC LIMIT 250`).all();
  res.json({ success: true, logs: rows });
});

/* =========================
   API ROUTES
========================= */

app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/missions", missionRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/performance", performanceRoutes);
app.use("/api/student", studentRoutes);

/* =========================
   STUDENTS
========================= */

app.get(
  "/api/students",
  authenticateToken,
  authorizeRoles("admin", "manager"),
  (req, res) => {
    const students = db
      .prepare(
        "SELECT id, name, email, department, created_at FROM users WHERE LOWER(role)='student' AND active=1 ORDER BY name"
      )
      .all();

    res.json({
      success: true,
      students,
      limit: 25,
      remaining: Math.max(25 - students.length, 0),
    });
  }
);

app.get(
  "/api/admin/students",
  authenticateToken,
  authorizeRoles("admin"),
  (req, res) => {
    const students = db
      .prepare(
        "SELECT id, name, email, department, created_at FROM users WHERE LOWER(role)='student' AND active=1 ORDER BY name"
      )
      .all();

    res.json({
      success: true,
      students,
      limit: 25,
      remaining: Math.max(25 - students.length, 0),
    });
  }
);

app.post(
  "/api/admin/students",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const bcrypt = require("bcryptjs");

      const {
        name,
        email,
        password,
        department,
      } = req.body || {};

      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          message: "Name, email and password are required",
        });
      }

      const count = db
        .prepare(
          "SELECT COUNT(*) AS count FROM users WHERE LOWER(role)='student' AND active=1"
        )
        .get().count;

      if (count >= 25) {
        return res.status(409).json({
          success: false,
          message: "Maximum of 25 students has been reached",
        });
      }

      const cleanEmail = String(email)
        .trim()
        .toLowerCase();

      if (
        db
          .prepare("SELECT id FROM users WHERE email=?")
          .get(cleanEmail)
      ) {
        return res.status(409).json({
          success: false,
          message: "A user with this email already exists",
        });
      }

      const hash = await bcrypt.hash(String(password), 10);

      const inserted = db
        .prepare(
          "INSERT INTO users (name,email,password,role,department) VALUES (?,?,?,?,?)"
        )
        .run(
          String(name).trim(),
          cleanEmail,
          hash,
          "student",
          String(department || "Techins").trim()
        );

      res.status(201).json({
        success: true,
        message: "Student created successfully",
        userId: inserted.lastInsertRowid,
      });
    } catch (error) {
      console.error("Create student error:", error);

      res.status(500).json({
        success: false,
        message: "Unable to create student",
      });
    }
  }
);

/* =========================
   MANAGER MANAGEMENT
========================= */
app.get("/api/admin/managers", authenticateToken, authorizeRoles("admin"), (req, res) => {
  const managers = db.prepare("SELECT id,name,email,department,active,created_at FROM users WHERE LOWER(role)='manager' ORDER BY name").all();
  res.json({ success: true, managers });
});

app.post("/api/admin/managers", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const bcrypt = require("bcryptjs");
    const { name, email, password, department = "Techins" } = req.body || {};
    if (!String(name || "").trim() || !String(email || "").trim() || !String(password || "")) return res.status(400).json({ success:false, message:"Name, email and password are required" });
    const cleanEmail=String(email).trim().toLowerCase();
    if(db.prepare("SELECT id FROM users WHERE email=?").get(cleanEmail)) return res.status(409).json({success:false,message:"A user with this email already exists"});
    const hash=await bcrypt.hash(String(password),10);
    const result=db.prepare("INSERT INTO users (name,email,password,role,department) VALUES (?,?,?,?,?)").run(String(name).trim(),cleanEmail,hash,"manager",String(department||"Techins").trim());
    res.status(201).json({success:true,message:"Manager created successfully",userId:Number(result.lastInsertRowid)});
  } catch(error) { console.error("Create manager error:",error); res.status(500).json({success:false,message:"Unable to create manager"}); }
});

app.patch("/api/admin/users/:id/disable", authenticateToken, authorizeRoles("admin"), (req,res)=>{
  const id=Number(req.params.id); if(!id)return res.status(400).json({success:false,message:"Invalid user id"});
  const target=db.prepare("SELECT id,name,role,active FROM users WHERE id=?").get(id); if(!target)return res.status(404).json({success:false,message:"User not found"});
  if(target.id===req.user.id)return res.status(400).json({success:false,message:"You cannot disable your own account"});
  const active=target.active?0:1; db.prepare("UPDATE users SET active=? WHERE id=?").run(active,id);
  db.prepare("INSERT INTO audit_logs (actor_id,action,entity_type,entity_id,previous_value,new_value,created_at) VALUES (?,?,?,?,?,?,?)").run(req.user.id,active?"user_enabled":"user_disabled","user",id,JSON.stringify({active:target.active}),JSON.stringify({active}),new Date().toISOString());
  res.json({success:true,active});
});

/* =========================
   FEEDBACK
========================= */

app.get(
  "/api/feedback",
  authenticateToken,
  authorizeRoles("student", "member"),
  (req, res) => {
    const rows = db
      .prepare(`
        SELECT id, period, score, strengths, improvements, feedback, created_at
        FROM performance
        WHERE user_id=?
        AND feedback IS NOT NULL
        AND TRIM(feedback)<>''
        ORDER BY id DESC
      `)
      .all(req.user.id);

    const taskRows = db
      .prepare(`
        SELECT id, 'task' AS type, title, feedback, created_at
        FROM tasks
        WHERE assigned_to=?
        AND feedback IS NOT NULL
        AND TRIM(feedback)<>''
        ORDER BY id DESC
      `)
      .all(req.user.id);

    res.json({
      success: true,
      feedback: [
        ...rows.map((r) => ({
          ...r,
          type: "performance",
        })),
        ...taskRows,
      ],
    });
  }
);

app.get(
  "/api/admin/feedback",
  authenticateToken,
  authorizeRoles("admin"),
  (req, res) => {
    const performance = db
      .prepare(`
        SELECT p.id, p.feedback, p.score, p.period, p.created_at,
        u.name AS student_name, u.email AS student_email
        FROM performance p
        JOIN users u ON u.id=p.user_id
        WHERE p.feedback IS NOT NULL
        AND TRIM(p.feedback)<>''
        ORDER BY p.id DESC
      `)
      .all();

    const tasks = db
      .prepare(`
        SELECT t.id, t.feedback, t.created_at,
        u.name AS student_name, u.email AS student_email, t.title
        FROM tasks t
        JOIN users u ON u.id=t.assigned_to
        WHERE t.feedback IS NOT NULL
        AND TRIM(t.feedback)<>''
        ORDER BY t.id DESC
      `)
      .all();

    res.json({
      success: true,
      feedback: [
        ...performance.map((item) => ({
          ...item,
          type: "performance",
        })),
        ...tasks.map((item) => ({
          ...item,
          type: "task",
        })),
      ],
    });
  }
);

app.post(
  "/api/admin/feedback",
  authenticateToken,
  authorizeRoles("admin"),
  (req, res) => {
    const {
      user_id,
      feedback,
      score,
      strengths = [],
      improvements = [],
      period = "general",
    } = req.body || {};

    const student = db
      .prepare(
        "SELECT id FROM users WHERE id=? AND LOWER(role)='student' AND active=1"
      )
      .get(Number(user_id));

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    if (!String(feedback || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "Feedback is required",
      });
    }

    let normalizedScore = null;

    if (score !== "" && score != null) {
      normalizedScore = Number(score);

      if (
        !Number.isInteger(normalizedScore) ||
        normalizedScore < 0 ||
        normalizedScore > 100
      ) {
        return res.status(400).json({
          success: false,
          message: "Score must be between 0 and 100",
        });
      }
    }

    const completedMissions = db
      .prepare(
        "SELECT COUNT(*) AS c FROM missions WHERE assigned_to=? AND (LOWER(status)='completed' OR progress>=100)"
      )
      .get(Number(user_id)).c;

    const result = db
      .prepare(`
        INSERT INTO performance
        (user_id,period,score,strengths,improvements,
        completed_missions,feedback,reviewed_by)
        VALUES (?,?,?,?,?,?,?,?)
      `)
      .run(
        Number(user_id),
        String(period || "general"),
        normalizedScore,
        JSON.stringify(
          Array.isArray(strengths) ? strengths : []
        ),
        JSON.stringify(
          Array.isArray(improvements) ? improvements : []
        ),
        completedMissions,
        String(feedback).trim(),
        req.user.id
      );

    res.status(201).json({
      success: true,
      message: "Feedback saved",
      id: result.lastInsertRowid,
    });
  }
);

/* =========================
   ADMIN STATS
========================= */

app.get(
  "/api/admin/stats",
  authenticateToken,
  authorizeRoles("admin"),
  (req, res) => {
    const students = db
      .prepare(
        "SELECT COUNT(*) c FROM users WHERE LOWER(role)='student' AND active=1"
      )
      .get().c;

    const tasks = db
      .prepare("SELECT COUNT(*) c FROM tasks")
      .get().c;

    const completedTasks = db
      .prepare(
        "SELECT COUNT(*) c FROM tasks WHERE LOWER(status)='completed'"
      )
      .get().c;

    const missions = db
      .prepare("SELECT COUNT(*) c FROM missions")
      .get().c;

    const activitiesToday = db
      .prepare(
        "SELECT COUNT(*) c FROM daily_activities WHERE date=?"
      )
      .get(
        new Date().toISOString().slice(0, 10)
      ).c;

    res.json({
      success: true,
      students,
      tasks,
      completedTasks,
      pendingTasks: tasks - completedTasks,
      missions,
      activitiesToday,
    });
  }
);

/* =========================
   404
========================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

/* =========================
   ERROR HANDLER
========================= */

app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TECHINS server running on port ${PORT}`);
});