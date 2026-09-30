import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { TestsListPage } from "./pages/TestsListPage";
import { UploadTestPage } from "./pages/UploadTestPage";
import { TestParticipantsPage } from "./pages/TestParticipantsPage";
import { ParticipantDetailPage } from "./pages/ParticipantDetailPage";
import { TestDetailPage } from "./pages/TestDetailPage";
import { StudentsPage } from "./pages/StudentsPage";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/tests" element={<TestsListPage />} />
          <Route path="/upload" element={<UploadTestPage />} />
          <Route path="/tests/:testId" element={<TestDetailPage />} />
          <Route path="/tests/:testId/participants" element={<TestParticipantsPage />} />
          <Route path="/tests/:testId/participants/:attemptId" element={<ParticipantDetailPage />} />
          <Route path="/students" element={<StudentsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/tests" replace />} />
      </Routes>
    </AuthProvider>
  );
}
