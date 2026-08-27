/** Unit tests for jira.js comment/attachment parsing (no network). */
import assert from "node:assert/strict";
import { parseComments, parseAttachments } from "../jira.js";

// --- comments: ADF bodies → plain text, empty dropped ---
const comments = parseComments({
  comments: [
    {
      author: { displayName: "Jane QA" },
      created: "2026-08-01T10:00:00.000Z",
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Reject expired tokens." }] }] },
    },
    { author: {}, body: { type: "doc", content: [] } }, // empty → dropped
  ],
});
assert.equal(comments.length, 1, "empty comment dropped");
assert.equal(comments[0].author, "Jane QA");
assert.match(comments[0].body, /Reject expired tokens\./);

// accepts a bare array too
assert.equal(parseComments([{ author: { name: "x" }, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi there" }] }] } }]).length, 1);
assert.deepEqual(parseComments(null), []);

// --- attachments: metadata + image flag ---
const atts = parseAttachments([
  { id: 101, filename: "mockup.png", mimeType: "image/png", size: 2048, content: "https://x/rest/api/3/attachment/content/101" },
  { id: 102, filename: "spec.pdf", mimeType: "application/pdf", size: 4096, content: "https://x/c/102" },
]);
assert.equal(atts.length, 2);
assert.equal(atts[0].isImage, true, "png is image");
assert.equal(atts[0].isPdf, false, "png is not pdf");
assert.equal(atts[0].id, "101", "id coerced to string");
assert.equal(atts[1].isImage, false, "pdf is not image");
assert.equal(atts[1].isPdf, true, "pdf detected by mimeType");
assert.equal(atts[1].filename, "spec.pdf");
// pdf detected by extension even when mimeType is generic/missing
assert.equal(parseAttachments([{ id: 3, filename: "notes.PDF", mimeType: "application/octet-stream", content: "u" }])[0].isPdf, true);
assert.deepEqual(parseAttachments(undefined), []);

console.log("jira-parse tests: ok");
