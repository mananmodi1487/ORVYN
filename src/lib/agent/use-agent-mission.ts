import { useState, useCallback, useRef } from "react";
import type { AgentBridge } from "./bridge";
import type {
  AgentEvent,
  MissionHandle,
  MissionRequest,
  MissionStatus,
} from "./protocol";

export interface UseAgentMissionResult {
  readonly status: MissionStatus;
  readonly events: readonly AgentEvent[];
  readonly error: string | null;
  readonly activeMissionId: string | null;
  readonly start: (prompt: string, projectRoot?: string) => Promise<void>;
  readonly cancel: () => void;
  readonly reset: () => void;
}

export function useAgentMission(agent: AgentBridge): UseAgentMissionResult {
  const [status, setStatus] = useState<MissionStatus>("idle");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const missionRef = useRef<MissionHandle | null>(null);
  // Set when a cancellation is requested. Cancelling aborts
  // the stream, which closes without a terminal event, so
  // the end of the stream is what returns the mission to
  // idle — through the visible "cancelling" state.
  const cancellingRef = useRef(false);

  const start = useCallback(
    async (prompt: string, projectRoot?: string) => {
      setError(null);
      setEvents([]);
      setStatus("starting");
      cancellingRef.current = false;

      try {
        const request: MissionRequest = projectRoot === undefined
          ? { prompt }
          : { prompt, projectRoot };
        const handle = await agent.startMission(request);
        missionRef.current = handle;
        setActiveMissionId(handle.id);
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

        // A cancelled stream ends without done or error;
        // the mission is over, so return to idle.
        if (cancellingRef.current) {
          cancellingRef.current = false;
          setStatus("idle");
        }
      } catch (err) {
        // The abort surfaces as an error on some transports;
        // a cancellation is not a mission failure.
        if (cancellingRef.current) {
          cancellingRef.current = false;
          setStatus("idle");
        } else {
          setStatus("error");
          setError(err instanceof Error ? err.message : "unknown_error");
        }
      } finally {
        missionRef.current = null;
        setActiveMissionId(null);
      }
    },
    [agent],
  );

  const cancel = useCallback(() => {
    if (!missionRef.current) return;

    cancellingRef.current = true;
    setStatus("cancelling");
    missionRef.current.cancel();
  }, []);

  const reset = useCallback(() => {
    missionRef.current = null;
    cancellingRef.current = false;
    setActiveMissionId(null);
    setStatus("idle");
    setEvents([]);
    setError(null);
  }, []);

  return { status, events, error, activeMissionId, start, cancel, reset };
}
