// Mock data for the cart recovery dashboard

export interface Visitor {
  id: string;
  name: string;
  email: string;
  currentPage: string;
  cartValue: number;
  frustrationScore: number;
  abandonmentProbability: number;
  interventionState: "none" | "triggered" | "converted" | "dismissed";
  timeOnSite: number;
  sessionStart: Date;
  device: "desktop" | "mobile" | "tablet";
  location: string;
}

export interface CustomerEvent {
  id: string;
  timestamp: Date;
  type: "page_view" | "cart_add" | "cart_remove" | "scroll" | "hesitation" | "frustration" | "intervention" | "conversion";
  page: string;
  data?: any;
}

export interface AIDecision {
  id: string;
  visitorId: string;
  visitorName: string;
  timestamp: Date;
  intervention: string;
  confidence: number;
  predictedOutcome: "convert" | "abandon" | "uncertain";
  reasoning: string;
  actualOutcome?: "converted" | "abandoned" | "pending";
  revenue?: number;
}

export interface Intervention {
  id: string;
  name: string;
  type: "discount" | "urgency" | "social_proof" | "reminder" | "recommendation";
  status: "active" | "paused" | "draft";
  conversions: number;
  views: number;
  revenue: number;
  lastModified: Date;
}

export interface Segment {
  id: string;
  name: string;
  description: string;
  size: number;
  growthRate: number;
  avgCartValue: number;
  recoveryRate: number;
  ltv: number;
  riskLevel: "low" | "medium" | "high";
  primarySignal: string;
  color: string;
}

export interface ABTest {
  id: string;
  name: string;
  status: "running" | "completed" | "paused" | "draft";
  startDate: Date;
  endDate?: Date;
  targetSegment: string;
  variants: {
    id: string;
    name: string;
    description: string;
    visitors: number;
    conversions: number;
    revenue: number;
  }[];
  significance: number;
  winner?: string;
  hypothesis: string;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  status: "active" | "paused" | "draft";
  trigger: string;
  steps: {
    id: string;
    type: "wait" | "condition" | "action" | "branch";
    label: string;
    detail: string;
    delay?: string;
  }[];
  stats: {
    triggered: number;
    converted: number;
    revenue: number;
  };
  lastModified: Date;
}

export interface Integration {
  id: string;
  name: string;
  category: "ecommerce" | "email" | "analytics" | "crm" | "payment";
  status: "connected" | "disconnected" | "error" | "pending";
  icon: string;
  description: string;
  lastSync?: Date;
  eventsToday?: number;
}

// Visitors
export const mockVisitors: Visitor[] = [
  {
    id: "v1",
    name: "Sarah Chen",
    email: "sarah.chen@email.com",
    currentPage: "/checkout",
    cartValue: 247.50,
    frustrationScore: 0.75,
    abandonmentProbability: 0.82,
    interventionState: "triggered",
    timeOnSite: 420,
    sessionStart: new Date(Date.now() - 420000),
    device: "desktop",
    location: "San Francisco, CA",
  },
  {
    id: "v2",
    name: "Marcus Johnson",
    email: "marcus.j@email.com",
    currentPage: "/cart",
    cartValue: 89.99,
    frustrationScore: 0.45,
    abandonmentProbability: 0.58,
    interventionState: "none",
    timeOnSite: 180,
    sessionStart: new Date(Date.now() - 180000),
    device: "mobile",
    location: "Austin, TX",
  },
  {
    id: "v3",
    name: "Emily Rodriguez",
    email: "emily.r@email.com",
    currentPage: "/product/wireless-headphones",
    cartValue: 159.00,
    frustrationScore: 0.25,
    abandonmentProbability: 0.35,
    interventionState: "converted",
    timeOnSite: 640,
    sessionStart: new Date(Date.now() - 640000),
    device: "desktop",
    location: "Miami, FL",
  },
  {
    id: "v4",
    name: "David Kim",
    email: "david.kim@email.com",
    currentPage: "/shipping",
    cartValue: 312.00,
    frustrationScore: 0.65,
    abandonmentProbability: 0.71,
    interventionState: "triggered",
    timeOnSite: 290,
    sessionStart: new Date(Date.now() - 290000),
    device: "tablet",
    location: "Seattle, WA",
  },
  {
    id: "v5",
    name: "Lisa Anderson",
    email: "lisa.a@email.com",
    currentPage: "/cart",
    cartValue: 45.50,
    frustrationScore: 0.15,
    abandonmentProbability: 0.22,
    interventionState: "none",
    timeOnSite: 95,
    sessionStart: new Date(Date.now() - 95000),
    device: "mobile",
    location: "Boston, MA",
  },
  {
    id: "v6",
    name: "James Park",
    email: "james.p@email.com",
    currentPage: "/product/running-shoes",
    cartValue: 178.00,
    frustrationScore: 0.55,
    abandonmentProbability: 0.66,
    interventionState: "triggered",
    timeOnSite: 340,
    sessionStart: new Date(Date.now() - 340000),
    device: "desktop",
    location: "Chicago, IL",
  },
  {
    id: "v7",
    name: "Nina Patel",
    email: "nina.p@email.com",
    currentPage: "/checkout",
    cartValue: 524.00,
    frustrationScore: 0.85,
    abandonmentProbability: 0.91,
    interventionState: "triggered",
    timeOnSite: 510,
    sessionStart: new Date(Date.now() - 510000),
    device: "desktop",
    location: "New York, NY",
  },
  {
    id: "v8",
    name: "Carlos Rivera",
    email: "carlos.r@email.com",
    currentPage: "/cart",
    cartValue: 63.50,
    frustrationScore: 0.30,
    abandonmentProbability: 0.41,
    interventionState: "none",
    timeOnSite: 150,
    sessionStart: new Date(Date.now() - 150000),
    device: "mobile",
    location: "Los Angeles, CA",
  },
];

