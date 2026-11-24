import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TokenGate } from "../TokenGate";

let mode = "proxy";
let identity: { user: string } | null = { user: "alice@example.com" };

vi.mock("../../lib/api", () => ({
  authMode: vi.fn(async () => mode),
  proxyIdentity: vi.fn(async () => identity),
  checkToken: vi.fn(),
  PROXY_REFUSED_MESSAGE: "Your auth proxy did not authenticate this request. Ask your administrator.",
  getToken: () => "",
  setToken: vi.fn(),
}));

beforeEach(() => {
  mode = "proxy";
  identity = { user: "alice@example.com" };
});

describe("TokenGate behind an auth proxy", () => {
  it("shows the app, with no token prompt or sign-in, when the proxy identified the user", async () => {
    render(<TokenGate><p>the app</p></TokenGate>);
    await waitFor(() => expect(screen.getByText("the app")).toBeInTheDocument());
    expect(screen.queryByLabelText("session token")).toBeNull();
  });

  it("tells the user their proxy did not authenticate the request, instead of asking for a token", async () => {
    identity = null;
    render(<TokenGate><p>the app</p></TokenGate>);
    await waitFor(() => expect(screen.getByText(/your auth proxy did not authenticate this request/i)).toBeInTheDocument());
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.queryByLabelText("session token")).toBeNull();
  });
});
