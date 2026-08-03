import { listCategoryTree } from "@/lib/actions/categories";
import { CategoryManager } from "@/components/modules/CategoryManager";

export default async function CategoriesPage() {
  const roots = await listCategoryTree();
  return <CategoryManager roots={roots} />;
}
