import { listRoles, getPermissionCatalog } from "@/lib/actions/roles";
import { RoleManager } from "@/components/modules/RoleManager";

export default async function RolesPage() {
  const [roles, catalog] = await Promise.all([listRoles(), getPermissionCatalog()]);
  return <RoleManager roles={roles} catalog={catalog} />;
}
