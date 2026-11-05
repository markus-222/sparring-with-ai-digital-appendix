import "@testing-library/jest-dom";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./msw-server";

// jsdom doesn't implement scroll APIs
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.scrollTo = vi.fn();

// jsdom has no layout. ProseMirror (Tiptap) reads Range rects (coordsAtPos, scrollIntoView) and
// hit-tests with elementFromPoint, so without these stubs it throws or logs inside jsdom. They
// report "no layout" (empty rects, no element). Plain functions, not vi.fn(), so vi.restoreAllMocks()
// in a test cannot remove them; tests that need real numbers spy on Element.prototype or the view.
function emptyRectList(): DOMRectList {
  const list: DOMRect[] & { item?: (index: number) => DOMRect | null } = [];
  list.item = (index: number) => list[index] ?? null;
  return list as unknown as DOMRectList;
}
Range.prototype.getClientRects = emptyRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
document.elementFromPoint = () => null;
document.elementsFromPoint = () => [];

// Next.js App Router hooks require a router context to be mounted; tests
// render components/hooks in isolation without one, so we stub the module
// globally. Components under test only rely on push()/replace() being
// callable (e.g. redirect-on-401), not on real navigation state.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
