import { Scan } from "lucide-react";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <span className={`brand${light ? " brand-light" : ""}`}>
      <span className="brand-mark">
        <Scan size={22} strokeWidth={1.8} />
      </span>
      <span>
        smart<span className="brand-weight">frame</span>
        <span className="brand-dot">.</span>
      </span>
    </span>
  );
}
