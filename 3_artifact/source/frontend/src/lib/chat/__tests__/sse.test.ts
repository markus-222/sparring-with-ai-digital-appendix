import { describe, expect, it } from "vitest";
import { createSseParser } from "@/lib/chat/sse";

function collect() {
  const frames: Array<[string, string]> = [];
  const parser = createSseParser((name, data) => frames.push([name, data]));
  return { frames, parser };
}

describe("createSseParser", () => {
  it("delivers one frame in one chunk", () => {
    const { frames, parser } = collect();
    parser.push('event: token\ndata: "a"\n\n');
    expect(frames).toEqual([["token", '"a"']]);
  });

  it("delivers a frame split across chunks at an arbitrary byte", () => {
    const { frames, parser } = collect();
    parser.push("event: tok");
    expect(frames).toEqual([]);
    parser.push('en\ndata: "a"\n\n');
    expect(frames).toEqual([["token", '"a"']]);
  });

  it("handles CRLF line endings", () => {
    const { frames, parser } = collect();
    parser.push('event: status\r\ndata: {"message":"x"}\r\n\r\n');
    expect(frames).toEqual([["status", '{"message":"x"}']]);
  });

  it("delivers two frames in one chunk in order", () => {
    const { frames, parser } = collect();
    parser.push('event: token\ndata: "a"\n\nevent: token\ndata: "b"\n\n');
    expect(frames).toEqual([
      ["token", '"a"'],
      ["token", '"b"'],
    ]);
  });

  it("joins multi-line data with a newline", () => {
    const { frames, parser } = collect();
    parser.push("event: message\ndata: line1\ndata: line2\n\n");
    expect(frames).toEqual([["message", "line1\nline2"]]);
  });

  it("delivers a trailing frame without the final blank line on flush", () => {
    const { frames, parser } = collect();
    parser.push('event: done\ndata: {"a":1}\n');
    expect(frames).toEqual([]);
    parser.flush();
    expect(frames).toEqual([["done", '{"a":1}']]);
  });

  it("ignores comment lines", () => {
    const { frames, parser } = collect();
    parser.push(': keep-alive\n\nevent: token\n: another\ndata: "a"\n\n');
    expect(frames).toEqual([["token", '"a"']]);
  });

  it("defaults the event name to message and strips one leading space only", () => {
    const { frames, parser } = collect();
    parser.push("data:  x\n\n");
    expect(frames).toEqual([["message", " x"]]);
  });

  it("flush with nothing buffered delivers nothing", () => {
    const { frames, parser } = collect();
    parser.flush();
    expect(frames).toEqual([]);
  });
});
