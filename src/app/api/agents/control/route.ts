import { NextRequest, NextResponse } from 'next/server';
import {
  runAgentControl,
  type AgentControlAction,
  type AgentControlTemplateId,
} from '@/lib/openclaw-agents';

export const dynamic = 'force-dynamic';

const ALLOWED_ACTIONS = new Set<AgentControlAction>(['nudge', 'stop', 'spawnTemplate']);
const ALLOWED_TEMPLATES = new Set<AgentControlTemplateId>([
  'research-brief',
  'bug-triage',
  'build-feature',
]);

interface ControlRequestBody {
  action?: string;
  sessionId?: string;
  templateId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ControlRequestBody;

    const action = body.action?.trim() as AgentControlAction | undefined;
    const sessionId = body.sessionId?.trim();
    const templateId = body.templateId?.trim() as AgentControlTemplateId | undefined;

    if (!action || !ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Invalid action. Allowed actions: nudge, stop, spawnTemplate.',
        },
        { status: 400 }
      );
    }

    if (!sessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'sessionId is required.',
        },
        { status: 400 }
      );
    }

    if (action === 'spawnTemplate') {
      if (!templateId || !ALLOWED_TEMPLATES.has(templateId)) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Invalid templateId. Allowed templates: research-brief, bug-triage, build-feature.',
          },
          { status: 400 }
        );
      }
    }

    const result = await runAgentControl({
      action,
      sessionId,
      templateId,
    });

    return NextResponse.json({
      ok: true,
      action: result.action,
      message: 'Control executed',
      reply: result.reply,
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error running agent control:', error);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
