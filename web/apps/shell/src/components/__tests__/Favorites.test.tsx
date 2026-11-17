import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FavoritesSidebar, ObjectStarButton, StarButton, useFavorites, useFavoriteObjects } from "../Favorites";

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

describe("object favourites", () => {
  const dep = { cluster: "kind-a", slug: "deployments", ns: "shop", name: "api", kind: "Deployment" };

  it("stores {cluster, slug, ns, name} apart from route favourites and keeps both", () => {
    localStorage.setItem("kb.favorites", JSON.stringify(["/helm"]));
    const a = renderHook(() => useFavoriteObjects());
    const b = renderHook(() => useFavorites());
    act(() => a.result.current.toggle(dep));
    expect(a.result.current.has(dep)).toBe(true);
    expect(JSON.parse(localStorage.getItem("kb.favorites.objects")!)).toEqual([dep]);
    expect(b.result.current.favorites).toEqual(["/helm"]);
    act(() => a.result.current.toggle(dep));
    expect(a.result.current.objects).toEqual([]);
  });

  it("an object starred on one cluster is not starred on another", () => {
    const a = renderHook(() => useFavoriteObjects());
    act(() => a.result.current.toggle(dep));
    expect(a.result.current.has({ ...dep, cluster: "kind-b" })).toBe(false);
  });

  it("ObjectStarButton names the object and toggles", () => {
    render(<ObjectStarButton obj={dep} />);
    fireEvent.click(screen.getByRole("button", { name: "Add api to favorites" }));
    expect(screen.getByRole("button", { name: "Remove api from favorites" })).toBeTruthy();
  });

  it("survives corrupt stored data", () => {
    localStorage.setItem("kb.favorites.objects", "{nope");
    const a = renderHook(() => useFavoriteObjects());
    expect(a.result.current.objects).toEqual([]);
  });
});
