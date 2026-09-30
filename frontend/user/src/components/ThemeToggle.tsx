import { ThemeToggle as SharedThemeToggle } from "@mti/shared";
import { THEME_STORAGE_KEY } from "../hooks/useTheme";

export function ThemeToggle() {
  return <SharedThemeToggle storageKey={THEME_STORAGE_KEY} />;
}