export const generateCustomerEvents = (visitorId: string): CustomerEvent[] => {
  return [
    { id: "e1", timestamp: new Date(Date.now() - 600000), type: "page_view", page: "/home" },
    { id: "e2", timestamp: new Date(Date.now() - 540000), type: "page_view", page: "/category/electronics" },
    { id: "e3", timestamp: new Date(Date.now() - 480000), type: "scroll", page: "/category/electronics", data: { depth: "75%" } },
    { id: "e4", timestamp: new Date(Date.now() - 420000), type: "page_view", page: "/product/wireless-headphones" },
    { id: "e5", timestamp: new Date(Date.now() - 360000), type: "hesitation", page: "/product/wireless-headphones", data: { duration: "45s" } },
    { id: "e6", timestamp: new Date(Date.now() - 300000), type: "cart_add", page: "/product/wireless-headphones", data: { value: 159.00 } },
    { id: "e7", timestamp: new Date(Date.now() - 240000), type: "page_view", page: "/cart" },
    { id: "e8", timestamp: new Date(Date.now() - 180000), type: "frustration", page: "/cart", data: { reason: "Form errors" } },
    { id: "e9", timestamp: new Date(Date.now() - 120000), type: "intervention", page: "/cart", data: { type: "10% discount" } },
    { id: "e10", timestamp: new Date(Date.now() - 60000), type: "page_view", page: "/checkout" },
    { id: "e11", timestamp: new Date(Date.now() - 30000), type: "conversion", page: "/checkout", data: { value: 159.00 } },
  ];
};

export const mockAIDecisions: AIDecision[] = [
  {
    id: "d1",
    visitorId: "v1",
    visitorName: "Sarah Chen",
    timestamp: new Date(Date.now() - 180000),
    intervention: "15% First-Time Discount",
    confidence: 0.87,
    predictedOutcome: "convert",
    reasoning: "High cart value ($247.50), strong hesitation signals on checkout page, price-sensitive behavior detected. Historical data shows 78% conversion with discount intervention for similar profiles.",
    actualOutcome: "pending",
  },
  {
    id: "d2",
    visitorId: "v3",
    visitorName: "Emily Rodriguez",
    timestamp: new Date(Date.now() - 300000),
    intervention: "Social Proof + Free Shipping",
    confidence: 0.92,
    predictedOutcome: "convert",
    reasoning: "Extended engagement (10+ minutes), comparing products, low frustration. Social proof combined with free shipping threshold has 85% success rate for this segment.",
    actualOutcome: "converted",
    revenue: 159.00,
  },
  {
    id: "d3",
    visitorId: "v4",
    visitorName: "David Kim",
    timestamp: new Date(Date.now() - 120000),
    intervention: "Urgency: Limited Stock Alert",
    confidence: 0.74,
    predictedOutcome: "convert",
    reasoning: "High cart value, shipping page abandonment pattern. FOMO-based interventions show 68% effectiveness for this cart value range.",
    actualOutcome: "pending",
  },
  {
    id: "d4",
    visitorId: "v6",
    visitorName: "Michael Torres",
    timestamp: new Date(Date.now() - 480000),
    intervention: "Product Recommendation",
    confidence: 0.65,
    predictedOutcome: "uncertain",
    reasoning: "Browsing behavior suggests interest but no clear purchase intent. Cart value below average. Recommendation to increase basket size.",
    actualOutcome: "abandoned",
  },
  {
    id: "d5",
    visitorId: "v7",
    visitorName: "Jessica Park",
    timestamp: new Date(Date.now() - 600000),
    intervention: "Exit Intent: 10% Off",
    confidence: 0.81,
    predictedOutcome: "convert",
    reasoning: "Cart abandonment imminent (95% probability). Exit intent popup with discount has 72% recovery rate for mobile users with similar cart values.",
    actualOutcome: "converted",
    revenue: 89.99,
  },
  {
    id: "d6",
    visitorId: "v7",
    visitorName: "Nina Patel",
    timestamp: new Date(Date.now() - 60000),
    intervention: "High-Value Concierge Chat",
    confidence: 0.89,
    predictedOutcome: "convert",
    reasoning: "Cart value $524, extreme frustration score (0.85), three failed payment attempts. Proactive concierge chat has 91% success rate for carts >$400.",
    actualOutcome: "pending",
    revenue: undefined,
  },
];

