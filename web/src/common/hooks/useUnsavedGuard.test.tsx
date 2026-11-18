// verify-spec item 6: the browser Back button must not silently drop unsaved changes.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";
import { useUnsavedGuard } from "./useUnsavedGuard";

function Form() {
  const [text, setText] = useState("");
  const guard = useUnsavedGuard(text !== "");
  const navigate = useNavigate();
  return (
    <div>
      <input aria-label="note" value={text} onChange={(e) => setText(e.target.value)} />
      <button
        type="button"
        onClick={() => {
          guard.allowLeave();
          navigate(-1);
        }}
      >
        save
      </button>
      {guard.blocked ? (
        <div role="dialog">
          <button type="button" onClick={guard.stay}>
            keep editing
          </button>
          <button type="button" onClick={guard.proceed}>
            discard
          </button>
        </div>
      ) : null}
    </div>
  );
}

function setup() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <p>workspace</p> },
      { path: "/leave/new", element: <Form /> },
    ],
    { initialEntries: ["/", "/leave/new"], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const back = (router: ReturnType<typeof setup>) => act(() => router.navigate(-1));

describe("useUnsavedGuard", () => {
  it("Back with nothing typed leaves at once", async () => {
    const router = setup();
    await back(router);
    expect(router.state.location.pathname).toBe("/");
  });

  it("Back with unsaved changes holds the navigation; 'keep editing' stays with the text intact", async () => {
    const router = setup();
    fireEvent.change(screen.getByLabelText("note"), { target: { value: "half day" } });
    await back(router);
    expect(router.state.location.pathname).toBe("/leave/new");
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByText("keep editing"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByLabelText("note") as HTMLInputElement).value).toBe("half day");
  });

  it("'discard' lets the held Back go through", async () => {
    const router = setup();
    fireEvent.change(screen.getByLabelText("note"), { target: { value: "half day" } });
    await back(router);
    await act(async () => fireEvent.click(screen.getByText("discard")));
    expect(router.state.location.pathname).toBe("/");
  });

  it("an intentional exit (save) is never blocked", async () => {
    const router = setup();
    fireEvent.change(screen.getByLabelText("note"), { target: { value: "half day" } });
    await act(async () => fireEvent.click(screen.getByText("save")));
    expect(router.state.location.pathname).toBe("/");
  });
});
