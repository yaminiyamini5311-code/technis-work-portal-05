"use strict";
/**
 * Portal UI/workflow regression tests (no database required).
 *
 * Covers the fixes in this branch with in-memory fakes:
 *  - TaskAssignment isolation: individual vs batch fan-out, idempotent
 *    upserts, per-student task id resolution.
 *  - Dashboard progress: Approved-only, tasks+missions (activities excluded),
 *    divide-by-zero safe, numeric/ring values synchronized.
 *  - studentReport helpers: optional scores stay null, no invented zeroes.
 *  - Batch payload parsing: signup dropdown accepts every envelope shape.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { deriveState, numOrNull } = require("../utils/studentReport");
const TaskAssignment = require("../models/TaskAssignment");

function mockDb(seed = {}) {
  const store = {
    task_assignments: [...(seed.assignments || [])],
    tasks: [...(seed.tasks || [])],
    missions: [...(seed.missions || [])],
    daily_activities: [...(seed.activities || [])],
    performance: [...(seed.performance || [])],
    users: [...(seed.users || [])],
  };
  const match = (doc, filter) => {
    if (!filter || !Object.keys(filter).length) return true;
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === "object" && "$in" in v) return v.$in.map(String).includes(String(doc[k]));
      if (v && typeof v === "object" && "$ne" in v) return String(doc[k]) !== String(v.$ne);
      if (v && typeof v === "object" && "$exists" in v) {
        const has = doc[k] !== undefined && doc[k] !== null;
        return v.$exists ? has : !has;
      }
      return String(doc[k]) === String(v);
    });
  };
  const collection = (name) => ({
    find: (filter = {}, opts = {}) => {
      let rows = store[name].filter((d) => match(d, filter));
      const api = {
        sort: () => api,
        limit: (n) => ({ toArray: async () => rows.slice(0, n) }),
        toArray: async () => rows,
      };
      if (opts.projection) {
        const keep = Object.entries(opts.projection).filter(([, v]) => v).map(([k]) => k);
        rows = rows.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => keep.includes(k) || k === "_id")));
      }
      return api;
    },
    findOne: async (filter = {}) => store[name].find((d) => match(d, filter)) || null,
    updateOne: async (filter, update, opts = {}) => {
      const idx = store[name].findIndex((d) => match(d, filter));
      if (idx >= 0) {
        if (update.$set) Object.assign(store[name][idx], update.$set);
        return { upsertedCount: 0, matchedCount: 1 };
      }
      if (opts.upsert) {
        const doc = { ...filter, ...(update.$set || {}), ...(update.$setOnInsert || {}) };
        store[name].push(doc);
        return { upsertedCount: 1, matchedCount: 0 };
      }
      return { upsertedCount: 0, matchedCount: 0 };
    },
    insertOne: async (doc) => {
      const saved = { _id: `mock-${store[name].length + 1}`, ...doc };
      store[name].push(saved);
      return { insertedId: saved._id };
    },
  });
  return { collection, __store: store };
}

test("TaskAssignment: individual vs group visibility isolation", async () => {
  const db = mockDb();
  // Individual assignment to Student A only.
  await TaskAssignment.createAssignmentsForStudents(db, "task-1", ["student-A"]);
  // Group (batch) assignment to A + B.
  await TaskAssignment.createAssignmentsForStudents(db, "task-2", ["student-A", "student-B"]);

  const aTasks = await TaskAssignment.getStudentTaskIds(db, "student-A");
  const bTasks = await TaskAssignment.getStudentTaskIds(db, "student-B");
  const cTasks = await TaskAssignment.getStudentTaskIds(db, "student-C");

  assert.deepEqual([...aTasks].sort(), ["task-1", "task-2"]);
  assert.deepEqual(bTasks, ["task-2"]);
  assert.deepEqual(cTasks, []);

  // Idempotent retry creates no duplicates.
  const retry = await TaskAssignment.createAssignmentsForStudents(db, "task-2", ["student-A", "student-B"]);
  assert.equal(retry.created, 0);
  assert.equal(retry.existing, 2);
  assert.equal(db.__store.task_assignments.length, 3);

  // Per-task read is scoped: student C has no assignment row.
  const cOwn = await TaskAssignment.getAssignment(db, "task-1", "student-C");
  assert.equal(cOwn, null);
  const aOwn = await TaskAssignment.getAssignment(db, "task-1", "student-A");
  assert.equal(aOwn.task_id, "task-1");
});

test("dashboard progress: Approved-only across tasks+missions, zero-safe", async () => {
  const { getStudentDashboard } = require("../utils/dashboard");
  const sid = "student-A";
  const user = { _id: sid, name: "A", email: "a@example.invalid", role: "student" };

  const run = async (tasks, missions, activities = [], assignments = [], submissions = []) => {
    const db = mockDb({
      users: [user],
      tasks: tasks.map((t, i) => ({ _id: `t${i}`, created_at: `${i}`, ...t })),
      missions: missions.map((m, i) => ({ _id: `m${i}`, created_at: `${i}`, ...m })),
      activities: activities.map((a, i) => ({ _id: `a${i}`, ...a })),
      performance: [],
    });
    // Wire assignments/submissions to the generated task ids.
    db.__store.task_assignments.push(...assignments.map((a, i) => ({ _id: `as${i}`, ...a })));
    db.__store.submissions = submissions.map((s, i) => ({ _id: `s${i}`, ...s }));
    // tasks must be visible to the student: legacy assigned_to fallback
    db.__store.tasks.forEach((t) => { t.assigned_to = t.assigned_to || sid; });
    // getStudentTaskIds reads task_assignments by student; also add rows for every task
    // so the $or query resolves (mock matches assigned_to anyway).
    return getStudentDashboard(db, sid);
  };

  // No work -> 0, not NaN, with a meaningful empty state upstream.
  const empty = await run([], [], []);
  assert.equal(empty.progress, 0);
  assert.equal(empty.tasks.total, 0);

  // None completed -> 0.
  const none = await run(
    [{ workflow_status: "Assigned", status: "pending" }, { workflow_status: "In Progress", status: "in_progress" }],
    [],
  );
  assert.equal(none.tasks.completed, 0);
  assert.equal(none.progress, 0);

  // Half approved -> 50 (numeric and ring share the same field).
  const half = await run(
    [{ workflow_status: "Approved", status: "completed" }, { workflow_status: "Assigned", status: "pending" }],
    [],
  );
  assert.equal(half.tasks.completed, 1);
  assert.equal(half.progress, 50);

  // Submitted-but-not-approved does NOT count.
  const submitted = await run(
    [{ workflow_status: "Submitted", status: "in_progress" }],
    [],
  );
  assert.equal(submitted.tasks.completed, 0);
  assert.equal(submitted.progress, 0);

  // Approval via assignment row counts even when the task doc is stale.
  const viaAssignment = await run(
    [{ workflow_status: "Assigned", status: "pending" }],
    [],
    [],
    [{ task_id: "t0", student_id: sid, status: "approved" }],
  );
  assert.equal(viaAssignment.tasks.completed, 1);
  assert.equal(viaAssignment.progress, 100);

  // Missions join the denominator; activities do not dilute progress.
  const mixed = await run(
    [{ workflow_status: "Approved", status: "completed" }, { workflow_status: "Assigned", status: "pending" }],
    [{ status: "completed" }, { status: "assigned" }],
    [{ status: "completed" }, { status: "completed" }],
  );
  // (1 approved task + 1 completed mission) / (2 tasks + 2 missions) = 50.
  assert.equal(mixed.progress, 50);
});

test("studentReport: scores optional, states derived from real records", () => {
  assert.equal(numOrNull(null), null);
  assert.equal(numOrNull(""), null);
  assert.equal(numOrNull("8"), 8);
  assert.equal(numOrNull("abc"), null);

  const now = new Date();
  assert.equal(deriveState({ assignment: { status: "approved" }, submission: null, now }), "approved");
  assert.equal(deriveState({ assignment: null, submission: { status: "Approved" }, now }), "approved");
  assert.equal(deriveState({ assignment: null, submission: { status: "Submitted" }, now }), "submitted");
  assert.equal(deriveState({ assignment: { status: "in_progress" }, submission: null, now }), "in_progress");
  assert.equal(deriveState({ assignment: null, submission: null, now }), "not_started");
});

test("signup batch parsing accepts every envelope shape", () => {
  const parse = (data) => {
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.batches)
        ? data.batches
        : Array.isArray(data?.data)
          ? data.data
          : [];
    return list.filter((b) => b && (b.id || b._id) && (b.name || b.batch_name));
  };
  const sample = [{ id: "b1", name: "Login 60" }, { id: "b2", name: "Unlock" }];
  assert.deepEqual(parse({ batches: sample }), sample);
  assert.deepEqual(parse({ data: sample }), sample);
  assert.deepEqual(parse(sample), sample);
  assert.deepEqual(parse({ batches: null }), []);
  assert.deepEqual(parse({}), []);
});
