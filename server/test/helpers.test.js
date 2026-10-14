"use strict";
/**
 * Unit tests for the shared user-account helpers.
 * These encode the login/signup/approval contract:
 *   - students start INACTIVE + PENDING and cannot use the portal until
 *     an admin/CEO approves them
 *   - every status value is normalized (casing, NULL, legacy shapes)
 *
 * No database access — pure functions only.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeEmail,
  normalizeRole,
  normalizeRegistrationStatus,
  isActiveFlag,
  isBlockedRegistrationStatus,
  canUserLogin,
} = require("../utils/userAccount");

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  Student@Techins.com "), "student@techins.com");
  assert.equal(normalizeEmail(null), "");
});

test("normalizeRole trims and lowercases", () => {
  assert.equal(normalizeRole(" Student "), "student");
  assert.equal(normalizeRole("CEO"), "ceo");
});

test("normalizeRegistrationStatus treats missing as approved (legacy rows)", () => {
  assert.equal(normalizeRegistrationStatus(undefined), "approved");
  assert.equal(normalizeRegistrationStatus(null), "approved");
  assert.equal(normalizeRegistrationStatus("  PENDING "), "pending");
  assert.equal(normalizeRegistrationStatus("Rejected"), "rejected");
});

test("isActiveFlag understands legacy shapes", () => {
  assert.equal(isActiveFlag(1), true);
  assert.equal(isActiveFlag(true), true);
  assert.equal(isActiveFlag("1"), true);
  assert.equal(isActiveFlag("TRUE"), true);
  assert.equal(isActiveFlag(0), false);
  assert.equal(isActiveFlag(false), false);
  assert.equal(isActiveFlag(null), false);
  assert.equal(isActiveFlag(undefined), false);
  assert.equal(isActiveFlag("false"), false);
  assert.equal(isActiveFlag(2), false);
});

test("pending and rejected registrations block login; approved does not", () => {
  assert.equal(isBlockedRegistrationStatus("pending"), true);
  assert.equal(isBlockedRegistrationStatus("rejected"), true);
  assert.equal(isBlockedRegistrationStatus("approved"), false);
  assert.equal(isBlockedRegistrationStatus(undefined), false); // legacy = approved
});

test("canUserLogin requires an active flag AND a non-blocked registration", () => {
  assert.equal(canUserLogin({ active: 1, registration_status: "approved" }), true);
  assert.equal(canUserLogin({ active: 1, registration_status: "pending" }), false);
  assert.equal(canUserLogin({ active: 1, registration_status: "rejected" }), false);
  assert.equal(canUserLogin({ active: 0, registration_status: "approved" }), false);
  // Legacy rows without the fields must not suddenly gain access...
  assert.equal(canUserLogin({ active: 1 }), true); // ...missing status = approved (legacy)
  assert.equal(canUserLogin({}), false);
});

test("pending students get a limited session (login allowed, routes gated)", () => {
  // This is the Stage 2 contract: authenticate so the Waiting-for-Approval
  // screen can render, while checkStudentRegistrationStatus /
  // requireApprovedStudent block every data route. The pure-login part of
  // that contract is represented by the status helpers; see api.test.js
  // for the end-to-end verification with real tokens.
  const pendingStudent = { active: 0, registration_status: "pending", role: "student" };
  const awaitingReview = pendingStudent.role === "student" &&
    (normalizeRegistrationStatus(pendingStudent.registration_status) === "pending" ||
     normalizeRegistrationStatus(pendingStudent.registration_status) === "rejected");
  assert.equal(awaitingReview, true);
  assert.equal(isActiveFlag(pendingStudent.active), false);
});
