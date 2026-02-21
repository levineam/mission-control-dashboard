'use client';

import { Agentation } from 'agentation';

type AgentationOverlayProps = {
  enabled: boolean;
  endpoint?: string;
};

export function AgentationOverlay({ enabled, endpoint }: AgentationOverlayProps) {
  if (!enabled) {
    return null;
  }

  return <Agentation endpoint={endpoint} />;
}
