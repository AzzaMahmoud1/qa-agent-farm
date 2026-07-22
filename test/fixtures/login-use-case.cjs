/** Test-only fixture — not served by the simulator. */
const LOGIN_USE_CASE_SAMPLE = `Login use case
UC05
Priority: High
Status: Draft

Pre-conditions
User has registered account

Post-conditions
User is logged in

Basic Flow
1. User opens login page
2. User enters credentials

Alternative Flow
Invalid password shows error

User must enter valid email and password
System rejects invalid credentials`;

module.exports = { LOGIN_USE_CASE_SAMPLE };
