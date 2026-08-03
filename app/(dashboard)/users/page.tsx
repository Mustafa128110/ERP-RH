import { listUsers } from "@/lib/actions/users";
import { getCompanies, getRoles } from "@/lib/queries/lookups";
import { UserManager } from "@/components/modules/UserManager";

export default async function UsersPage() {
  const [users, roleRows, companyRows] = await Promise.all([listUsers(), getRoles(), getCompanies()]);

  return <UserManager users={users} roleOptions={roleRows} companyOptions={companyRows} />;
}
