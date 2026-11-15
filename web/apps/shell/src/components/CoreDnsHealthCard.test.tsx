import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoreDnsHealthCard } from "./CoreDnsHealthCard";

describe("CoreDnsHealthCard", () => {
  it("says so when no CoreDNS or kube-dns deployment is visible", () => {
    render(<CoreDnsHealthCard report={{ present: false, corefileChecked: false, findings: [] }} />);
    expect(screen.getByText(/no coredns or kube-dns deployment found in kube-system/i)).toBeTruthy();
  });

  it("shows an all-clear when CoreDNS is healthy", () => {
    render(<CoreDnsHealthCard report={{ present: true, corefileChecked: true, findings: [] }} />);
    expect(screen.getByText(/cluster dns looks healthy/i)).toBeTruthy();
  });

  it("notes when the Corefile could not be checked", () => {
    render(<CoreDnsHealthCard report={{ present: true, corefileChecked: false, findings: [] }} />);
    expect(screen.getByText(/corefile not checked/i)).toBeTruthy();
  });

  it("lists each finding's detail", () => {
    render(
      <CoreDnsHealthCard
        report={{
          present: true,
          corefileChecked: true,
          findings: [
            { kind: "single-replica", detail: "1 replica — every DNS lookup in the cluster depends on one pod." },
            { kind: "corefile-missing-loop", detail: "Corefile has no `loop`." },
          ],
        }}
      />,
    );
    expect(screen.getByText(/depends on one pod/)).toBeTruthy();
    expect(screen.getByText(/Corefile has no/)).toBeTruthy();
  });
});
