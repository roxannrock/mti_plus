import { api } from "./client";
import type {
  ParsePreviewResult,
  Participant,
  ParticipantDetail,
  Question,
  QuestionUpdate,
  TestDetail,
  TestSettings,
  TestSummary,
} from "../types";

export interface TestUpload {
  csv: string;
  title: string;
  description: string | null;
  passPercent: number;
}

export async function parsePreview(upload: TestUpload) {
  const { data } = await api.post<ParsePreviewResult>("/tests/parse-preview", upload);
  return data;
}

export async function createTest(upload: TestUpload) {
  const { data } = await api.post<TestDetail>("/tests", upload);
  return data;
}

export async function listTests(archived = false) {
  const { data } = await api.get<TestSummary[]>("/tests", { params: archived ? { archived: true } : {} });
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

export async function updateTestSettings(id: string, settings: TestSettings) {
  const { data } = await api.patch<TestSummary>(`/tests/${id}`, settings);
  return data;
}

// Tests without attempts are deleted; tests with attempts are archived instead.
export async function deleteTest(id: string) {
  const { data } = await api.delete<{ deleted: boolean; archived: boolean }>(`/tests/${id}`);
  return data;
}

export async function restoreTest(id: string) {
  const { data } = await api.patch<TestSummary>(`/tests/${id}/restore`);
  return data;
}

export async function updateQuestion(testId: string, questionId: string, update: QuestionUpdate) {
  const { data } = await api.put<Question>(`/tests/${testId}/questions/${questionId}`, update);
  return data;
}

// The endpoint needs the auth header, so a plain <a href> won't do: fetch the
// file as a blob and hand it to the browser as a download.
// Content-Disposition isn't readable cross-origin unless CORS exposes it, so
// fall back to a name built from the title.
export async function downloadTestSource(id: string, title: string) {
  const res = await api.get<Blob>(`/tests/${id}/source`, { responseType: "blob" });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const ext = res.data.type.startsWith("text/markdown") ? "md" : "csv";
  const filename = encoded
    ? decodeURIComponent(encoded)
    : `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "test"}.${ext}`;
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function getParticipants(testId: string) {
  const { data } = await api.get<Participant[]>(`/tests/${testId}/participants`);
  return data;
}

export async function getParticipantDetail(testId: string, attemptId: string) {
  const { data } = await api.get<ParticipantDetail>(`/tests/${testId}/participants/${attemptId}`);
  return data;
}
