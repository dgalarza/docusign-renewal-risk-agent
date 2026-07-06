# Supplier Renewal Risk Agent Concept

## Summary

Procurement teams often do not lose money because a supplier agreement was unsigned. They lose money because a completed supplier agreement quietly auto-renews before anyone reviews it.

This demo uses Docusign Agreement Manager as the completed-agreement intelligence layer, then adds a Mastra agent workflow that finds renewal risk, explains the risk, and routes human-approved follow-up through Docusign Workflow Builder.

## Target Question

Which completed supplier agreements are renewing soon, and which ones need procurement or legal action before the notice window closes?

## Risk Policy

- Auto-renewing agreement over `$50k` requires review.
- Notice deadline within 30 days is urgent.
- Notice deadline already passed is blocked or escalated.
- Missing renewal date or notice period needs review.

Deterministic policy severity order is `standard < needs_review < urgent <
blocked`. When multiple rules match the same agreement, the highest-severity
finding wins.

## Demo Output

For each at-risk agreement, show:

- Supplier
- Renewal date
- Notice deadline
- Renewal value
- Renewal type
- Risk classification
- Reasoning
- Recommended action
