async function sendTaskAssignmentEmail({ to, studentName, taskTitle, description, dueDate, appUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn("Email notification skipped: RESEND_API_KEY or EMAIL_FROM is not configured.");
    return { sent: false, skipped: true };
  }

  const safeUrl = String(appUrl || process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#f4f7fb;padding:32px;color:#101828">
      <div style="max-width:620px;margin:auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e6ebf2">
        <div style="background:linear-gradient(135deg,#05070b,#071a3d,#0b2457);padding:28px;color:white">
          <div style="font-size:12px;letter-spacing:3px;color:#f4c95d;font-weight:800">TECHINS WORK PORTAL</div>
          <h1 style="margin:10px 0 0;font-size:26px">New task assigned</h1>
        </div>
        <div style="padding:28px">
          <p>Hello ${escapeHtml(studentName || "Student")},</p>
          <p>A new task has been assigned to you in the TECHINS Work Portal.</p>
          <div style="background:#f8fafc;border:1px solid #e7ebf2;border-radius:14px;padding:18px;margin:20px 0">
            <h2 style="margin:0 0 8px;color:#071a3d;font-size:20px">${escapeHtml(taskTitle)}</h2>
            <p style="margin:0 0 10px;color:#475467">${escapeHtml(description || "No description provided.")}</p>
            <strong style="color:#9b7918">Due: ${escapeHtml(dueDate || "No deadline")}</strong>
          </div>
          <a href="${safeUrl}/student/tasks" style="display:inline-block;background:#071a3d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Open my tasks</a>
          <p style="color:#98a2b3;font-size:12px;margin-top:24px">Where Learning Becomes Ideas</p>
        </div>
      </div>
    </div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: `New TECHINS task: ${taskTitle}`, html })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Email provider returned ${response.status}: ${body.slice(0, 300)}`);
  }
  return { sent: true, ...(await response.json()) };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

module.exports = { sendTaskAssignmentEmail };
