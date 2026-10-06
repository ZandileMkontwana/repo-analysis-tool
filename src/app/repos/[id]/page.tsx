import { Suspense } from "react";
import { RepoDashboard } from "@/components/repo-dashboard";
import { Loading } from "@/components/ui";

export default async function RepositoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <RepoDashboard key={id} id={id} />
    </Suspense>
  );
}
