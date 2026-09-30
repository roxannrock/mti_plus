import { LoginPage as SharedLoginPage } from "@mti/shared";
import { useAuth } from "../context/AuthContext";
import { THEME_STORAGE_KEY } from "../hooks/useTheme";

export function LoginPage() {
  const auth = useAuth();
  return (
    <SharedLoginPage
      title="MTI+"
      subtitle="Вход для студентов"
      defaultRedirect="/tests"
      auth={auth}
      themeStorageKey={THEME_STORAGE_KEY}
    />
  );
}
