import { redirect } from "next/navigation";

// /sales is the new-sale form now, so this route is the same page under an older
// name. Kept as a redirect rather than deleted — it's linked from bookmarks and
// from anywhere "+ New Sale" was written down.
export default function Page() {
  redirect("/sales");
}
