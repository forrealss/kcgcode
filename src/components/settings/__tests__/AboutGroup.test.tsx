import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AboutView, formatVersion, githubUrl, TEAM } from "../AboutGroup";

describe("About", () => {
  test("formatVersion: 'dev' apa adanya, semver diberi prefix v", () => {
    expect(formatVersion("dev")).toBe("dev");
    expect(formatVersion("0.1.0")).toBe("v0.1.0");
  });

  test("logo + nama + versi", () => {
    const out = renderToStaticMarkup(<AboutView version="0.1.0" failed={false} />);
    expect(out).toContain('alt="KCG Code logo"');
    expect(out).toContain("KCG Code");
    expect(out).toContain(">v0.1.0<");
    // Logo tampil SEBELUM versi.
    expect(out.indexOf("KCG Code logo")).toBeLessThan(out.indexOf("v0.1.0"));
  });

  test("mode development menampilkan 'dev'", () => {
    const out = renderToStaticMarkup(<AboutView version="dev" failed={false} />);
    expect(out).toContain(">dev<");
    expect(out).not.toContain("vdev");
  });

  test("versi gagal dimuat -> pesan, bukan skeleton", () => {
    const out = renderToStaticMarkup(<AboutView version={null} failed={true} />);
    expect(out).toContain("Version unavailable");
  });

  test("credits: username, peran, tautan GitHub di tab baru", () => {
    const out = renderToStaticMarkup(<AboutView version="dev" failed={false} />);
    expect(TEAM).toEqual([
      { username: "irsyadulibad", role: "Lead Developer" },
      { username: "sahrullahh", role: "Product Advisor" },
    ]);
    expect(out).toContain('href="https://github.com/irsyadulibad"');
    expect(out).toContain('href="https://github.com/sahrullahh"');
    expect(out).toContain("@irsyadulibad");
    expect(out).toContain("Lead Developer");
    expect(out).toContain("@sahrullahh");
    expect(out).toContain("Product Advisor");
    expect(out.match(/target="_blank"/g)).toHaveLength(2);
    expect(out.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(githubUrl("irsyadulibad")).toBe("https://github.com/irsyadulibad");
  });
});
