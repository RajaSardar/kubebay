import { PageHeader, Skeleton, SkeletonLines } from "@kubebay/ui";

/** Shown while a page's code loads: a header bar and content lines in the page's frame, instead of a blank page. */
export function PageSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <PageHeader title={<Skeleton w={160} h={14} />} />
      <SkeletonLines lines={8} label="Loading page…" />
    </div>
  );
}
