import { describe, expect, it } from "vitest";
import { spreadGutterIcons } from "@/lib/gutterLayout";

describe("spreadGutterIcons", () => {
  it("returns an empty list for no icons", () => {
    expect(spreadGutterIcons([], 20)).toEqual([]);
  });

  it("keeps icons that are far enough apart where they are", () => {
    const items = [
      { id: "a", top: 10 },
      { id: "b", top: 60 },
    ];
    expect(spreadGutterIcons(items, 20)).toEqual(items);
  });

  it("sorts by top", () => {
    const result = spreadGutterIcons(
      [
        { id: "b", top: 100 },
        { id: "a", top: 10 },
      ],
      20,
    );
    expect(result.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("pushes an icon down to the minimum spacing", () => {
    const result = spreadGutterIcons(
      [
        { id: "a", top: 10 },
        { id: "b", top: 15 },
      ],
      20,
    );
    expect(result).toEqual([
      { id: "a", top: 10 },
      { id: "b", top: 30 },
    ]);
  });

  it("cascades through a cluster and keeps input order for equal tops", () => {
    const result = spreadGutterIcons(
      [
        { id: "a", top: 50 },
        { id: "b", top: 50 },
        { id: "c", top: 55 },
        { id: "d", top: 200 },
      ],
      20,
    );
    expect(result).toEqual([
      { id: "a", top: 50 },
      { id: "b", top: 70 },
      { id: "c", top: 90 },
      { id: "d", top: 200 },
    ]);
  });

  it("allows an exact spacing and does not mutate its input", () => {
    const items = [
      { id: "b", top: 30 },
      { id: "a", top: 10 },
    ];
    const copy = items.map((i) => ({ ...i }));
    expect(spreadGutterIcons(items, 20).map((i) => i.top)).toEqual([10, 30]);
    expect(items).toEqual(copy);
  });
});
