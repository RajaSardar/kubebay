import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FavoritesSidebar, StarButton, useFavorites } from "../Favorites";

beforeEach(() => localStorage.clear());

describe("useFavorites", () => {
  it("keeps two mounted instances in sync (a star toggle shows up in the sidebar at once)", () => {
    const a = renderHook(() => useFavorites());
    const b = renderHook(() => useFavorites());
    act(() => a.result.current.toggle("/r/pods"));
    expect(b.result.current.favorites).toEqual(["/r/pods"]);
    act(() => b.result.current.remove("/r/pods"));
    expect(a.result.current.favorites).toEqual([]);
  });
});

describe("StarButton", () => {
  it("names the thing it stars and toggles", () => {
    render(<StarButton path="/crds?group=argoproj.io" name="argoproj.io" />);
    fireEvent.click(screen.getByRole("button", { name: "Add argoproj.io to favorites" }));
    expect(JSON.parse(localStorage.getItem("kb.favorites")!)).toEqual(["/crds?group=argoproj.io"]);
    expect(screen.getByRole("button", { name: "Remove argoproj.io from favorites" })).toBeTruthy();
  });
});

describe("FavoritesSidebar labels", () => {
  it("labels a CRD by its plural and a CRD group by its name", () => {
    render(
      <MemoryRouter>
        <FavoritesSidebar
          favorites={["/r/ext--argoproj.io--v1alpha1--applications?scoped=1", "/crds?group=argoproj.io"]}
          onRemove={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("applications")).toBeTruthy();
    expect(screen.getByText("argoproj.io")).toBeTruthy();
  });
});
