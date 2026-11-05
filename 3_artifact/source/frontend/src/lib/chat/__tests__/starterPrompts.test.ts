import { describe, expect, it } from "vitest";
import {
  ALL_APPROVED_PROMPTS,
  INITIAL_PROMPTS,
  starterPromptsFor,
} from "@/lib/chat/starterPrompts";
import { makeArtifact } from "@/test/msw-server";
import type { ArtifactStatus } from "@/types";

function artifacts(s1: ArtifactStatus, s2: ArtifactStatus, s3: ArtifactStatus) {
  return [makeArtifact("01", { status: s1 }), makeArtifact("02", { status: s2 }), makeArtifact("03", { status: s3 })];
}

describe("starterPromptsFor", () => {
  it("returns the initial prompts when nothing is started", () => {
    expect(starterPromptsFor(artifacts("not_started", "not_started", "not_started"))).toEqual(INITIAL_PROMPTS);
  });

  it("treats missing artifacts as not started", () => {
    expect(starterPromptsFor([])).toEqual(INITIAL_PROMPTS);
  });

  it("offers a draft of the next slot when the previous one is approved", () => {
    const prompts = starterPromptsFor(artifacts("approved", "not_started", "not_started"));
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toBe("Erstelle einen Entwurf der Stakeholder-Analyse");
  });

  it("targets slot 03 when 01 and 02 are approved", () => {
    expect(starterPromptsFor(artifacts("approved", "approved", "not_started"))[0]).toBe(
      "Erstelle einen Entwurf der offenen Punkte",
    );
  });

  it("targets the first draft instead of a later slot", () => {
    const prompts = starterPromptsFor(artifacts("approved", "draft", "not_started"));
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toBe("Fasse den Entwurf der Stakeholder-Analyse zusammen");
    expect(prompts[1]).toBe("Welche Lücken hat der Entwurf der Stakeholder-Analyse?");
  });

  it("targets the first not-approved slot even if a later one is approved", () => {
    expect(starterPromptsFor(artifacts("draft", "not_started", "approved"))[0]).toBe(
      "Fasse den Entwurf der Projektbeschreibung zusammen",
    );
  });

  it("returns the all-approved prompts when every slot is approved", () => {
    expect(starterPromptsFor(artifacts("approved", "approved", "approved"))).toEqual(ALL_APPROVED_PROMPTS);
  });

  it("always yields exactly three unique prompts", () => {
    const states: ArtifactStatus[] = ["not_started", "draft", "approved"];
    for (const a of states) {
      for (const b of states) {
        for (const c of states) {
          const prompts = starterPromptsFor(artifacts(a, b, c));
          expect(prompts).toHaveLength(3);
          expect(new Set(prompts).size).toBe(3);
        }
      }
    }
  });
});
