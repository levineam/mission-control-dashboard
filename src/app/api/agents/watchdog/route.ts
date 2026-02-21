import { NextRequest, NextResponse } from 'next/server';
import { runStalledRunWatchdog } from '@/lib/openclaw-agents';

export const dynamic = 'force-dynamic';

function parseBooleanFlag(value: string | null | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const dryRun = parseBooleanFlag(url.searchParams.get('dryRun'));
    const force = parseBooleanFlag(url.searchParams.get('force'));

    const result = await runStalledRunWatchdog({ dryRun, force });

    return NextResponse.json({
      ok: true,
      ...result,
      dryRun,
      force,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown watchdog error';
    console.error('Error running stalled-run watchdog:', error);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { dryRun?: boolean; force?: boolean };

    const result = await runStalledRunWatchdog({
      dryRun: Boolean(body?.dryRun),
      force: Boolean(body?.force),
    });

    return NextResponse.json({
      ok: true,
      ...result,
      dryRun: Boolean(body?.dryRun),
      force: Boolean(body?.force),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown watchdog error';
    console.error('Error running stalled-run watchdog:', error);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
