import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { shortcutId, useShortcuts, type ShortcutMap } from "./useShortcuts";

function Harness({ map }: { map: ShortcutMap }) {
  useShortcuts(map);
  return (
    <div>
      <input aria-label="text" />
      <textarea aria-label="area" />
      <select aria-label="pick">
        <option>a</option>
      </select>
      <div aria-label="editable" contentEditable="true" tabIndex={0} />
      <input aria-label="check" type="checkbox" />
      <button type="button">btn</button>
    </div>
  );
}

const setup = () => {
  const c = vi.fn();
  const save = vi.fn();
  const savePending = vi.fn();
  const help = vi.fn();
  const one = vi.fn();
  render(<Harness map={{ c, "mod+enter": save, "mod+shift+enter": savePending, "?": help, "1": one }} />);
  return { c, save, savePending, help, one };
};

describe("shortcut gating", () => {
  it("fires single-letter shortcuts when nothing is being typed", () => {
    const { c, one, help } = setup();
    fireEvent.keyDown(document.body, { key: "c" });
    fireEvent.keyDown(screen.getByRole("button"), { key: "1" });
    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    expect(c).toHaveBeenCalledTimes(1);
    expect(one).toHaveBeenCalledTimes(1);
    expect(help).toHaveBeenCalledTimes(1);
  });

  it("is inert in text inputs, textareas, selects and contenteditable", () => {
    const { c, one, help } = setup();
    for (const el of [screen.getByLabelText("text"), screen.getByLabelText("area"), screen.getByLabelText("pick"), screen.getByLabelText("editable")]) {
      fireEvent.keyDown(el, { key: "c" });
      fireEvent.keyDown(el, { key: "1" });
      fireEvent.keyDown(el, { key: "?", shiftKey: true });
    }
    expect(c).not.toHaveBeenCalled();
    expect(one).not.toHaveBeenCalled();
    expect(help).not.toHaveBeenCalled();
  });

  it("still fires in a checkbox (not a text field)", () => {
    const { c } = setup();
    fireEvent.keyDown(screen.getByLabelText("check"), { key: "c" });
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Enter and Shift+Ctrl+Enter work while typing", () => {
    const { save, savePending } = setup();
    const input = screen.getByLabelText("text");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, shiftKey: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(savePending).toHaveBeenCalledTimes(1);
  });

  it("builds canonical ids", () => {
    expect(shortcutId({ key: "Enter", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe("mod+shift+enter");
    expect(shortcutId({ key: "C", ctrlKey: false, metaKey: false, altKey: false, shiftKey: true })).toBe("c");
    expect(shortcutId({ key: "Escape", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe("escape");
  });
});
