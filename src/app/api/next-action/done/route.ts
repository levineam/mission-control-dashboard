import { NextRequest, NextResponse } from 'next/server';
import { markTaskDone } from '@/lib/task-done';
import type { NextActionTaskInput } from '@/lib/next-action';

export const dynamic = 'force-dynamic';

interface MarkDoneRequestBody {
  task?: Partial<NextActionTaskInput>;
}

function normalizeTaskPayload(task: Partial<NextActionTaskInput> | undefined): {
  text: string;
  sourcePath?: string;
} | null {
  if (!task) return null;

  const text = typeof task.text === 'string' ? task.text.trim() : '';
  if (!text) return null;

  return {
    text,
    sourcePath: typeof task.sourcePath === 'string' ? task.sourcePath.trim() : undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MarkDoneRequestBody;
    const task = normalizeTaskPayload(body.task);

    if (!task) {
      return NextResponse.json(
        {
          ok: false,
          error: 'task.text is required.',
        },
        { status: 400 }
      );
    }

    const result = await markTaskDone(task);

    if (!result.updated && !result.alreadyDone) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Could not find a matching task to mark done.',
        },
        { status: 404 }
      );
    }

    const message = result.alreadyDone
      ? 'Task is already marked done.'
      : 'Task marked done.';

    return NextResponse.json({
      ok: true,
      message,
      sourcePath: result.sourcePath,
      updated: result.updated,
      alreadyDone: result.alreadyDone,
      updatedCheckbox: result.updatedCheckbox,
      removedFromStatus: result.removedFromStatus,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error marking task done:', error);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
