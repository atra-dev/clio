import Link from "next/link";
import { cn } from "@/lib/utils";

export default function BrandMark({ href = "/", compact = false, iconOnly = false }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-3 text-slate-900 transition-opacity hover:opacity-85",
        compact ? "text-sm" : "text-base",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-xl bg-slate-900 text-white",
          compact ? "h-8 w-8 text-sm font-semibold" : "h-10 w-10 text-base font-bold",
        )}
        aria-hidden="true"
      >
        C
      </span>
      {!iconOnly ? (
        <span className="leading-tight">
          <strong className="block text-[15px] font-semibold tracking-[0.28em] text-slate-900">
            CLIO
          </strong>
          <span className="text-xs text-slate-500">Corporate Workforce Portal</span>
        </span>
      ) : null}
    </Link>
  );
}
