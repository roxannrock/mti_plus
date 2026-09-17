import { api } from "./client";
import type { AttemptHistoryItem, SubmitResult } from "../types";

export async function startAttempt(testId: string) {
  const { data } = await api.post<{ id: string }>("/attempts", { testId });
  return data;
}

export async function submitAttempt(attemptId: string, answers: { questionId: string; selectedKeys: string[] }[]) {
  const { data } = await api.post<SubmitResult>(`/attempts/${attemptId}/submit`, { answers });
  return data;
}

export async function listHistory() {
  const { data } = await api.get<AttemptHistoryItem[]>("/attempts");
  return data;
}
