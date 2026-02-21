import { getDashboardData } from '@/lib/vault-parser';
import { DashboardContent } from './dashboard-content';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  const data = await getDashboardData();
  return <DashboardContent data={data} />;
}
