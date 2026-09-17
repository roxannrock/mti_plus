import { api } from "./client";
import type { TestDetail, TestSummary } from "../types";

export async function listTests() {
  const { data } = await api.get<TestSummary[]>("/tests");
  return data;
}

export async function getTest(id: string) {
  const { data } = await api.get<TestDetail>(`/tests/${id}`);
  return data;
}
