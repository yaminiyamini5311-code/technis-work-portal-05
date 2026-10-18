/**
 * The TECHINS display code for a learner.
 *
 * Historical bug: several read paths projected and read `users.student_id`,
 * which no user document actually carries, so every student identifier
 * rendered as an em dash ("ID: —"). The value lives in `users.learner_id`
 * (for example "T60-001"). `student_id` is still honoured first so any
 * document that genuinely carries it keeps working.
 *
 * Never fabricates a value: an unknown student returns null and the UI shows
 * an em dash rather than inventing an identifier.
 */
function studentCode(user) {
  if (!user) return null;
  const value = user.student_id || user.learner_id || null;
  return value === undefined || value === null || value === "" ? null : String(value);
}

/**
 * The widest user projection any read path needs for a student profile.
 * `learner_id` MUST stay in this list — dropping it is what caused the
 * missing identifiers in the first place.
 */
const STUDENT_PROFILE_PROJECTION = Object.freeze({
  name: 1,
  email: 1,
  phone: 1,
  student_id: 1,
  learner_id: 1,
  department: 1,
  program: 1,
  batch_id: 1,
  created_at: 1,
});

module.exports = { studentCode, STUDENT_PROFILE_PROJECTION };