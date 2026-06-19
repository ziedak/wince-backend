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

// Generate mock visitors
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
    location: "San Francisco, CA"
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
    location: "Austin, TX"
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
    location: "Miami, FL"
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
    location: "Seattle, WA"
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
    location: "Boston, MA"
  }
];

// Generate mock customer events
export const generateCustomerEvents = (visitorId: string): CustomerEvent[] => {
  const events: CustomerEvent[] = [
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
  return events;
};

// Generate mock AI decisions
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
];

// Generate mock interventions
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

// Analytics data for charts
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
