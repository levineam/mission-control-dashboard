import { getDashboardData } from '@/lib/vault-parser';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function GET() {
  try {
    const data = await getDashboardData();
    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
