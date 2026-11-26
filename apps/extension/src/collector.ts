/**
 * Runs INSIDE the inspected page via chrome.scripting.executeScript, not in
 * the extension's own context — Chrome serializes this function's source
 * and re-evaluates it in the page's isolated world. It must therefore be
 * fully self-contained: no imports, no references to anything outside its
 * own parameters and the browser's own globals (window/document).
 */
export function collectPageSignals(jsGlobalPaths: string[], domSelectors: string[], domAttrsBySelector: Record<string, string[]>) {
  const MAX_HTML_CHARS = 300_000;
  const MAX_INLINE_SCRIPTS = 40;
  const MAX_INLINE_SCRIPT_CHARS = 4_000;

  const cookies: { name: string; value: string }[] = [];
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    if (name) cookies.push({ name, value });
  }

  const metaTags = Array.from(document.querySelectorAll("meta")).map((el) => ({
    name: el.getAttribute("name") || undefined,
    property: el.getAttribute("property") || undefined,
    content: el.getAttribute("content") || "",
  }));

  const scriptSrcs: string[] = [];
  const scriptTags: { src: string; integrity?: string }[] = [];
  const scriptInline: string[] = [];
  for (const el of Array.from(document.querySelectorAll("script"))) {
    const src = (el as HTMLScriptElement).src;
    if (src) {
      scriptSrcs.push(src);
      scriptTags.push({ src, integrity: el.getAttribute("integrity") || undefined });
    } else if (scriptInline.length < MAX_INLINE_SCRIPTS) {
      const text = el.textContent ?? "";
      if (text.trim()) scriptInline.push(text.slice(0, MAX_INLINE_SCRIPT_CHARS));
    }
  }

  const linkTags = Array.from(document.querySelectorAll("link[rel]")).map((el) => ({
    rel: el.getAttribute("rel") ?? "",
    href: (el as HTMLLinkElement).href,
  }));

  const cssText = Array.from(document.querySelectorAll("style")).map((el) => el.textContent ?? "");

  const jsGlobals: Record<string, { exists: boolean; valuePreview?: string; typeofValue?: string }> = {};
  for (const path of jsGlobalPaths) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = path.split(".").reduce((acc: any, key) => (acc === undefined || acc === null ? undefined : acc[key]), window as any);
      if (value === undefined) {
        jsGlobals[path] = { exists: false };
        continue;
      }
      let preview: string;
      try {
        preview = typeof value === "string" ? value : JSON.stringify(value);
      } catch {
        preview = String(value);
      }
      jsGlobals[path] = { exists: true, valuePreview: (preview ?? String(value)).slice(0, 300), typeofValue: typeof value };
    } catch {
      jsGlobals[path] = { exists: false };
    }
  }

  const domQueries: Record<string, { exists: boolean; count: number; firstText?: string; attrs?: Record<string, string | undefined> }> = {};
  for (const selector of domSelectors) {
    try {
      const found = document.querySelectorAll(selector);
      const result: { exists: boolean; count: number; firstText?: string; attrs?: Record<string, string | undefined> } = {
        exists: found.length > 0,
        count: found.length,
      };
      if (found.length > 0) {
        const first = found[0] as Element;
        const text = (first.textContent ?? "").trim();
        if (text) result.firstText = text.slice(0, 500);
        const attrNames = domAttrsBySelector[selector];
        if (attrNames) {
          result.attrs = {};
          for (const attr of attrNames) result.attrs[attr] = first.getAttribute(attr) ?? undefined;
        }
      }
      domQueries[selector] = result;
    } catch {
      domQueries[selector] = { exists: false, count: 0 };
    }
  }

  return {
    finalUrl: location.href,
    title: document.title,
    html: document.documentElement.outerHTML.slice(0, MAX_HTML_CHARS),
    htmlTruncated: document.documentElement.outerHTML.length > MAX_HTML_CHARS,
    cookies,
    metaTags,
    scriptSrcs,
    scriptTags,
    scriptInline,
    linkTags,
    cssText,
    jsGlobals,
    domQueries,
  };
}

export type PageSignals = ReturnType<typeof collectPageSignals>;
