import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("parseCsv — the exact inverse of toCsv", () => {
  it("round-trips plain fields", () => {
    const csv = toCsv(["a", "b", "c"], [
      [1, "hello", null],
      [2, "world", "x"],
    ]);
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "hello", ""],
      ["2", "world", "x"],
    ]);
  });

  it("round-trips fields containing commas, quotes, and newlines", () => {
    const tricky = 'has a "quote", a comma, and a\nnewline';
    const csv = toCsv(["col"], [[tricky]]);
    const rows = parseCsv(csv);
    expect(rows).toEqual([["col"], [tricky]]);
  });

  it("returns an empty array for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   \n  ")).toEqual([]);
  });

  it("doesn't produce a spurious trailing row from toCsv's final \\r\\n", () => {
    const csv = toCsv(["a"], [["1"], ["2"]]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3); // header + 2 data rows, nothing extra
  });
});
