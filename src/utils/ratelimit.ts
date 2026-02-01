import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl) {
  throw new Error("Missing UPSTASH_REDIS_REST_URL environment variable");
}

if (!redisToken) {
  throw new Error("Missing UPSTASH_REDIS_REST_TOKEN environment variable");
}

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

export const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(200, "1 m"),
  analytics: true,
});

export const chatRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
  analytics: true,
  prefix: "@upstash/ratelimit/chat",
});
