const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { sendTaskAssignmentEmail } = require("../utils/email");
const { writeAudit } = require("../utils/audit");
const { ALLOWED_DOMAINS, ALLOWED_PROGRAMS } = require("../config");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip", ".png", ".jpg", ".jpeg"]);
    cb(allowed.has(ext) ? null : new Error("Unsupported file type"), allowed.has(ext));
  }
});
const STATUS = ["Draft","Scheduled","Assigned","Acknowledged","In Progress","Submitted","Under Review","Revision Required","Resubmitted","Approved","Overdue","Cancelled","Archived"];
const priorityValues = new Set(["low","medium","high","critical"]);

function nextTaskCode(db) {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT task_code FROM tasks WHERE task_code LIKE ? ORDER BY id DESC LIMIT 1").get(`TNS-${year}-%`);
  const last = row?.task_code ? Number(row.task_code.split("-").pop()) || 0 : 0;
  return `TNS-${year}-${String(last + 1).padStart(4,"0")}`;
}
function nextSubmissionCode(db) {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT submission_code FROM submissions WHERE submission_code LIKE ? ORDER BY id DESC LIMIT 1").get(`SUB-${year}-%`);
  const last = row?.submission_code ? Number(row.submission_code.split("-").pop()) || 0 : 0;
  return `SUB-${year}-${String(last + 1).padStart(5,"0")}`;
}
function legacyStatus(workflow) {
  if (["Approved","Archived"].includes(workflow)) return "completed";
  if (["In Progress","Acknowledged","Submitted","Under Review","Revision Required","Resubmitted"].includes(workflow)) return "in_progress";
  return "pending";
}
function taskQuery(db, where = "", params = []) {
  return db.prepare(`
    SELECT t.*, assigned.name AS student_name, assigned.email AS student_email,
           creator.name AS assigned_by_name,
           (SELECT COUNT(*) FROM task_files tf WHERE tf.task_id=t.id) AS file_count,
           (SELECT COUNT(*) FROM submissions s WHERE s.task_id=t.id) AS submission_count,
           (SELECT MAX(version) FROM submissions s WHERE s.task_id=t.id) AS latest_version
    FROM tasks t JOIN users assigned ON assigned.id=t.assigned_to
    LEFT JOIN users creator ON creator.id=t.assigned_by
    ${where}
    ORDER BY CASE t.workflow_status WHEN 'Overdue' THEN 1 WHEN 'Revision Required' THEN 2 WHEN 'Under Review' THEN 3 WHEN 'In Progress' THEN 4 WHEN 'Approved' THEN 6 ELSE 5 END,
             CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC, t.id DESC
  `).all(...params);
}
function notify(db, userId, type, title, message, taskId = null) {
  db.prepare("INSERT INTO notifications (user_id,type,title,message,related_task_id) VALUES (?,?,?,?,?)").run(userId,type,title,message,taskId);
}
function transition(db, task, toStatus, actorId, comment = null) {
  const from = task.workflow_status || "Assigned";
  if (from === toStatus) return;
  db.prepare("UPDATE tasks SET workflow_status=?, status=?, completed_at=?, updated_at=? WHERE id=?").run(toStatus, legacyStatus(toStatus), toStatus === "Approved" ? new Date().toISOString() : null, new Date().toISOString(), task.id);
  db.prepare("INSERT INTO task_status_history (task_id,from_status,to_status,changed_by,comment,created_at) VALUES (?,?,?,?,?,?)").run(task.id,from,toStatus,actorId,comment,new Date().toISOString());
  writeAudit(db,{actorId,action:"task_status_changed",entityType:"task",entityId:task.id,previousValue:{status:from},newValue:{status:toStatus},metadata:{comment}});
}

