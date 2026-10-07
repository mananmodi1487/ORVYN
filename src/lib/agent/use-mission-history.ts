/**
 * Mission history state for the ORVYN Code workspace.
 *
 * A coding session can have more than one mission — the user starts a
 * task, it finishes, and they start another. This hook keeps the
 * missions that have run this session in memory so a future view can
 * show them, without the local agent being asked to persist anything.
 *
 * It deliberately does not render anything and does not build a
 * history UI: it is the state a future history view would read from.
 * Completed missions are capped so a long session cannot grow
 * without bound.
 */

import { useCallback, useMemo, useState } from "react";

/** A mission that has been started this session. */
export type MissionRecord = {
  readonly id: string;
  readonly prompt: string;
  readonly projectRoot: string | null;
  readonly startedAt: number;
  readonly status: "running" | "done" | "error" | "cancelled";
  readonly eventCount: number;
};

export type MissionHistory = {
  readonly missions: readonly MissionRecord[];
  readonly activeMissionId: string | null;
  readonly recordMission: (input: {
    readonly id: string;
    readonly prompt: string;
    readonly projectRoot: string | null;
  }) => string;
  /** Marks the active mission finished, by terminal status. */
  readonly finishMission: (
    id: string,
    status: MissionRecord["status"],
    eventCount: number,
  ) => void;
  readonly clear: () => void;
};

const MAX_HISTORY = 20;

/**
 * Keeps the missions started this session. The active mission is the
 * one still streaming; finished ones move to the history list, newest
 * first. A cap bounds the list so a long session cannot grow without
 * bound, dropping the oldest completed missions first.
 */
export function useMissionHistory(): MissionHistory {
  const [missions, setMissions] = useState<readonly MissionRecord[]>([]);
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);

  const recordMission = useCallback(
    (input: {
      readonly id: string;
      readonly prompt: string;
      readonly projectRoot: string | null;
    }): string => {
      const record: MissionRecord = {
        id: input.id,
        prompt: input.prompt,
        projectRoot: input.projectRoot,
        startedAt: Date.now(),
        status: "running",
        eventCount: 0,
      };
      setActiveMissionId(input.id);
      setMissions((previous) => [record, ...previous].slice(0, MAX_HISTORY));
      return input.id;
    },
    [],
  );

  const finishMission = useCallback(
    (
      id: string,
      status: MissionRecord["status"],
      eventCount: number,
    ) => {
      setActiveMissionId(null);
      setMissions((previous) =>
        previous.map((mission) =>
          mission.id === id
            ? { ...mission, status, eventCount }
            : mission,
        ),
      );
    },
    [],
  );

  const clear = useCallback(() => {
    setActiveMissionId(null);
    setMissions([]);
  }, []);

  return useMemo(
    () => ({ missions, activeMissionId, recordMission, finishMission, clear }),
    [missions, activeMissionId, recordMission, finishMission, clear],
  );
}