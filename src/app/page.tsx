import { redirect } from "next/navigation";
import { getCurrentUser, getActiveWorkspaceId } from "@/server/auth/session";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const workspaceId = await getActiveWorkspaceId(user.id);
  redirect(workspaceId ? "/dashboard" : "/onboarding");
}