export const mockInterventions: Intervention[] = [
  {
    id: "i1",
    name: "15% First-Time Discount",
    type: "discount",
    status: "active",
    conversions: 342,
    views: 1205,
    revenue: 45680.00,
    lastModified: new Date(Date.now() - 86400000),
  },
  {
    id: "i2",
    name: "Urgency: Limited Stock",
    type: "urgency",
    status: "active",
    conversions: 198,
    views: 876,
    revenue: 28340.50,
    lastModified: new Date(Date.now() - 172800000),
  },
  {
    id: "i3",
    name: "Social Proof Banner",
    type: "social_proof",
    status: "active",
    conversions: 267,
    views: 1543,
    revenue: 32150.00,
    lastModified: new Date(Date.now() - 259200000),
  },
  {
    id: "i4",
    name: "Exit Intent Popup",
    type: "reminder",
    status: "active",
    conversions: 423,
    views: 2341,
    revenue: 51230.00,
    lastModified: new Date(Date.now() - 432000000),
  },
  {
    id: "i5",
    name: "Recommended Products",
    type: "recommendation",
    status: "paused",
    conversions: 89,
    views: 654,
    revenue: 12450.00,
    lastModified: new Date(Date.now() - 604800000),
  },
];

// Analytics data
export const revenueRecoveryData = [
  { date: "Jun 11", recovered: 4200, potential: 8500 },
  { date: "Jun 12", recovered: 5100, potential: 9200 },
  { date: "Jun 13", recovered: 3800, potential: 7800 },
  { date: "Jun 14", recovered: 6200, potential: 10500 },
  { date: "Jun 15", recovered: 5800, potential: 9800 },
  { date: "Jun 16", recovered: 7100, potential: 11200 },
  { date: "Jun 17", recovered: 6500, potential: 10100 },
  { date: "Jun 18", recovered: 4900, potential: 8900 },
];

export const interventionPerformanceData = [
  { name: "Discount", conversions: 342, revenue: 45680 },
  { name: "Urgency", conversions: 198, revenue: 28340 },
  { name: "Social Proof", conversions: 267, revenue: 32150 },
  { name: "Exit Intent", conversions: 423, revenue: 51230 },
  { name: "Recommendations", conversions: 89, revenue: 12450 },
];

export const hourlyActivityData = [
  { hour: "12am", visitors: 45, conversions: 8 },
  { hour: "3am", visitors: 32, conversions: 5 },
  { hour: "6am", visitors: 68, conversions: 12 },
  { hour: "9am", visitors: 145, conversions: 28 },
  { hour: "12pm", visitors: 198, conversions: 42 },
  { hour: "3pm", visitors: 234, conversions: 56 },
  { hour: "6pm", visitors: 267, conversions: 63 },
  { hour: "9pm", visitors: 189, conversions: 38 },
];

export const segmentPerformanceData = [
  { segment: "First-time visitors", recoveryRate: 28.4, avgRevenue: 134 },
  { segment: "Returning customers", recoveryRate: 42.1, avgRevenue: 218 },
  { segment: "Mobile users", recoveryRate: 24.7, avgRevenue: 98 },
  { segment: "Desktop users", recoveryRate: 38.9, avgRevenue: 186 },
  { segment: "High-value carts", recoveryRate: 51.2, avgRevenue: 324 },
];

