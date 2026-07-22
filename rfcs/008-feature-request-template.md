# RFC 008: Feature Request RFC Template

## Problem

As DOM-Tools grows, proposed features need a consistent format for discussion. Without a template, feature ideas get logged as one-liners without enough context to evaluate, prioritize, or implement. We need a lightweight structure that captures the "what," "why," and "how" without being bureaucratic.

---

## Proposed Template

```markdown
# RFC [NNN]: [Feature Title]

## Problem
What user pain or gap does this address? Include real feedback or scenarios.

## Proposed Behavior
How should it work from the user's perspective? Include:
- Activation (how do you enter/trigger it?)
- Core interaction (what happens?)
- Output (what does it produce in the copy queue / on screen?)

## Open Questions
Unresolved design decisions. Things that need prototyping or user input.

## Out of Scope
What this RFC explicitly does NOT cover (to prevent scope creep).
```

---

## When to Write an RFC

- Feature touches multiple modes or introduces a new mode
- Feature has significant interaction design decisions
- Feature has been requested by users and needs discussion before implementation
- Feature could go several valid directions and we need to pick one

## When NOT to Write an RFC

- Bug fixes
- Small UI tweaks (move a button, change a color)
- Features with obvious single implementation path
