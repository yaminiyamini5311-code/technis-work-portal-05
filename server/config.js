/**
 * TECHINS WORK PORTAL - Configuration Constants
 */

// Maximum number of active student accounts allowed
const MAX_STUDENT_ACCOUNTS = 25;

// Allowed department values
const ALLOWED_DEPARTMENTS = [
  'edutins',
  'resins',
  'innovins',
  'systins',
  'program'
];

// Allowed domain values (for task assignment)
const ALLOWED_DOMAINS = [
  'edutins',
  'resins',
  'innovins',
  'systins',
  'program'
];

// Domain display names
const DOMAIN_DISPLAY_NAMES = {
  'edutins': 'EduTins',
  'resins': 'ResIns',
  'innovins': 'InnoVins',
  'systins': 'SysTins',
  'program': 'Program'
};

// Allowed program values
const ALLOWED_PROGRAMS = [
  'techins 60',
  'ai ally',
  'life wise',
  'foundation x',
  'concept to carrier',
  'unlock'
];

module.exports = {
  MAX_STUDENT_ACCOUNTS,
  ALLOWED_DEPARTMENTS,
  ALLOWED_DOMAINS,
  DOMAIN_DISPLAY_NAMES,
  ALLOWED_PROGRAMS
};