// Revenue Intelligence data
export const revenueForecastData = [
  { date: "Jun 1", actual: 38200, forecast: null, upper: null, lower: null },
  { date: "Jun 5", actual: 41500, forecast: null, upper: null, lower: null },
  { date: "Jun 9", actual: 39800, forecast: null, upper: null, lower: null },
  { date: "Jun 13", actual: 44100, forecast: null, upper: null, lower: null },
  { date: "Jun 17", actual: 43250, forecast: null, upper: null, lower: null },
  { date: "Jun 21", actual: null, forecast: 46800, upper: 51200, lower: 42400 },
  { date: "Jun 25", actual: null, forecast: 49200, upper: 54100, lower: 44300 },
  { date: "Jun 29", actual: null, forecast: 52100, upper: 57500, lower: 46700 },
];

export const cohortRetentionData = [
  { cohort: "Jan 2026", m0: 100, m1: 62, m2: 48, m3: 41, m4: 36, m5: 33 },
  { cohort: "Feb 2026", m0: 100, m1: 65, m2: 51, m3: 44, m4: 38, m5: null },
  { cohort: "Mar 2026", m0: 100, m1: 68, m2: 53, m3: 46, m4: null, m5: null },
  { cohort: "Apr 2026", m0: 100, m1: 71, m2: 57, m3: null, m4: null, m5: null },
  { cohort: "May 2026", m0: 100, m1: 74, m2: null, m3: null, m4: null, m5: null },
  { cohort: "Jun 2026", m0: 100, m1: null, m2: null, m3: null, m4: null, m5: null },
];

export const revenueAttributionData = [
  { channel: "Exit Intent", value: 51230, pct: 30.1 },
  { channel: "Discount Popup", value: 45680, pct: 26.8 },
  { channel: "Social Proof", value: 32150, pct: 18.9 },
  { channel: "Urgency Banner", value: 28340, pct: 16.6 },
  { channel: "Recommendations", value: 12450, pct: 7.3 },
  { channel: "Email Recovery", value: 10200, pct: 6.0 },
];

// Customer Segments data
export const mockSegments: Segment[] = [
  {
    id: "s1",
    name: "High-Intent Buyers",
    description: "Visitors with multiple product views, high scroll depth, and items added to cart within 5 minutes",
    size: 2840,
    growthRate: 12.4,
    avgCartValue: 287.50,
    recoveryRate: 54.2,
    ltv: 892,
    riskLevel: "medium",
    primarySignal: "Cart add + checkout visit",
    color: "#00d4a8",
  },
  {
    id: "s2",
    name: "Price-Sensitive Shoppers",
    description: "Users who visit pricing pages, apply coupon codes, and abandon when shipping costs appear",
    size: 4120,
    growthRate: 8.7,
    avgCartValue: 94.20,
    recoveryRate: 48.6,
    ltv: 312,
    riskLevel: "high",
    primarySignal: "Shipping page exit",
    color: "#f59e0b",
  },
  {
    id: "s3",
    name: "Comparison Browsers",
    description: "Multi-session visitors who view same products repeatedly before committing to purchase",
    size: 1560,
    growthRate: 5.2,
    avgCartValue: 183.00,
    recoveryRate: 36.8,
    ltv: 654,
    riskLevel: "medium",
    primarySignal: "Repeated product views",
    color: "#6366f1",
  },
  {
    id: "s4",
    name: "Impulse Abandoners",
    description: "Fast sessions with high frustration signals — form errors, slow load times, payment failures",
    size: 3280,
    growthRate: -2.1,
    avgCartValue: 127.40,
    recoveryRate: 29.3,
    ltv: 215,
    riskLevel: "high",
    primarySignal: "Frustration events",
    color: "#f43f5e",
  },
  {
    id: "s5",
    name: "Loyal Returners",
    description: "Repeat customers with 3+ previous orders who are showing unusual hesitation in current session",
    size: 892,
    growthRate: 18.9,
    avgCartValue: 342.00,
    recoveryRate: 67.4,
    ltv: 1420,
    riskLevel: "low",
    primarySignal: "Return visit + high LTV",
    color: "#8b5cf6",
  },
  {
    id: "s6",
    name: "Mobile Window Shoppers",
    description: "Mobile users with long sessions but low purchase intent — browsing without adding to cart",
    size: 5640,
    growthRate: 22.3,
    avgCartValue: 68.90,
    recoveryRate: 18.7,
    ltv: 142,
    riskLevel: "low",
    primarySignal: "Long session, no cart add",
    color: "#06b6d4",
  },
];

