import { emptyFacts, type SiteFacts } from "@adaiyalam/engine";
import { describe, expect, it } from "vitest";
import { mergeFacts } from "./crawl.js";

function page(url: string, overrides: Partial<SiteFacts>): SiteFacts {
  return { ...emptyFacts(url, "browser"), statusCode: 200, ...overrides };
}

describe("mergeFacts", () => {
  it("returns the single page unchanged when there is only one", () => {
    const home = page("https://example.com/", { scriptSrcs: ["https://example.com/a.js"] });
    expect(mergeFacts([home])).toBe(home);
  });

  it("unions list-valued facts across pages and dedupes exact repeats", () => {
    const home = page("https://example.com/", { scriptSrcs: ["https://cdn.example.com/shared.js"], cookies: [{ name: "session", value: "x" }] });
    const checkout = page("https://example.com/checkout", {
      scriptSrcs: ["https://cdn.example.com/shared.js", "https://js.stripe.com/v3/"],
      cookies: [{ name: "cart", value: "y" }],
    });
    const merged = mergeFacts([home, checkout]);
    expect(merged.scriptSrcs.sort()).toEqual(["https://cdn.example.com/shared.js", "https://js.stripe.com/v3/"].sort());
    expect(merged.cookies.map((c) => c.name).sort()).toEqual(["cart", "session"]);
  });

  it("keeps the primary (homepage) page's single-valued navigation facts", () => {
    const home = page("https://example.com/", { statusCode: 200, finalUrl: "https://example.com/" });
    const checkout = page("https://example.com/checkout", { statusCode: 404, finalUrl: "https://example.com/checkout" });
    const merged = mergeFacts([home, checkout]);
    expect(merged.statusCode).toBe(200);
    expect(merged.finalUrl).toBe("https://example.com/");
  });

  it("OR-combines domQuery existence across pages so a selector found only on one page still counts", () => {
    const home = page("https://example.com/", { domQueries: { ".stripe-form": { exists: false, count: 0 } } });
    const checkout = page("https://example.com/checkout", { domQueries: { ".stripe-form": { exists: true, count: 1 } } });
    const merged = mergeFacts([home, checkout]);
    expect(merged.domQueries[".stripe-form"]?.exists).toBe(true);
  });

  it("concatenates html from every page, capped, for html-type evidence matching", () => {
    const home = page("https://example.com/", { html: "<html>home</html>" });
    const checkout = page("https://example.com/checkout", { html: "<html>checkout has font-awesome/6.4.0</html>" });
    const merged = mergeFacts([home, checkout]);
    expect(merged.html).toContain("home");
    expect(merged.html).toContain("font-awesome/6.4.0");
  });
});
