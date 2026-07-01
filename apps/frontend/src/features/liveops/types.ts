// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign { id: string; name: string; active: boolean; trend: number | null }

interface AnomalyItem { time: string; event: string; status: "active" | "monitoring" | "resolved" }

interface ApprovalSubItem { sid: string; visitor: string; cart: number; stage: string; device: "mobile" | "desktop" }

interface PendingApproval {
  id: string; title: string; batchCount: number; cost: number; est: number;
  extra?: string; description: string; items: ApprovalSubItem[];
}

interface ExceptionItem { id: string; level: "vip" | "high"; label: string; cart: number; confidence: number; reason: string }
interface DrawerSession { id: string; name: string; cart: number; risk: number; device: "mobile" | "desktop"; stage: string }
