import { getDashboardData } from '@/lib/vault-parser';
import { StatusContent } from './status-content';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function StatusPage() {
  const data = await getDashboardData();
  return <StatusContent data={data} />;
}
