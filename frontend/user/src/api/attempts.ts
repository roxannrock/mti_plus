import { api } from "./client";
import type {
  ActiveAttempt,
  AnswerMap,
  AttemptDetail,
  AttemptHistoryItem,
  AttemptStatus,
  StartedAttempt,
  SubmitResult,
} from "../types";

// Idempotent: returns the student's unfinished attempt for this test if there is one.
export async function startAttempt(testId: string) {
  const { data } = await api.post<StartedAttempt>("/attempts", { testId });
  return data;
}

// The status call has a side effect: it closes a timed-out attempt and reports
// its id only in that one response. StrictMode's double effect (or any double
// mount) would otherwise send two requests and discard the one with the id,
// so concurrent callers share a single request.
const statusInFlight = new Map<string, Promise<AttemptStatus>>();

/** Start-screen info for one test; never creates an attempt. */
export function getAttemptStatus(testId: string) {
  let request = statusInFlight.get(testId);
  if (!request) {
    request = api
      .get<AttemptStatus>("/attempts/status", { params: { testId } })
      .then((res) => res.data)
      .finally(() => statusInFlight.delete(testId));
    statusInFlight.set(testId, request);
  }
  return request;
}

export async function listActiveAttempts() {
  const { data } = await api.get<ActiveAttempt[]>("/attempts/active");
  return data;
}

export async function saveDraft(attemptId: string, answers: AnswerMap) {
  await api.put(`/attempts/${attemptId}/draft`, { answers });
}

export async function submitAttempt(attemptId: string, answers: { questionId: string; selectedKeys: string[] }[]) {
  const { data } = await api.post<SubmitResult>(`/attempts/${attemptId}/submit`, { answers });
  return data;
}

export async function getAttempt(attemptId: string) {
  const { data } = await api.get<AttemptDetail>(`/attempts/${attemptId}`);
  return data;
}

export async function listHistory() {
  const { data } = await api.get<AttemptHistoryItem[]>("/attempts");
  return data;
}
