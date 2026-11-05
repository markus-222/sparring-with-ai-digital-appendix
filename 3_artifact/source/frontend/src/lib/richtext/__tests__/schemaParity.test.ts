import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { buildExtensions } from "../extensions";
import { buildViewExtensions } from "../viewExtensions";

function schemaNames(extensions: ReturnType<typeof buildExtensions>) {
  const editor = new Editor({ extensions, editable: false });
  const names = {
    nodes: Object.keys(editor.schema.nodes).sort(),
    marks: Object.keys(editor.schema.marks).sort(),
  };
  editor.destroy();
  return names;
}

describe("schema parity", () => {
  it("the resolver's React-free schema has the same nodes and marks as the mounted view", () => {
    const resolver = schemaNames(buildExtensions());
    const view = schemaNames(buildViewExtensions(() => ({ documents: [], artifacts: [] })));
    expect(view).toEqual(resolver);
    expect(resolver.nodes).toEqual(expect.arrayContaining(["sourceReference", "marker", "table", "heading"]));
  });

  it("stays in sync when markers are disabled", () => {
    const resolver = schemaNames(buildExtensions({ markers: false }));
    const view = schemaNames(buildViewExtensions(() => ({ documents: [], artifacts: [] }), { markers: false }));
    expect(view).toEqual(resolver);
    expect(resolver.nodes).not.toContain("marker");
  });
});
