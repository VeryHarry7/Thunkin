# Handoffs

Agents work in parallel on separate surfaces. When you need a change in a file
another agent owns, **do not edit it** — drop a note here instead, named for
the agent making the request:

```
docs/handoffs/AGENT-06.md
```

One file per requesting agent, appended to over time. Newest entry at the top.

## Format

```markdown
## 2026-08-25 — need `queuePosition` on the SSE payload

**To:** AGENT-07
**Blocking:** no — the pending tile renders without it, just less usefully.

The composer's pending tile wants to show "3rd in queue". `Job.queuePosition`
already exists on the contract but the stream payload drops it.

Suggested: include it in the `progress` event when non-null.
```

State whether you are blocked. An agent scanning this directory needs to tell
in one line whether someone is stuck on them or merely waiting.

## When it is a contract change

Anything exported from `src/lib/contracts/` is shared vocabulary, and changing
a shape breaks every agent at once. Those requests go here **first**, with the
proposed shape written out, before any code moves.
