---
'@mastra/factory': patch
---

Factory runs no longer fail with `Unique constraint violation on collection 'source_control_sessions'` when two repositories of one factory have a card with the same number.

A card's session branch was named by its provider number alone (`factory/issue-13`), while a factory's sessions are unique per user and branch across all of its repositories. Issue #13 in a second repository therefore collided with the first one's session on every role, the retry found nothing to reuse under its own repository, and the bare constraint error was rethrown. Autonomous runs are all attributed to the user who connected the repositories, so every shared number was a collision.

GitHub cards now name their branch with the same per-card suffix GitLab cards already use: `factory/issue-13-<item suffix>` and `factory/pr-7-<item suffix>`. Branches named before this change still parse, and a session already bound to a card keeps its branch. When the factory-wide index does refuse a branch, the error now names the session that holds it instead of the constraint.