// A/B Tests
export const mockABTests: ABTest[] = [
  {
    id: "t1",
    name: "Discount vs. Urgency for High-Value Carts",
    status: "running",
    startDate: new Date(Date.now() - 14 * 86400000),
    targetSegment: "High-Intent Buyers",
    hypothesis: "A personalized urgency message will outperform a generic discount for carts >$200 because these buyers are already convinced of value.",
    significance: 78,
    variants: [
      { id: "a", name: "Control: 15% Discount", description: "Standard 15% off popup on exit intent", visitors: 1842, conversions: 596, revenue: 87420 },
      { id: "b", name: "Treatment: Limited Stock", description: "\"Only 3 left\" urgency banner with countdown", visitors: 1809, conversions: 631, revenue: 93810 },
    ],
  },
  {
    id: "t2",
    name: "Social Proof Placement Test",
    status: "running",
    startDate: new Date(Date.now() - 8 * 86400000),
    targetSegment: "Comparison Browsers",
    hypothesis: "Showing social proof on the cart page (vs. product page) will reduce abandonment for users already considering purchase.",
    significance: 62,
    variants: [
      { id: "a", name: "Product Page Banner", description: "Reviews + sold count on product page", visitors: 934, conversions: 248, revenue: 42160 },
      { id: "b", name: "Cart Page Banner", description: "Reviews + sold count on cart page", visitors: 941, conversions: 289, revenue: 49130 },
    ],
  },
  {
    id: "t3",
    name: "Email Recovery: Subject Line Personalization",
    status: "completed",
    startDate: new Date(Date.now() - 30 * 86400000),
    endDate: new Date(Date.now() - 5 * 86400000),
    targetSegment: "Price-Sensitive Shoppers",
    hypothesis: "Personalizing the recovery email subject line with cart contents will increase open rates.",
    significance: 98,
    winner: "b",
    variants: [
      { id: "a", name: "Generic Subject", description: "\"You left something behind...\"", visitors: 2140, conversions: 384, revenue: 38200 },
      { id: "b", name: "Personalized Subject", description: "\"Your [Product] is waiting + 10% off\"", visitors: 2156, conversions: 517, revenue: 51400 },
    ],
  },
  {
    id: "t4",
    name: "Free Shipping Threshold Message",
    status: "paused",
    startDate: new Date(Date.now() - 5 * 86400000),
    targetSegment: "Price-Sensitive Shoppers",
    hypothesis: "Showing progress toward free shipping threshold will increase average order value.",
    significance: 41,
    variants: [
      { id: "a", name: "No Threshold Message", description: "Standard cart view", visitors: 521, conversions: 98, revenue: 8820 },
      { id: "b", name: "Threshold Progress Bar", description: "\"Add $12 more for free shipping\"", visitors: 534, conversions: 118, revenue: 10620 },
    ],
  },
];

