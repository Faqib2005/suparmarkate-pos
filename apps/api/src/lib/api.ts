import { z } from "zod";

export function zodError(error: z.ZodError) {
  return {
    message: "Validation failed",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: "مقدار واردشده معتبر نیست."
    }))
  };
}
