import { useState, useCallback, useRef } from "react";
import type { AgentBridge } from "./bridge";
import type { AgentEvent, MissionHandle, MissionStatus } from "./protocol";

export interface UseAgentMissionResult {
  readonly status: MissionStatus;
  readonly events: readonly AgentEvent[];
  readonly error: string | null;
  readonly start: (prompt: string) => Promise<void>;
  readonly cancel: () => void;
  readonly reset: () => void;
}

export function useAgentMission(agent: AgentBridge): UseAgentMissionResult {
  const [status, setStatus] = useState<MissionStatus>("idle");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const missionRef = useRef<MissionHandle | null>(null);

  const start = useCallback(
    async (prompt: string) => {
      setError(null);
      setEvents([]);
      setStatus("starting");

      try {
        const handle = await agent.startMission({ prompt });
        missionRef.current = handle;
        setStatus("running");

        for await (const event of agent.streamMission(handle.id)) {
          setEvents((previous) => [...previous, event]);

          if (event.t === "done") {
            setStatus("done");
            break;
          }

          if (event.t === "error") {
            setStatus("error");
            setError(event.message);
            break;
          }
        }
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "unknown_error");
      }
    },
    [agent],
  );

  const cancel = useCallback(() => {
    if (missionRef.current) {
      missionRef.current.cancel();
      setStatus("idle");
    }
  }, []);

  const reset = useCallback(() => {
    missionRef.current = null;
    setStatus("idle");
    setEvents([]);
    setError(null);
  }, []);

  return { status, events, error, start, cancel, reset };
}
