import { api } from "./client";

export interface Student {
  id: string;
  login: string;
  fullName: string;
  createdAt: string;
  attemptsCount: number; // all attempts, incl. unfinished — removed on delete
  finishedAttempts: number;
}

export interface StudentCredentials {
  login: string;
  fullName: string;
  password: string;
}

export interface CreatedStudent extends StudentCredentials {
  id: string;
  generated: boolean;
}

// Every response that reveals passwords also carries the ready-made
// credentials sheet, built (BOM, formula-safe escaping) by the server — the
// single writer of that format.
export interface CreatedStudentResponse extends CreatedStudent {
  credentialsCsv: string;
}

export interface ResetPasswordResponse extends StudentCredentials {
  id: string;
  credentialsCsv: string;
}

export interface CsvIssue {
  line: number;
  message: string;
}

export interface SkippedStudent {
  line: number;
  login: string;
  reason: string;
}

export interface ImportResult {
  created: CreatedStudent[];
  skipped: SkippedStudent[];
  issues: CsvIssue[]; // non-empty → nothing was created
  credentialsCsv: string | null; // null when nothing was created
}

export interface NewStudent {
  login: string;
  fullName: string;
  password: string | null; // null → generated on the server
}

export async function listStudents() {
  const { data } = await api.get<Student[]>("/students");
  return data;
}

export async function importStudents(csv: string) {
  const { data } = await api.post<ImportResult>("/students/import", { csv });
  return data;
}

export async function createStudent(student: NewStudent) {
  const { data } = await api.post<CreatedStudentResponse>("/students", student);
  return data;
}

export async function resetStudentPassword(id: string) {
  const { data } = await api.post<ResetPasswordResponse>(`/students/${id}/reset-password`);
  return data;
}

export async function renameStudent(id: string, fullName: string) {
  const { data } = await api.patch<Pick<Student, "id" | "login" | "fullName" | "createdAt">>(`/students/${id}`, {
    fullName,
  });
  return data;
}

export async function deleteStudent(id: string, withAttempts: boolean) {
  await api.delete(`/students/${id}`, { params: withAttempts ? { withAttempts: 1 } : {} });
}

export function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  // Deferred: revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
