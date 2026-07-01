
// ─── Static Data ──────────────────────────────────────────────────────────────

import { Home, Package, ShoppingCart, CreditCard, MousePointer2 } from "lucide-react";

export const ALL_CAMPAIGNS: Campaign[] = [
  { id: "summer",   name: "Summer Disc",      active: true,  trend: 12 },
  { id: "freeship", name: "Free Ship",         active: true,  trend: -4 },
  { id: "exitpop",  name: "Exit Popup",        active: false, trend: null },
  { id: "cart",     name: "Cart Remind",       active: true,  trend: 3 },
  { id: "loyalty",  name: "Loyalty Reward",    active: true,  trend: 7 },
  { id: "flash",    name: "Flash Sale",        active: false, trend: null },
  { id: "vip",      name: "VIP Early Access",  active: true,  trend: 21 },
  { id: "bundle",   name: "Bundle Offer",      active: false, trend: -2 },
  { id: "referral", name: "Referral Bonus",    active: true,  trend: 5 },
];

export const DEFAULT_PINNED = new Set(["summer", "freeship", "exitpop", "cart"]);

export const FUNNEL = [
  { label: "Homepage", count: 1244, pct: 100, drop: null,  health: "good"   as  const },
  { label: "Product",  count: 814,  pct: 65,  drop: 82,    health: "good"   as  const },
  { label: "Cart",     count: 238,  pct: 19,  drop: 38,    health: "warn"   as  const },
  { label: "Checkout", count: 71,   pct: 6,   drop: 29,    health: "danger" as  const },
  { label: "Purchase", count: 51,   pct: 4,   drop: 72,    health: "good"   as  const },
];

export const ANOMALIES: AnomalyItem[] = [
  { time: "14:22", event: "Mobile checkout drop −12% vs. baseline", status: "active" },
  { time: "14:25", event: "New bot‑like pattern detected",           status: "monitoring" },
  { time: "14:28", event: "Model confidence recovering",             status: "resolved" },
];

export const PENDING_INIT: PendingApproval[] = [
  {
    id: "p1", title: "Free Shipping for carts >$150", batchCount: 4, cost: 0, est: 1120,
    description: "AI flagged 4 sessions where free shipping has >88% confidence of recovery. All are mobile users hesitating at checkout.",
    items: [
      { sid: "A1F2", visitor: "Guest #A1F2", cart: 320, stage: "Checkout", device: "mobile" },
      { sid: "B3C4", visitor: "Sarah M.",     cart: 210, stage: "Checkout", device: "mobile" },
      { sid: "D5E6", visitor: "Guest #D5E6", cart: 178, stage: "Cart",     device: "mobile" },
      { sid: "G7H8", visitor: "Tom R.",       cart: 155, stage: "Checkout", device: "mobile" },
    ],
  },
  {
    id: "p2", title: "10% Discount — first‑time visitor", batchCount: 1, cost: 28, est: 312, extra: "cart $340",
    description: "Single high-value first-time visitor on desktop, price-comparing. 10% discount keeps margin positive.",
    items: [
      { sid: "K9L0", visitor: "Guest #K9L0", cart: 340, stage: "Product", device: "desktop" },
    ],
  },
  {
    id: "p3", title: "Urgency banner — exit intent (mobile)", batchCount: 3, cost: 0, est: 540,
    description: "3 mobile sessions showing exit intent signals. Zero-cost urgency message ('Only 2 left') recommended.",
    items: [
      { sid: "M1N2", visitor: "Guest #M1N2", cart: 190, stage: "Cart",     device: "mobile" },
      { sid: "P3Q4", visitor: "Aisha K.",    cart: 210, stage: "Checkout", device: "mobile" },
      { sid: "R5S6", visitor: "Guest #R5S6", cart: 140, stage: "Cart",     device: "mobile" },
    ],
  },
  {
    id: "p4", title: "5% Loyalty discount — returning buyers", batchCount: 2, cost: 44, est: 780, extra: "carts >$200",
    description: "2 returning customers who haven't triggered the loyalty tier yet. Small discount nudges them to purchase.",
    items: [
      { sid: "T7U8", visitor: "James L.",  cart: 420, stage: "Checkout", device: "desktop" },
      { sid: "V9W0", visitor: "Priya N.",  cart: 360, stage: "Cart",     device: "mobile" },
    ],
  },
  {
    id: "p5", title: "Free express shipping — VIP segment", batchCount: 1, cost: 18, est: 890, extra: "cart $890",
    description: "High-LTV VIP customer with cross-border pricing concern. Express shipping removes last friction point.",
    items: [
      { sid: "X1Y2", visitor: "Priya K.", cart: 890, stage: "Checkout", device: "mobile" },
    ],
  },
  {
    id: "p6", title: "Abandoned cart reminder — 2h delay", batchCount: 6, cost: 0, est: 430,
    description: "6 sessions that left without purchasing. Scheduled reminder at 2h window has 61% open rate for this segment.",
    items: [
      { sid: "Z3A4", visitor: "Guest #Z3A4", cart: 95,  stage: "Cart", device: "desktop" },
      { sid: "B5C6", visitor: "Lena W.",     cart: 78,  stage: "Cart", device: "mobile" },
      { sid: "D7E8", visitor: "Guest #D7E8", cart: 110, stage: "Cart", device: "desktop" },
      { sid: "F9G0", visitor: "Omar S.",     cart: 64,  stage: "Cart", device: "mobile" },
      { sid: "H1I2", visitor: "Guest #H1I2", cart: 52,  stage: "Cart", device: "mobile" },
      { sid: "J3K4", visitor: "Nina T.",     cart: 88,  stage: "Cart", device: "desktop" },
    ],
  },
];

