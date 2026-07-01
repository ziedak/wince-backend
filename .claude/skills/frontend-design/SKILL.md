---
name: frontend-design
description: React + shadcn/ui designer. Distinctive, accessible, production-ready UI.
---

# Frontend Design

**Tech**: React + shadcn/ui (Radix) – imports `@/components` – mobile-first, accessible.
**Anti-patterns** (avoid unless brief explicitly says):
- Warm cream (#F4F1EA) + serif + terracotta
- Dark bg + acid-green/vermilion
- Broadsheet (0 radius, newspaper columns)
- Gradient + KPI heroes, glassmorphism, icon walls, excessive cards
- Generic dashboards, interchangeable sections, hidden actions, decoration-only
**Design rules**:
- **Context**: subject/audience – infer if obvious; otherwise state assumptions.
- **Hero**: primary action > insight > object > brand – must communicate purpose immediately.
- **Hierarchy**: Primary → Secondary → Supporting. Every section justifies itself.
- **Typography**: Display ≠ Body. Max 3 roles. Prefer system-safe or imported fonts.
- **Motion**: One intentional moment. Respect `prefers-reduced-motion`. Must aid understanding.
- **Signature**: One element that improves comprehension, emotion, or interaction – never decoration.
- **Restraint**: Remove anything that doesn't clarify, guide, convert, or reinforce identity.
**Process**:
1. **PROPOSAL** (mandatory): output wireframe design and YAML; DO NOT CODE.
```yaml
proposal:
  subject: string
  assumptions: []
  colors: {primary: hex, secondary: hex, accent: hex, surface: hex, text: hex}
  type: {display: face, body: face, utility: face|null}
  hierarchy: {primary_goal: string, secondary_goal: string}
  layout: "1 sentence"
  wireframe: "ASCII (≤10 lines)"
  signature: string
  accessibility: {contrast: "AA", motion: "reduced-supported"}
  self_critique: "specific change avoiding generic defaults"
```
→ STOP. Wait for approval.
2. **BUILD** (after approval): translate to React. Use `@/components`. Prefer composition. Avoid selector conflicts. Mobile-first. :focus-visible. Respect reduced motion.

Copy: Sentence case, direct, no filler. User language (e.g., "Manage notifications"). CTAs match outcome ("Save" → "Saved"). Errors: state failure + next action, no apologies. Empty: explain + suggest action.

Quality gates (auto-verify):
- Keyboard navigable, visible focus, AA contrast, reduced motion
- Mobile responsive, CTA visible, no collisions
- Empty/error/loading states handled
- Not generic: reject if hero is gradient+stats, sections interchangeable, signature removable, or layout resembles default SaaS.

Complexity caps: ≤2 card nesting, ≤3 accent colors, ≤2 interaction styles, progressive disclosure.
text