// @vitest-environment node

import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../config";

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values;
}

describe("server config", () => {
  it("requires OPENNEST_DATA_DIR", () => {
    expect(() => loadConfig(env({}))).toThrowError(
      new ConfigError("OPENNEST_DATA_DIR is required.")
    );
  });

  it("uses safe local defaults", () => {
    const config = loadConfig(env({ OPENNEST_DATA_DIR: "/tmp/opennest-data" }));

    expect(config).toEqual({
      dataDir: path.resolve("/tmp/opennest-data"),
      host: "127.0.0.1",
      port: 8787,
      publicUrl: "http://127.0.0.1:8787",
      workspaceDatabasePath: path.join(
        path.resolve("/tmp/opennest-data"),
        "workspace.sqlite"
      ),
      authDatabasePath: path.join(path.resolve("/tmp/opennest-data"), "auth.sqlite"),
      blobRoot: path.join(path.resolve("/tmp/opennest-data"), "blobs"),
      mcpEnabled: false,
    });
  });

  it("enables MCP only when explicitly requested", () => {
    const config = loadConfig(
      env({
        OPENNEST_DATA_DIR: "/tmp/opennest-data",
        OPENNEST_MCP_ENABLED: "true",
      })
    );

    expect(config.mcpEnabled).toBe(true);
  });

  it.each(["1", "yes", "TRUE", "false "])(
    "rejects an invalid MCP flag without echoing it",
    (value) => {
      let error: unknown;

      try {
        loadConfig(
          env({
            OPENNEST_DATA_DIR: "/tmp/opennest-data",
            OPENNEST_MCP_ENABLED: value,
          })
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).not.toContain(value);
      expect(String(error)).toContain("OPENNEST_MCP_ENABLED");
    }
  );

  it("parses a custom host and port", () => {
    const config = loadConfig(
      env({
        OPENNEST_DATA_DIR: "/tmp/opennest-data",
        OPENNEST_HOST: "0.0.0.0",
        OPENNEST_PORT: "9090",
        OPENNEST_PUBLIC_URL: "https://notes.example.com/",
      })
    );

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9090);
    expect(config.publicUrl).toBe("https://notes.example.com");
  });

  it.each(["0", "65536", "abc", "12.5", "-1"])(
    "rejects an unsafe port without echoing it",
    (port) => {
      let error: unknown;

      try {
        loadConfig(
          env({
            OPENNEST_DATA_DIR: "/tmp/opennest-data",
            OPENNEST_PORT: port,
          })
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).not.toContain(port);
      expect(String(error)).toContain("OPENNEST_PORT");
    }
  );

  it.each(["http://example.com", "notes.example.com/path", "bad host", "a?b"])(
    "rejects an unsafe host without echoing it",
    (host) => {
      let error: unknown;

      try {
        loadConfig(
          env({
            OPENNEST_DATA_DIR: "/tmp/opennest-data",
            OPENNEST_HOST: host,
          })
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).not.toContain(host);
      expect(String(error)).toContain("OPENNEST_HOST");
    }
  );

  it("requires a public URL for a wildcard host", () => {
    expect(() =>
      loadConfig(
        env({
          OPENNEST_DATA_DIR: "/tmp/opennest-data",
          OPENNEST_HOST: "0.0.0.0",
        })
      )
    ).toThrowError(
      new ConfigError(
        "OPENNEST_PUBLIC_URL is required when OPENNEST_HOST is a wildcard address."
      )
    );
  });

  it("formats an IPv6 loopback default public URL", () => {
    const config = loadConfig(
      env({
        OPENNEST_DATA_DIR: "/tmp/opennest-data",
        OPENNEST_HOST: "::1",
        OPENNEST_PORT: "8080",
      })
    );

    expect(config.publicUrl).toBe("http://[::1]:8080");
  });

  it.each([
    "ftp://notes.example.com",
    "https://user:pass@notes.example.com",
    "https://notes.example.com/path",
    "https://notes.example.com?query=1",
    "https://notes.example.com#fragment",
  ])("rejects an unsafe public URL without echoing it", (publicUrl) => {
    let error: unknown;

    try {
      loadConfig(
        env({
          OPENNEST_DATA_DIR: "/tmp/opennest-data",
          OPENNEST_PUBLIC_URL: publicUrl,
        })
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigError);
    expect(String(error)).not.toContain(publicUrl);
    expect(String(error)).toContain("OPENNEST_PUBLIC_URL");
  });

  it("does not include values in missing directory errors", () => {
    expect(() => loadConfig(env({ OPENNEST_DATA_DIR: "   " }))).toThrowError(
      new ConfigError("OPENNEST_DATA_DIR is required.")
    );
  });
});
