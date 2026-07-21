import { describe, expect, it } from "vitest";
import { isCarrierCityValueValid } from "@/components/CitySelect";

const cities = ["Karachi", "Dera Ismail Khan", "Mandi Bahauddin"];

describe("carrier city validation", () => {
  it("matches cities without case or spacing sensitivity", () => {
    expect(isCarrierCityValueValid(" dera  ismail khan ", cities)).toBe(true);
  });

  it("rejects unsupported and blank cities", () => {
    expect(isCarrierCityValueValid("Sohbatpur", cities)).toBe(false);
    expect(isCarrierCityValueValid("", cities)).toBe(false);
  });
});
