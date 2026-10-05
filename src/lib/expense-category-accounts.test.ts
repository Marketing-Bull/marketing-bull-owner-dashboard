import { describe, expect, it } from "vitest";
import { accountCodeAfterCategoryChange, accountCodeForCategory, initialAccountCode } from "@/lib/expense-category-accounts";

const map = { Software: "6190", Travel: "6400", "Meals & Entertainment": "6300" };

describe("expense category → account code", () => {
  it("looks up mapped codes case-insensitively", () => {
    expect(accountCodeForCategory(map, "Software")).toBe("6190");
    expect(accountCodeForCategory(map, "software")).toBe("6190");
    expect(accountCodeForCategory(map, " meals & entertainment ")).toBe("6300");
    expect(accountCodeForCategory(map, "Office")).toBe("");
    expect(accountCodeForCategory(map, "")).toBe("");
    expect(accountCodeForCategory(null, "Software")).toBe("");
  });

  it("sets the mapped code when the category changes", () => {
    expect(accountCodeAfterCategoryChange(map, "Software", "Travel", "6190")).toBe("6400");
    expect(accountCodeAfterCategoryChange(map, "Office", "Software", "")).toBe("6190");
    // A mapped category replaces a manual override too — the user picked a new category.
    expect(accountCodeAfterCategoryChange(map, "Software", "Travel", "9999")).toBe("6400");
  });

  it("clears the old mapped code when moving to an unmapped category", () => {
    expect(accountCodeAfterCategoryChange(map, "Software", "Office", "6190")).toBe("");
  });

  it("keeps a manual override when moving to an unmapped category", () => {
    expect(accountCodeAfterCategoryChange(map, "Software", "Office", "9999")).toBe("9999");
    expect(accountCodeAfterCategoryChange(map, "Office", "Other", "9999")).toBe("9999");
    expect(accountCodeAfterCategoryChange({}, "Office", "Other", "")).toBe("");
  });

  it("prefills a blank create from the mapping, else the matching recent code", () => {
    expect(initialAccountCode(map, "Software", { category: "Travel", accountCode: "6400" })).toBe("6190");
    expect(initialAccountCode(map, "Office", { category: "Office", accountCode: "6100" })).toBe("6100");
    expect(initialAccountCode(map, "office", { category: "Office", accountCode: "6100" })).toBe("6100");
    // A recent code from a different category must not leak onto this one.
    expect(initialAccountCode(map, "Office", { category: "Travel", accountCode: "6400" })).toBe("");
    expect(initialAccountCode(map, "Office", null)).toBe("");
  });
});
