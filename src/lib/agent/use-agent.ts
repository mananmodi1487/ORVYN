import { useState, useEffect, useMemo } from "react";
import { AgentBridge } from "./bridge";

export interface UseAgentResult {
  readonly agent: AgentBridge;
  readonly status: "checking" | "available" | "unavailable";
  readonly connected: boolean;
}

export function useAgent(port?: number): UseAgentResult {
  const [status, setStatus] = useState<"checking" | "available" | "unavailable">("checking");
  const [connected, setConnected] = useState(false);

  const agent = useMemo(() => new AgentBridge(port), [port]);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      try {
        await agent.connect();
        if (!cancelled) {
          setConnected(true);
          setStatus("available");
        }
      } catch {
        if (!cancelled) {
          setConnected(false);
          setStatus("unavailable");
        }
      }
    }

    detect();

    return () => {
      cancelled = true;
      agent.disconnect();
      setConnected(false);
    };
  }, [agent]);

  return { agent, status, connected };
}
