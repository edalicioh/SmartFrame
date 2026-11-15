import { describe, expect, it } from "vitest";
import {
  addPhotoSelection,
  movePhotoSelection,
  removePhotoSelection,
} from "../apps/web/src/lib/online-editor/photos";

describe("online editor photo selection", () => {
  it("keeps order/IDs unique and refuses duplicate selection", () => {
    expect(addPhotoSelection(["a"], "a")).toEqual({ ids: ["a"], reason: "duplicate" });
  });
  it("supports both reorder edges without changing the original", () => {
    const ids = ["a", "b", "c"];
    expect(movePhotoSelection(ids, 0, -1)).toBe(ids);
    expect(movePhotoSelection(ids, 2, 1)).toBe(ids);
    expect(movePhotoSelection(ids, 0, 1)).toEqual(["b", "a", "c"]);
    expect(ids).toEqual(["a", "b", "c"]);
  });
  it("removes only the requested draft ID and enforces unique/100 limits for upload", () => {
    expect(removePhotoSelection(["a", "b"], "a")).toEqual(["b"]);
    expect(
      addPhotoSelection(
        Array.from({ length: 100 }, (_, i) => String(i)),
        "next",
      ).reason,
    ).toBe("limit");
  });
});
