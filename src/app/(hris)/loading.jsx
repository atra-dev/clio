import {
  CardSkeleton,
  ChartSkeleton,
  TableSkeleton,
  TabsSkeleton,
} from "@/components/hris/shared/Skeletons";

export default function WorkspaceLoading() {
  return (
    <div className="min-h-screen bg-slate-100/60 px-5 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <TabsSkeleton count={6} />
        <CardSkeleton count={4} />
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartSkeleton type="bar" />
          <ChartSkeleton type="pie" />
        </div>
        <TableSkeleton rows={7} columns={6} />
      </div>
    </div>
  );
}
