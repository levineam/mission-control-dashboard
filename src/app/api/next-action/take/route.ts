import { NextRequest, NextResponse } from 'next/server';
import { planNextActionTake, type NextActionTaskInput } from '@/lib/next-action';
import { sendMessageToMainSession } from '@/lib/openclaw-agents';

export const dynamic = 'force-dynamic';

interface TakeActionRequestBody {
  task?: Partial<NextActionTaskInput>;
}

function normalizeTaskPayload(task: Partial<NextActionTaskInput> | undefined): NextActionTaskInput | null {
  if (!task) return null;

  const id = typeof task.id === 'string' ? task.id.trim() : '';
  const text = typeof task.text === 'string' ? task.text.trim() : '';

  if (!id || !text) return null;

  return {
    id,
    text,
    source: typeof task.source === 'string' ? task.source.trim() : undefined,
    sourcePath: typeof task.sourcePath === 'string' ? task.sourcePath.trim() : undefined,
    linkedProject: typeof task.linkedProject === 'string' ? task.linkedProject.trim() : undefined,
    instructions: Array.isArray(task.instructions)
      ? task.instructions
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined,
    needsAndrew: Boolean(task.needsAndrew),
    priority: task.priority,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TakeActionRequestBody;
    const task = normalizeTaskPayload(body.task);

    if (!task) {
      return NextResponse.json(
        {
          ok: false,
          error: 'task.id and task.text are required.',
        },
        { status: 400 }
      );
    }

    const plan = planNextActionTake(task);
    const sendResult = await sendMessageToMainSession(plan.orchestrationMessage, {
      thinking: 'minimal',
      timeoutSeconds: 120,
      execTimeoutMs: 130_000,
      acceptTimeoutAsQueued: true,
    });

    return NextResponse.json({
      ok: true,
      startedAutonomous: plan.hasAutonomousSteps,
      autonomousSteps: plan.autonomousSteps,
      needsYouSteps: plan.needsYouSteps,
      userMessage: plan.userMessage,
      sessionId: sendResult.sessionId,
      reply: sendResult.reply,
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error running next action take flow:', error);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