router.get("/my", authenticateToken, authorizeRoles("student","member"), (req,res)=>res.json({success:true,tasks:taskQuery(req.app.locals.db,"WHERE t.assigned_to=?",[req.user.id])}));
router.get("/students", authenticateToken, authorizeRoles("admin","manager"), (req,res)=>res.json({success:true,students:req.app.locals.db.prepare("SELECT id,name,email,department,created_at FROM users WHERE LOWER(role)='student' AND active=1 ORDER BY name").all()}));
router.get("/submissions", authenticateToken, authorizeRoles("admin","manager"), (req,res)=>{const db=req.app.locals.db;const rows=db.prepare(`SELECT t.id,t.task_code,t.title,t.status,t.workflow_status,t.outcome,t.outcome_submitted_at,t.assigned_to,u.name student_name,u.email student_email,(SELECT COUNT(*) FROM submission_files sf JOIN submissions s ON s.id=sf.submission_id WHERE s.task_id=t.id) file_count,(SELECT COUNT(*) FROM submissions s WHERE s.task_id=t.id) submission_count FROM tasks t JOIN users u ON u.id=t.assigned_to WHERE EXISTS(SELECT 1 FROM submissions s WHERE s.task_id=t.id) OR t.outcome IS NOT NULL OR EXISTS(SELECT 1 FROM task_files tf WHERE tf.task_id=t.id) ORDER BY COALESCE(t.outcome_submitted_at,t.created_at) DESC LIMIT 100`).all();res.json({success:true,submissions:rows});});
router.get("/", authenticateToken, (req,res)=>{
  const db=req.app.locals.db;
  if(["student","member"].includes(req.user.role)) return res.json({success:true,tasks:taskQuery(db,"WHERE t.assigned_to=?",[req.user.id])});
  if(!["admin","manager"].includes(req.user.role)) return res.status(403).json({success:false,message:"Access denied"});
  res.json({success:true,tasks:taskQuery(db)});
});

