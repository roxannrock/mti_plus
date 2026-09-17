import { api } from "./client";
import type { ParsePreviewResult, Participant, ParticipantDetail, TestDetail, TestSummary } from "../types";

export async function parsePreview(markdown: string) {
  const { data } = await api.post<ParsePreviewResult>("/tests/parse-preview", { markdown });
  return data;
}

export async function createTest(markdown: string) {
  const { data } = await api.post<TestDetail>("/tests", { markdown });
  return data;
}

export async function listTests() {
  const { data } = await api.get<TestSummary[]>("/tests");
  return data;
}

export async function getTest(id: string) {
  const { data } = await api.get<TestDetail>(`/tests/${id}`);
  return data;
}

export async function setPublished(id: string, isPublished: boolean) {
  const { data } = await api.patch<TestSummary>(`/tests/${id}/publish`, { isPublished });
  return data;
}

export async function getParticipants(testId: string) {
  const { data } = await api.get<Participant[]>(`/tests/${testId}/participants`);
  return data;
}

export async function getParticipantDetail(testId: string, attemptId: string) {
  const { data } = await api.get<ParticipantDetail>(`/tests/${testId}/participants/${attemptId}`);
  return data;
}
