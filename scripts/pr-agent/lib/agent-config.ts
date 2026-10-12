export const ENGINES = ["claude-code", "openai-compatible"] as const;

const SETTINGS = {
  PR_AGENT_ENGINE: "ENGINE",
  PR_AGENT_API_BASE_URL: "API_BASE_URL",
  PR_AGENT_MODEL: "MODEL",
  PR_AGENT_MAX_TURNS: "MAX_TURNS",
  PR_AGENT_TIMEOUT_MINUTES: "AGENT_TIMEOUT_MINUTES",
  PR_AGENT_AUTO_COMMIT: "AUTO_COMMIT",
  PR_AGENT_KEEP_TRANSCRIPT: "KEEP_TRANSCRIPT",
} as const;

type Setting = keyof typeof SETTINGS;
export type AgentConfig = Record<(typeof SETTINGS)[Setting], string>;

const isSetting = (key: string): key is Setting => key in SETTINGS;

export function parseEnvFile(text: string): Partial<Record<Setting, string>> {
  const values: Partial<Record<Setting, string>> = {};
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) throw new Error(`pr-agent.env line ${index + 1}: expected KEY=value`);
    const [, key, value] = match;
    if (!isSetting(key)) throw new Error(`pr-agent.env line ${index + 1}: unknown setting ${key}`);
    if (key in values) throw new Error(`pr-agent.env line ${index + 1}: ${key} is set twice`);
    values[key] = value.trim();
  });
  return values;
}

function integerIn(name: string, value: string, min: number, max: number): string {
  const number = Number(value);
  if (!/^\d+$/.test(value) || number < min || number > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  return value;
}

function booleanSetting(name: string, value: string): string {
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value;
}

export function resolveAgentConfig(fileText: string, variables: Record<string, unknown> = {}): AgentConfig {
  const file = parseEnvFile(fileText);
  const value = (key: Setting) => {
    const variable = variables[key];
    return typeof variable === "string" && variable.trim() ? variable.trim() : (file[key] ?? "");
  };

  const engine = value("PR_AGENT_ENGINE");
  if (!ENGINES.includes(engine as (typeof ENGINES)[number])) throw new Error(`PR_AGENT_ENGINE must be one of: ${ENGINES.join(", ")}`);

  const model = value("PR_AGENT_MODEL");
  if (!/^[\w.:/@-]+$/.test(model)) throw new Error("PR_AGENT_MODEL must be a model ID without spaces");

  const baseUrl = value("PR_AGENT_API_BASE_URL");
  if (engine === "openai-compatible") {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error("PR_AGENT_API_BASE_URL must be a URL when PR_AGENT_ENGINE is openai-compatible");
    }
    if (url.username || url.password || url.search || url.hash) throw new Error("PR_AGENT_API_BASE_URL must not contain credentials, a query or a fragment");
  }

  return {
    ENGINE: engine,
    API_BASE_URL: baseUrl,
    MODEL: model,
    MAX_TURNS: integerIn("PR_AGENT_MAX_TURNS", value("PR_AGENT_MAX_TURNS"), 1, 200),
    AGENT_TIMEOUT_MINUTES: integerIn("PR_AGENT_TIMEOUT_MINUTES", value("PR_AGENT_TIMEOUT_MINUTES"), 1, 25),
    AUTO_COMMIT: booleanSetting("PR_AGENT_AUTO_COMMIT", value("PR_AGENT_AUTO_COMMIT") || "true"),
    KEEP_TRANSCRIPT: booleanSetting("PR_AGENT_KEEP_TRANSCRIPT", value("PR_AGENT_KEEP_TRANSCRIPT") || "false"),
  };
}