router.post("/", authenticateToken, authorizeRoles("admin","ceo","manager"), async (req,res)=>{
  try {
    const b=req.body||{}; const title=String(b.title||"").trim();
    if(!title) return res.status(400).json({success:false,message:"Task title is required"});

    const assignedTo = b.assigned_to ? Number(b.assigned_to) : null;
    const program = b.program ? String(b.program).trim().toLowerCase() : null;
    const domain = b.domain ? String(b.domain).trim().toLowerCase() : null;

    // Validate domain
    if (!domain || !ALLOWED_DOMAINS.includes(domain)) {
      return res.status(400).json({success:false,message:"Invalid domain. Choose from: " + ALLOWED_DOMAINS.join(", ")});
    }

    // Validate that exactly one target is provided
    if (!assignedTo && !program) {
      return res.status(400).json({success:false,message:"Select a student or a program"});
    }
    if (assignedTo && program) {
      return res.status(400).json({success:false,message:"Cannot select both student and program. Choose one."});
    }

    if (program && !ALLOWED_PROGRAMS.includes(program)) {
      return res.status(400).json({success:false,message:"Invalid program. Choose from: " + ALLOWED_PROGRAMS.join(", ")});
    }

    const db=req.app.locals.db;
    let studentsToNotify = [];

    if (assignedTo) {
      const student=db.prepare("SELECT id,name,email FROM users WHERE id=? AND LOWER(role)='student' AND active=1").get(assignedTo);
      if(!student) return res.status(404).json({success:false,message:"Student not found"});
      studentsToNotify.push(student);
    } else if (program) {
      // Find all students in this program
      studentsToNotify = db.prepare("SELECT id,name,email FROM users WHERE LOWER(program)=? AND LOWER(role)='student' AND active=1").all(program);
      if(studentsToNotify.length === 0) return res.status(404).json({success:false,message:"No active students found in this program"});
    }

    const priority=String(b.priority||"medium").toLowerCase(); if(!priorityValues.has(priority)) return res.status(400).json({success:false,message:"Invalid priority"});
    const taskCode=nextTaskCode(db); const workflow=String(b.workflow_status||"Assigned");
    if(!STATUS.includes(workflow)) return res.status(400).json({success:false,message:"Invalid task workflow status"});

    // Validate start/end dates
    if (b.start_date && b.due_date && b.start_date > b.due_date) {
      return res.status(400).json({success:false,message:"Starting Date cannot be after Ending Date"});
    }

    const how_to_do = b.how_to_do ? String(b.how_to_do).trim().substring(0, 5000) : null;

    // Create tasks for each target student
    const taskIds = [];
    for (const student of studentsToNotify) {
      const result=db.prepare(`INSERT INTO tasks (task_code,title,category,program,department,domain,team,task_type,description,what,why,how,how_to_do,expected_output,submission_requirements,resources,notes,assigned_to,assigned_by,status,workflow_status,priority,start_date,due_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskCode,title,String(b.category||"").trim()||null,program,null,domain,String(b.team||"").trim()||null,String(b.task_type||"General"),String(b.description||"").trim(),String(b.what||"").trim(),String(b.why||"").trim(),String(b.how||"").trim(),how_to_do,String(b.expected_output||"").trim(),String(b.submission_requirements||"").trim(),String(b.resources||"").trim(),String(b.notes||"").trim(),student.id,req.user.id,legacyStatus(workflow),workflow,priority,b.start_date||null,b.due_date||null,new Date().toISOString(),new Date().toISOString()
      );
      const id=Number(result.lastInsertRowid);
      taskIds.push(id);
      notify(db,student.id,"task_assigned","New task assigned",`${title} (${taskCode}) has been assigned to you.`,id);
      writeAudit(db,{actorId:req.user.id,action:"task_created",entityType:"task",entityId:id,newValue:{task_code:taskCode,title,assigned_to:student.id,workflow_status:workflow}});
      try { await sendTaskAssignmentEmail({to:student.email,studentName:student.name,taskTitle:title,description:String(b.description||""),dueDate:b.due_date,appUrl:process.env.APP_URL}); } catch(e) { console.error("Task email notification failed:",e.message); }
    }

    res.status(201).json({success:true,message:"Task assigned successfully",taskId:taskIds[0],taskCode});
  } catch(e){ console.error("Create task error:",e); res.status(500).json({success:false,message:"Unable to create task"}); }
});

router.get("/:id", authenticateToken, (req,res)=>{
  const db=req.app.locals.db; const task=db.prepare("SELECT * FROM tasks WHERE id=?").get(Number(req.params.id));
  if(!task) return res.status(404).json({success:false,message:"Task not found"});
  const allowed=req.user.role==="admin" || req.user.role==="manager" || (task.assigned_to===req.user.id);
  if(!allowed) return res.status(403).json({success:false,message:"Access denied"});
  const history=db.prepare("SELECT h.*,u.name AS changed_by_name FROM task_status_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.task_id=? ORDER BY h.id ASC").all(task.id);
  const submissions=db.prepare("SELECT s.*,u.name AS reviewer_name FROM submissions s LEFT JOIN users u ON u.id=s.reviewer_id WHERE s.task_id=? ORDER BY s.version DESC").all(task.id);
  res.json({success:true,task,history,submissions});
});

router.patch("/:id/status", authenticateToken, (req,res)=>{
  const db=req.app.locals.db; const task=db.prepare("SELECT * FROM tasks WHERE id=?").get(Number(req.params.id)); if(!task)return res.status(404).json({success:false,message:"Task not found"});
  const requested=String(req.body?.workflow_status||req.body?.status||"").trim();
  const map={pending:"Assigned",in_progress:"In Progress",completed:"Approved"}; const toStatus=map[requested.toLowerCase()]||requested;
  if(!STATUS.includes(toStatus))return res.status(400).json({success:false,message:"Invalid task status"});
  const studentOwner=task.assigned_to===req.user.id&&["student","member"].includes(req.user.role); const managerOwner=task.assigned_by===req.user.id&&req.user.role==="manager"; const admin=req.user.role==="admin";
  if(!studentOwner&&!managerOwner&&!admin)return res.status(403).json({success:false,message:"Access denied"});
  if(studentOwner && !["Acknowledged","In Progress"].includes(toStatus))return res.status(403).json({success:false,message:"Students cannot directly approve or review tasks"});
  if((admin||managerOwner) && toStatus==="Approved" && !["Under Review","Resubmitted","Submitted","Revision Required"].includes(task.workflow_status))return res.status(409).json({success:false,message:"Task must have a submission before approval"});
  transition(db,task,toStatus,req.user.id,req.body?.comment||null);
  if(toStatus==="In Progress") notify(db,task.assigned_by,"task_started","Task started",`${task.title} was marked in progress.`,task.id);
  if(toStatus==="Approved") notify(db,task.assigned_to,"task_approved","Task approved",`${task.title} has been approved.`,task.id);
  res.json({success:true,message:"Task status updated",workflow_status:toStatus});
});

router.post("/:id/submit", authenticateToken, authorizeRoles("student","member"), upload.array("files",5), (req,res)=>{
  const db=req.app.locals.db; const task=db.prepare("SELECT * FROM tasks WHERE id=? AND assigned_to=?").get(Number(req.params.id),req.user.id); if(!task)return res.status(404).json({success:false,message:"Task not found"});
  if(["Approved","Cancelled","Archived"].includes(task.workflow_status))return res.status(409).json({success:false,message:"This task cannot accept a submission"});
  const latest=db.prepare("SELECT MAX(version) AS version FROM submissions WHERE task_id=?").get(task.id); const version=Number(latest?.version||0)+1; const submissionCode=nextSubmissionCode(db); const submittedAt=new Date().toISOString();
  const folder=path.join(__dirname,"..","uploads",`student_${req.user.id}`,`task_${task.id}`,`submission_v${version}`); fs.mkdirSync(folder,{recursive:true});
  try {
    const created=db.transaction(()=>{
      const s=db.prepare("INSERT INTO submissions (submission_code,task_id,student_id,version,comment,status,submitted_at,created_at) VALUES (?,?,?,?,?,?,?,?)").run(submissionCode,task.id,req.user.id,version,String(req.body?.comment||"").trim()||null,"Submitted",submittedAt,submittedAt);
      const sid=Number(s.lastInsertRowid); const insertFile=db.prepare("INSERT INTO submission_files (submission_id,original_name,stored_name,mime_type,size,storage_path) VALUES (?,?,?,?,?,?)");
      for(const file of req.files||[]){const safe=`${Date.now()}_${Math.random().toString(36).slice(2,8)}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g,"_")}`;const full=path.join(folder,safe);fs.writeFileSync(full,file.buffer);insertFile.run(sid,file.originalname,safe,file.mimetype,file.size,full);}
      const files=req.files||[];
      for(const file of files){const safeRows=db.prepare("SELECT id FROM submission_files WHERE submission_id=? ORDER BY id DESC LIMIT ?").all(sid,files.length);}
      transition(db,task,version>1?"Resubmitted":"Submitted",req.user.id,"Submission received");
      notify(db,task.assigned_by,"submission_received","Submission received",`${submissionCode} was submitted for ${task.title}.`,task.id);
      writeAudit(db,{actorId:req.user.id,action:"submission_uploaded",entityType:"submission",entityId:sid,newValue:{submission_code:submissionCode,task_id:task.id,version,submitted_at:submittedAt}});
      return sid;
    });
    res.status(201).json({success:true,message:"Submission stored successfully",submissionId:created,submissionCode,version,submittedAt});
  } catch(e){console.error("Submission error:",e);res.status(500).json({success:false,message:"Unable to store submission"});}
});

router.post("/:id/upload", authenticateToken, authorizeRoles("student","member"), upload.array("files",5), (req,res)=>{
  // Backward-compatible upload endpoint: store files and keep the legacy task_files view working.
  const db=req.app.locals.db; const task=db.prepare("SELECT id,assigned_to FROM tasks WHERE id=? AND assigned_to=?").get(Number(req.params.id),req.user.id); if(!task)return res.status(404).json({success:false,message:"Task not found"});
  if(!req.files?.length)return res.status(400).json({success:false,message:"Select at least one file"});
  const folder=path.join(__dirname,"..","uploads",`student_${req.user.id}`,`task_${task.id}`);fs.mkdirSync(folder,{recursive:true}); const insert=db.prepare("INSERT INTO task_files (task_id,user_id,original_name,stored_name,mime_type,size,storage_path) VALUES (?,?,?,?,?,?,?)"); const files=[];
  try{db.transaction(()=>{for(const file of req.files){const safe=`${Date.now()}_${Math.random().toString(36).slice(2,8)}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g,"_")}`;const full=path.join(folder,safe);fs.writeFileSync(full,file.buffer);const r=insert.run(task.id,req.user.id,file.originalname,safe,file.mimetype,file.size,full);files.push({id:Number(r.lastInsertRowid),original_name:file.originalname,size:file.size});}});res.status(201).json({success:true,message:`${files.length} file(s) uploaded successfully`,files});}catch(e){console.error("Upload save error:",e);res.status(500).json({success:false,message:"Unable to save uploaded files"});}
});

router.get("/:id/submissions", authenticateToken, (req,res)=>{
  const db=req.app.locals.db; const task=db.prepare("SELECT * FROM tasks WHERE id=?").get(Number(req.params.id)); if(!task)return res.status(404).json({success:false,message:"Task not found"});
  if(req.user.role!=="admin"&&req.user.role!=="manager"&&task.assigned_to!==req.user.id)return res.status(403).json({success:false,message:"Access denied"});
  const rows=db.prepare("SELECT s.*,u.name AS reviewer_name,(SELECT COUNT(*) FROM submission_files sf WHERE sf.submission_id=s.id) file_count FROM submissions s LEFT JOIN users u ON u.id=s.reviewer_id WHERE s.task_id=? ORDER BY s.version DESC").all(task.id); res.json({success:true,submissions:rows});
});
router.get("/:id/files", authenticateToken, (req,res)=>{
  const db=req.app.locals.db; const task=db.prepare("SELECT id,assigned_to FROM tasks WHERE id=?").get(Number(req.params.id)); if(!task)return res.status(404).json({success:false,message:"Task not found"}); const effectiveRole=req.user.role==="ceo"?"admin":req.user.role; if(!["admin","manager"].includes(effectiveRole)&&task.assigned_to!==req.user.id)return res.status(403).json({success:false,message:"Access denied"});
  res.json({success:true,files:db.prepare("SELECT id,original_name,mime_type,size,created_at FROM task_files WHERE task_id=? ORDER BY id DESC").all(task.id)});
});
router.get("/:id/files/:fileId/download", authenticateToken, (req,res)=>{
  const db=req.app.locals.db; const file=db.prepare("SELECT tf.*,t.assigned_to FROM task_files tf JOIN tasks t ON t.id=tf.task_id WHERE tf.id=? AND tf.task_id=?").get(Number(req.params.fileId),Number(req.params.id)); if(!file)return res.status(404).json({success:false,message:"File not found"}); const effectiveRole=req.user.role==="ceo"?"admin":req.user.role; if(!["admin","manager"].includes(effectiveRole)&&file.assigned_to!==req.user.id)return res.status(403).json({success:false,message:"Access denied"}); if(!fs.existsSync(file.storage_path))return res.status(404).json({success:false,message:"Stored file is unavailable"}); res.download(file.storage_path,file.original_name);
});

router.post("/review", authenticateToken, authorizeRoles("admin","ceo","manager"), (req,res)=>{
  const db=req.app.locals.db; const submission=db.prepare("SELECT s.*,t.*,s.student_id FROM submissions s JOIN tasks t ON t.id=s.task_id WHERE s.id=?").get(Number(req.body?.submission_id)); if(!submission)return res.status(404).json({success:false,message:"Submission not found"});
  const effectiveRole=req.user.role==="ceo"?"admin":req.user.role;
  if(effectiveRole==="manager"&&submission.assigned_by!==req.user.id)return res.status(403).json({success:false,message:"You can only review tasks assigned by you"});
  const decision=String(req.body?.decision||"").toLowerCase(); const comment=String(req.body?.comment||"").trim(); if(!["approve","revision"].includes(decision)||!comment)return res.status(400).json({success:false,message:"Decision and review comment are required"});
  const next=decision==="approve"?"Approved":"Revision Required"; const now=new Date().toISOString(); db.transaction(()=>{db.prepare("UPDATE submissions SET status=?,reviewer_id=?,reviewed_at=?,review_comments=? WHERE id=?").run(next,req.user.id,now,comment,submission.id);transition(db,submission,next,req.user.id,comment);notify(db,submission.student_id,decision==="approve"?"task_approved":"revision_required",decision==="approve"?"Task approved":"Revision required",`${submission.title}: ${comment}`,submission.task_id);writeAudit(db,{actorId:req.user.id,action:decision==="approve"?"submission_approved":"revision_requested",entityType:"submission",entityId:submission.id,previousValue:{status:submission.status},newValue:{status:next,review_comments:comment}});});
  res.json({success:true,message:decision==="approve"?"Submission approved":"Revision requested",status:next});
});
router.patch("/:id/feedback", authenticateToken, authorizeRoles("admin","ceo","manager"), (req,res)=>{const db=req.app.locals.db;const task=db.prepare("SELECT * FROM tasks WHERE id=?").get(Number(req.params.id));if(!task)return res.status(404).json({success:false,message:"Task not found"});const effectiveRole=req.user.role==="ceo"?"admin":req.user.role;if(effectiveRole==="manager"&&task.assigned_by!==req.user.id)return res.status(403).json({success:false,message:"Access denied"});const feedback=String(req.body?.feedback||"").trim()||null;db.prepare("UPDATE tasks SET feedback=?,updated_at=? WHERE id=?").run(feedback,new Date().toISOString(),task.id);notify(db,task.assigned_to,"feedback","New task feedback",feedback||"New feedback was added.",task.id);writeAudit(db,{actorId:req.user.id,action:"feedback_added",entityType:"task",entityId:task.id,newValue:{feedback}});res.json({success:true,message:"Task feedback updated"});});
router.patch("/:id/outcome", authenticateToken, authorizeRoles("student","member"), (req,res)=>{const db=req.app.locals.db;const task=db.prepare("SELECT * FROM tasks WHERE id=? AND assigned_to=?").get(Number(req.params.id),req.user.id);if(!task)return res.status(404).json({success:false,message:"Task not found"});const outcome=String(req.body?.outcome||"").trim();if(!outcome)return res.status(400).json({success:false,message:"Task outcome is required"});const now=new Date().toISOString();db.prepare("UPDATE tasks SET outcome=?,outcome_submitted_at=?,updated_at=? WHERE id=?").run(outcome,now,now,task.id);if(!["Submitted","Under Review","Revision Required","Resubmitted"].includes(task.workflow_status))transition(db,task,"Submitted",req.user.id,"Outcome submitted");db.prepare("SELECT id FROM users WHERE LOWER(role) IN ('admin','ceo','manager') AND active=1").all().forEach(u=>notify(db,u.id,"task_outcome","New task outcome submitted",`${task.title} received an outcome from a student.`,task.id));writeAudit(db,{actorId:req.user.id,action:"task_outcome_submitted",entityType:"task",entityId:task.id,newValue:{outcome,submitted_at:now}});res.json({success:true,message:"Task outcome saved"});});

module.exports = router;
