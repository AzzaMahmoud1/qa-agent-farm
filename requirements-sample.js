/**
 * Canonical requirements paste used for pipeline smoke tests and simulator demo.
 */
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LOGIN_USE_CASE_SAMPLE };
}
if (typeof window !== "undefined") {
  window.LOGIN_USE_CASE_SAMPLE = LOGIN_USE_CASE_SAMPLE;
}
