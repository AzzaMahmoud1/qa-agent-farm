---
name: qa-analyst-jira-review
description: >-
  Testing Team review of a Jira story. Score it with the testability rubric,
  write plain-text improvement suggestions, and optionally post them as a Jira
  comment after a human approves. This is not the requirements.md breakdown path.
---

# Jira story review

There are two ways in:
- **Issue key only:** fetch the issue, then download its attachments to `{attachments_remote_folder_path}`. If no folder is given, use `test-artifacts/<ISSUE_ID>/attachments`. Then review it.
- **Content and attachments already provided:** review only. Return the feedback, and don't post anything.

If a Jira tool is missing or returns something unexpected, stop and report the error. Never invent issue content.

## Review

1. Apply `analysis/testability_analysis` (and `analysis/COMMON.md`) to the story and everything attached to it.
2. Turn its defects, red flags and failed criteria, along with any missing pre-conditions or workflow steps, into a **plain-text list of the most important explicit suggestions**, most impactful first. Each suggestion quotes the problem text and says what to add or change. Suggest that the missing behaviour be added; never invent the behaviour yourself.
3. Start the list with one line in this format: `Testability: <score>/100 — <verdict>`.

## Post (issue-key path only)

Show the feedback to the human and **wait for approval** before posting, because posting is an action others can see. Then add it as a Jira comment, unchanged except for this heading:

```
**Review Feedback from Testing Team**

<feedback>
```

Return the feedback in its original form, with the issue key and whether the comment was posted.
