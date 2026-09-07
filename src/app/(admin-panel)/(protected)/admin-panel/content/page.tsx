import { redirect } from 'next/navigation';
import { adminContentAreaPath } from '@/lib/constant/paths';

// The content editor is organized by area under `[area]`; the bare base URL sends
// the admin to the first area (home), so the sidebar's «محتوای سایت» group and any
// old `/admin-panel/content` link both land on a real editor rather than a 404.
export default function AdminContentIndex() {
  redirect(adminContentAreaPath('home'));
}
