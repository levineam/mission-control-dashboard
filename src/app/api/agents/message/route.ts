import { NextRequest, NextResponse } from 'next/server';
import { sendMessageToAgentSessionWithMirror } from '@/lib/openclaw-agents';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { sessionId?: string; message?: string };

    if (!body?.sessionId || !body?.message) {
      return NextResponse.json(
        { error: 'sessionId and message are required' },
        { status: 400 }
      );
    }

    const result = await sendMessageToAgentSessionWithMirror({
      sessionId: body.sessionId,
      message: body.message,
      actionLabel: 'message',
      options: {
        thinking: 'minimal',
        acceptTimeoutAsQueued: true,
      },
    });

    return NextResponse.json({
      ok: true,
      reply: result.reply,
      mirror: result.mirror,
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error sending message to agent session:', error);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
