import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodError } from "./api";
import { customerErrorMiddleware } from "./customer-error-middleware";
import { customerMessage } from "./customer-message";

describe("customerMessage", () => {
  it("translates known API errors", () => {
    expect(customerMessage("Sale not found")).toBe("فروش مورد نظر پیدا نشد.");
    expect(customerMessage("Permission required: inventory.manage")).toBe(
      "شما اجازه لازم برای انجام این کار را ندارید."
    );
    expect(customerMessage("Invalid expiryDate for product: Oil")).toBe(
      "تاریخ انقضای محصول معتبر نیست."
    );
  });

  it("does not leak an unknown internal English error", () => {
    expect(customerMessage("database connection refused at host postgres")).toBe(
      "عملیات انجام نشد. لطفاً دوباره کوشش کنید."
    );
  });

  it("preserves existing Dari messages", () => {
    expect(customerMessage("این محصول موجودی کافی ندارد")).toBe(
      "این محصول موجودی کافی ندارد"
    );
  });

  it("localizes API error responses at the HTTP boundary", async () => {
    const app = new Hono();
    app.use("*", customerErrorMiddleware);
    app.get("/sale", (c) => c.json({ message: "Sale not found" }, 404));

    const response = await app.request("/sale");
    await expect(response.json()).resolves.toEqual({
      message: "فروش مورد نظر پیدا نشد."
    });
  });

  it("does not expose English validation details", () => {
    const result = z.object({ quantity: z.number().positive() }).safeParse({ quantity: -1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodError(result.error).issues[0]?.message).toBe("مقدار واردشده معتبر نیست.");
    }
  });
});
