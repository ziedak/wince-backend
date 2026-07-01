
export function Toggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className={`relative inline-flex h-[18px] w-8 items-center rounded-full transition-all duration-200 ${active ? "bg-blue-500" : "bg-white/10"}`}>
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${active ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

