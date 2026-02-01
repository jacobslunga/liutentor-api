import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ratelimit, chatRatelimit } from "~/utils/ratelimit";

function getIP(c: Context) {
  const forwarded = c.req.header("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return c.req.header("x-real-ip") ?? "unknown";
}

export const rateLimit: MiddlewareHandler = async (c, next) => {
  const ip = getIP(c);

  const { success } = await ratelimit.limit(ip);

  if (!success) {
    throw new HTTPException(429, {
      message: "Too many requests",
    });
  }

  await next();
};

export const chatRateLimit: MiddlewareHandler = async (c, next) => {
  const ip = getIP(c);

  const { success } = await chatRatelimit.limit(ip);

  if (!success) {
    throw new HTTPException(429, {
      message: "Too many requests",
    });
  }

  await next();
};
