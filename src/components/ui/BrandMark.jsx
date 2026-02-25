import { cn } from "@/lib/utils";

export default function BrandMark({ href = "/", compact = false, iconOnly = false }) {
  const logoHeight = iconOnly ? "h-9" : "h-full";
  const logoWidth = iconOnly ? "w-9" : "w-full";
  return (
    <div
      className={cn(
        "inline-flex items-center text-slate-900",
        !iconOnly && "flex-1 min-w-0 h-full",
        compact ? "text-sm" : "text-base",
      )}
    >
      <img
        src="/logo/atralogo.png"
        alt="ATR & Associates"
        className={cn("h-full w-full bg-black object-contain object-left-top", logoHeight, logoWidth)}
      />
      {null}
    </div>
  );
}
