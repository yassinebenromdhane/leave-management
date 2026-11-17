import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import i18n from "@/common/i18n";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});
