import { redirect } from "next/navigation";

export default function TeamAdminRedirectPage() {
  redirect("/admin?section=team");
}
