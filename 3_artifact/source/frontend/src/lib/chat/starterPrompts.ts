import { SLOT_ORDER, artifactForSlot } from "@/lib/artifacts";
import type { Artifact, ArtifactStatus, Slot } from "@/types";

/** Genitive-ready names ("der ..."), matching the fixed greeting texts. */
const SLOT_NAMES: Record<Slot, string> = {
  "01": "Projektbeschreibung",
  "02": "Stakeholder-Analyse",
  "03": "offenen Punkte",
};

export const INITIAL_PROMPTS = [
  "Worum geht es in diesem Projekt?",
  "Welche Artefakte erstellen wir?",
  "Erstelle einen Entwurf der Projektbeschreibung",
] as const;

export const ALL_APPROVED_PROMPTS = [
  "Welche Fragen sind für den Workshop noch offen?",
  "Welche Dokumente sollten wir vorab anfordern?",
  "Fasse die drei Artefakte zusammen",
] as const;

/** Three starter prompts for a fresh chat, derived from the artifact state. */
export function starterPromptsFor(artifacts: Artifact[]): readonly string[] {
  const statuses = SLOT_ORDER.map(
    (slot): [Slot, ArtifactStatus] => [slot, artifactForSlot(artifacts, slot)?.status ?? "not_started"],
  );
  if (statuses.every(([, status]) => status === "not_started")) return INITIAL_PROMPTS;
  const next = statuses.find(([, status]) => status !== "approved");
  if (!next) return ALL_APPROVED_PROMPTS;
  const [slot, status] = next;
  const name = SLOT_NAMES[slot];
  if (status === "draft") {
    return [
      `Fasse den Entwurf der ${name} zusammen`,
      `Welche Lücken hat der Entwurf der ${name}?`,
      "Welche Artefakte fehlen noch?",
    ];
  }
  return [`Erstelle einen Entwurf der ${name}`, "Welche Artefakte fehlen noch?", "Worum geht es in diesem Projekt?"];
}
