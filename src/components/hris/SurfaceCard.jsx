import { cn } from "@/lib/utils";

export default function SurfaceCard({ title, subtitle, className, children, action }) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.55)]",
        className,
      )}
    >
      {(title || subtitle || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="space-y-1">
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
