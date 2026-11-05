import { z } from "zod";

export const InputSchema = z
  .object({
    mode: z
      .enum(["instant", "detailed"])
      .default("instant")
      .describe("instant = fast, short report. detailed = deeper multi-model report"),
    topic: z
      .string()
      .trim()
      .min(3, "Topic is required")
      .max(2000)
      .describe("What the report is about (required)"),
    output_format: z
      .enum(["pdf", "docx"])
      .default("pdf")
      .describe("File format of the finished report"),
    file_base64: z
      .string()
      .optional()
      .describe("Optional source document (.pdf or .docx), base64-encoded"),
    file_name: z
      .string()
      .optional()
      .describe("Original file name, e.g. 'paper.pdf' (required with file_base64)"),
  })
  .refine((v) => !v.file_base64 || !!v.file_name, {
    message: "file_name is required when file_base64 is provided",
    path: ["file_name"],
  });

export const OutputSchema = z.object({
  title: z.string(),
  report: z.string().describe("The full report as markdown text"),
  char_count: z.number().describe("Length of the report text in characters (800-1500)"),
  word_count: z.number(),
  mode: z.enum(["instant", "detailed"]),
  models_used: z.array(z.object({ id: z.string(), provider: z.string().optional() })),
  sources: z.array(z.string()).describe("Web pages Claude consulted (detailed mode only)"),
  files: z.array(
    z.object({
      filename: z.string(),
      mime: z.string(),
      bytes: z.number(),
      /** Interim delivery until marketplace file storage (R2) exists; replaced by a download id. */
      data_base64: z.string().optional(),
    }),
  ),
});

export type ReportInput = z.infer<typeof InputSchema>;
export type ReportOutput = z.infer<typeof OutputSchema>;
