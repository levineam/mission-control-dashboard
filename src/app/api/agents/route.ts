import { NextResponse } from 'next/server';
import { getAgentsSnapshot } from '@/lib/openclaw-agents';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function GET() {
  try {
    const data = await getAgentsSnapshot();
    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('Error loading agents snapshot:', error);
    return NextResponse.json(
      {
        error: 'Failed to load agents snapshot',
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