// Playbooks
export const mockPlaybooks: Playbook[] = [
  {
    id: "p1",
    name: "High-Value Cart Recovery Sequence",
    description: "Multi-touch recovery for carts over $150 — combines urgency, social proof, and escalating discounts",
    status: "active",
    trigger: "Cart value > $150 AND abandonment probability > 70%",
    steps: [
      { id: "s1", type: "action", label: "Show Exit Intent Popup", detail: "Display urgency overlay with limited stock message" },
      { id: "s2", type: "wait", label: "Wait 10 minutes", detail: "Allow user to reconsider", delay: "10m" },
      { id: "s3", type: "condition", label: "Check: Still active?", detail: "If visitor returns to site" },
      { id: "s4", type: "action", label: "Show Social Proof Banner", detail: "\"142 people bought this today\" banner on product page" },
      { id: "s5", type: "wait", label: "Wait 24 hours", detail: "Recovery email window", delay: "24h" },
      { id: "s6", type: "action", label: "Send Recovery Email", detail: "Personalized email with 10% discount code" },
      { id: "s7", type: "wait", label: "Wait 48 hours", detail: "Final attempt window", delay: "48h" },
      { id: "s8", type: "action", label: "Send Final Offer", detail: "15% off + free shipping — expires in 24h" },
    ],
    stats: { triggered: 1842, converted: 487, revenue: 89340 },
    lastModified: new Date(Date.now() - 3 * 86400000),
  },
  {
    id: "p2",
    name: "Mobile Price-Sensitive Recovery",
    description: "Lightweight recovery for mobile users with carts under $100 — focuses on reducing friction",
    status: "active",
    trigger: "Device = mobile AND cart value < $100 AND shipping page exit",
    steps: [
      { id: "s1", type: "action", label: "Show Free Shipping Offer", detail: "Trigger free shipping if cart within $15 of threshold" },
      { id: "s2", type: "wait", label: "Wait 30 minutes", detail: "Allow user to decide", delay: "30m" },
      { id: "s3", type: "action", label: "Send SMS Reminder", detail: "\"Your cart is ready — free shipping added!\"" },
    ],
    stats: { triggered: 2340, converted: 562, revenue: 43210 },
    lastModified: new Date(Date.now() - 7 * 86400000),
  },
  {
    id: "p3",
    name: "Returning Customer VIP Recovery",
    description: "Premium recovery flow for customers with 3+ previous orders — prioritizes relationship over discount",
    status: "active",
    trigger: "Customer lifetime orders >= 3 AND current session abandonment probability > 60%",
    steps: [
      { id: "s1", type: "action", label: "Proactive Chat Message", detail: "\"Hi [Name], can we help? You were just looking at...\"" },
      { id: "s2", type: "condition", label: "Chat responded?", detail: "Branch based on chat engagement" },
      { id: "s3", type: "action", label: "Offer Concierge Service", detail: "Personal shopper assistance + VIP discount" },
    ],
    stats: { triggered: 412, converted: 278, revenue: 94820 },
    lastModified: new Date(Date.now() - 12 * 86400000),
  },
  {
    id: "p4",
    name: "First-Time Visitor Nurture",
    description: "Soft-touch sequence for first-time visitors — builds trust before pushing for conversion",
    status: "paused",
    trigger: "First visit AND session time > 5 minutes AND cart add detected",
    steps: [
      { id: "s1", type: "action", label: "Show Trust Signals", detail: "Display reviews, secure badge, return policy" },
      { id: "s2", type: "wait", label: "Wait 15 minutes", detail: "Observe behavior", delay: "15m" },
      { id: "s3", type: "action", label: "Offer Welcome Discount", detail: "\"10% off your first order\" popup" },
      { id: "s4", type: "action", label: "Send Welcome Email", detail: "Brand story + first-order discount" },
    ],
    stats: { triggered: 3120, converted: 624, revenue: 56780 },
    lastModified: new Date(Date.now() - 21 * 86400000),
  },
];

// Integrations
export const mockIntegrations: Integration[] = [
  {
    id: "int1",
    name: "Shopify",
    category: "ecommerce",
    status: "connected",
    icon: "S",
    description: "Sync orders, products, and customer data from your Shopify store",
    lastSync: new Date(Date.now() - 180000),
    eventsToday: 4821,
  },
  {
    id: "int2",
    name: "Klaviyo",
    category: "email",
    status: "connected",
    icon: "K",
    description: "Trigger personalized recovery emails and SMS campaigns",
    lastSync: new Date(Date.now() - 300000),
    eventsToday: 1243,
  },
  {
    id: "int3",
    name: "Google Analytics 4",
    category: "analytics",
    status: "connected",
    icon: "G",
    description: "Send recovery events and conversion data to GA4",
    lastSync: new Date(Date.now() - 600000),
    eventsToday: 8924,
  },
  {
    id: "int4",
    name: "Stripe",
    category: "payment",
    status: "connected",
    icon: "ST",
    description: "Monitor payment failures and retry abandoned purchases",
    lastSync: new Date(Date.now() - 120000),
    eventsToday: 382,
  },
  {
    id: "int5",
    name: "HubSpot",
    category: "crm",
    status: "error",
    icon: "H",
    description: "Sync recovered customers to your HubSpot CRM",
    lastSync: new Date(Date.now() - 7200000),
    eventsToday: 0,
  },
  {
    id: "int6",
    name: "WooCommerce",
    category: "ecommerce",
    status: "disconnected",
    icon: "W",
    description: "Connect your WooCommerce store for order and cart tracking",
  },
  {
    id: "int7",
    name: "Mailchimp",
    category: "email",
    status: "disconnected",
    icon: "M",
    description: "Send recovery sequences through your Mailchimp account",
  },
  {
    id: "int8",
    name: "Segment",
    category: "analytics",
    status: "pending",
    icon: "SG",
    description: "Route CartRevive events through your Segment data pipeline",
    eventsToday: 0,
  },
];
