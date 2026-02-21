import { getDashboardData } from '@/lib/vault-parser';
import { ProjectBoardContent } from './project-board-content';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProjectBoardPage() {
  const data = await getDashboardData();
  return <ProjectBoardContent data={data} />;
}
