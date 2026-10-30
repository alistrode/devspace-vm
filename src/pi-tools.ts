import { createBashTool, createEditTool, createFindTool, createGrepTool, createLsTool, createReadTool, createWriteTool, type AgentToolResult } from "@earendil-works/pi-coding-agent";

const cwd = () => process.cwd();

type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type ConvertedContent = { content: McpContent; isError: boolean };

function stringifyUnknown(value: unknown): { text: string; isError: boolean } {
  if (typeof value === "string") return { text: value, isError: false };

  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return { text: serialized, isError: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    let fallback: string;
    try {
      fallback = String(value);
    } catch (fallbackError) {
      fallback = `<string conversion failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}>`;
    }
    return {
      text: `Unable to serialize content (${Object.prototype.toString.call(value)}): ${reason}. Fallback: ${fallback}`,
      isError: true,
    };
  }

  try {
    return { text: String(value), isError: false };
  } catch (error) {
    return {
      text: `Unable to convert content (${typeof value}): ${error instanceof Error ? error.message : "unknown conversion error"}`,
      isError: true,
    };
  }
}

function toMcpContent(content: unknown): ConvertedContent {
  if (
    typeof content === "object" &&
    content !== null &&
    "type" in content &&
    content.type === "text" &&
    "text" in content &&
    typeof content.text === "string"
  ) {
    return { content: { type: "text", text: content.text }, isError: false };
  }

  if (
    typeof content === "object" &&
    content !== null &&
    "type" in content &&
    content.type === "image" &&
    "data" in content &&
    "mimeType" in content &&
    typeof content.data === "string" &&
    typeof content.mimeType === "string"
  ) {
    return {
      content: { type: "image", data: content.data, mimeType: content.mimeType },
      isError: false,
    };
  }

  const converted = stringifyUnknown(content);
  return {
    content: { type: "text", text: converted.text },
    isError: converted.isError,
  };
}

export type ToolResponse<T = unknown> = {
  content: McpContent[];
  details?: T;
  isError?: boolean;
};

async function run<T>(fn: () => Promise<AgentToolResult<T>>): Promise<ToolResponse<T>> {
  try {
    const value = await fn();
    const converted = value.content.map(toMcpContent);
    return {
      content: converted.map((item) => item.content),
      details: value.details,
      isError: converted.some((item) => item.isError) || undefined,
    };
  } catch (error) {
    const converted = stringifyUnknown(error instanceof Error ? error.message : error);
    return { content: [{ type: "text", text: converted.text }], isError: true };
  }
}
export const readFileTool = (input: any) => run(() => createReadTool(cwd()).execute("read_file", input));
export const writeFileTool = (input: any) => run(() => createWriteTool(cwd()).execute("write_file", input));
export const editFileTool = (input: any) => run(() => createEditTool(cwd()).execute("edit_file", input));
export const grepFilesTool = (input: any) => run(() => createGrepTool(cwd()).execute("grep_files", input));
export const findFilesTool = (input: any) => run(() => createFindTool(cwd()).execute("find_files", input));
export const listDirectoryTool = (input: any) => run(() => createLsTool(cwd()).execute("list_directory", input));
export const runShellTool = (input: any) => run(() => createBashTool(cwd()).execute("run_shell", input));
