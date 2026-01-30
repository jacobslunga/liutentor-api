import { createClient } from "@supabase/supabase-js";
import { MiddlewareHandler } from "hono";

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseKey);

export const supabaseMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("supabase", supabase);
  await next();
};
