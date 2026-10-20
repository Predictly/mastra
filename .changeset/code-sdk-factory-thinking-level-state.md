---
'@mastra/code-sdk': patch
---

Session state declares `factoryThinkingLevel`, the thinking level the Factory chose for the phase a run binding was prepared for, so state validation keeps it. Resolved below a session's own `thinkingLevel` and above the Factory's stored default.