export const EXCEPTIONS: ExceptionItem[] = [
  { id: "e1", level: "vip",  label: "VIP customer (LTV $4,200)", cart: 890, confidence: 54, reason: "Cross‑border pricing anomaly" },
  { id: "e2", level: "high", label: "High‑value + first‑time visitor", cart: 340, confidence: 68, reason: "Unusual session pattern" },
];

export const RECOVERIES = ["+$48", "+$73", "+$31", "+$18", "+$52", "+$67", "+$29", "+$94", "+$55", "+$140", "+$220"];

export const AI_ADAPTATIONS = [
  "Detected mobile shipping hesitation → auto‑deployed express shipping promo",
  "Flagged bot‑like behaviour on gift card page → paused interventions for segment",
];

export const AUTO_DECISIONS = [
  { time: "14:25", visitor: "Guest #F1A0", action: "Held for review",       detail: "10% discount would exceed budget" },
  { time: "14:23", visitor: "John D.",     action: "Free shipping offered",  detail: "Tier‑1, margin‑safe" },
  { time: "14:22", visitor: "Guest #A3C2", action: "Urgency message",        detail: "Cart >$200, exit intent" },
];

export const DRAWER_SESSION: DrawerSession = { id: "2401", name: "Priya K.", cart: 890, risk: 87, device: "mobile", stage: "Checkout" };

export const DRAWER_TIMELINE = [
  { icon: Home,         label: "Landed on Homepage",  note: "Via Google Shopping ad",     time: "14:08", color: "#10b981" },
  { icon: Package,      label: "Viewed product page", note: "3 min 20s — high engagement", time: "14:12", color: "#10b981" },
  { icon: ShoppingCart, label: "Added to cart",       note: "$890 item",                   time: "14:16", color: "#f59e0b" },
  { icon: CreditCard,   label: "Reached checkout",    note: "Paused 6s on shipping cost",  time: "14:21", color: "#ef4444" },
  { icon: MousePointer2,label: "Exit intent fired",   note: "Mobile swipe‑up gesture",     time: "14:22", color: "#ef4444" },
];